/* eslint-disable no-console */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');

/**
 * Настройки
 */
const CHANNEL_USERNAME = 'domvdaly'; // <-- хардкод
const POSTS_LOOKBACK_MONTHS = 3;

const OUT_DIR = path.join(process.cwd(), 'exports');
const OUT_FILE = path.join(
  OUT_DIR,
  `domvdaly_posts_with_threaded_comments_${new Date()
    .toISOString()
    .replace(/[:.]/g, '-')}.json`,
);

function assertEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Retry с обработкой FLOOD_WAIT_x
 */
async function withRetry(fn, opts = {}) {
  const { maxAttempts = 10, baseDelayMs = 800, label = 'tg_call' } = opts;

  let attempt = 0;
  while (true) {
    attempt += 1;
    try {
      return await fn();
    } catch (e) {
      const msg = String(e && (e.errorMessage || e.message || e));
      const m = msg.match(/FLOOD_WAIT_(\d+)/);

      if (m) {
        const seconds = Number(m[1]) || 1;
        const waitMs = (seconds + 1) * 1000;
        console.warn(
          `[${label}] FLOOD_WAIT_${seconds}, sleep ${waitMs}ms (attempt ${attempt}/${maxAttempts})`,
        );
        await sleep(waitMs);
      } else {
        const delay = Math.min(baseDelayMs * attempt, 10_000);
        console.warn(
          `[${label}] error: ${msg} | sleep ${delay}ms (attempt ${attempt}/${maxAttempts})`,
        );
        await sleep(delay);
      }

      if (attempt >= maxAttempts) throw e;
    }
  }
}

function toDate(raw) {
  if (!raw) return null;
  if (raw instanceof Date) return raw;
  if (typeof raw === 'number') return new Date(raw * 1000);
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d : null;
}

function postLink(username, postId) {
  return `https://t.me/${username}/${postId}`;
}

function commentLink(username, postId, commentId) {
  return `https://t.me/${username}/${postId}?comment=${commentId}`;
}

function extractAuthorTelegramId(fromId) {
  if (!fromId) return null;
  if (fromId instanceof Api.PeerUser) return Number(fromId.userId);
  if (fromId instanceof Api.PeerChannel) return Number(fromId.channelId);
  if (fromId instanceof Api.PeerChat) return Number(fromId.chatId);
  return null;
}

/**
 * Возвращает immediate parent message id:
 * - для ответов на комментарии: id родительского комментария
 * - для корневых комментариев: часто это id поста (postId)
 * - fallback: postId
 */
function extractParentId(msg, postId) {
  const rt = msg && msg.replyTo;
  if (!rt) return postId;

  // В GramJS обычно есть replyToMsgId (immediate parent)
  if (typeof rt.replyToMsgId === 'number' && Number.isFinite(rt.replyToMsgId)) {
    return rt.replyToMsgId;
  }

  // Иногда может быть replyToTopId (top/root of thread)
  if (typeof rt.replyToTopId === 'number' && Number.isFinite(rt.replyToTopId)) {
    return rt.replyToTopId;
  }

  return postId;
}

/**
 * Реакции (агрегация): total + items[]
 * items: { type: 'emoji'|'custom_emoji'|'unknown', value|documentId|raw, count }
 */
function extractReactions(msg) {
  const r = msg && msg.reactions;
  if (!r || !r.results || !Array.isArray(r.results)) return null;

  const items = [];
  let total = 0;

  for (const x of r.results) {
    const count = Number(x && x.count) || 0;
    if (count <= 0) continue;

    total += count;

    const reaction = x.reaction;

    if (reaction instanceof Api.ReactionEmoji) {
      items.push({
        type: 'emoji',
        value: reaction.emoticon,
        count,
      });
    } else if (reaction instanceof Api.ReactionCustomEmoji) {
      items.push({
        type: 'custom_emoji',
        documentId: String(reaction.documentId),
        count,
      });
    } else {
      // На всякий случай: сохраняем как "unknown"
      items.push({
        type: 'unknown',
        raw: reaction ? reaction.className || 'reaction' : null,
        count,
      });
    }
  }

  return {
    total,
    items,
  };
}

async function getClient() {
  const apiIdRaw = assertEnv('TG_API_ID');
  const apiHash = assertEnv('TG_API_HASH');
  const sessionString = assertEnv('TG_SESSION');

  const apiId = Number(apiIdRaw);
  if (!Number.isFinite(apiId))
    throw new Error(`TG_API_ID must be a number, got: ${apiIdRaw}`);

  const client = new TelegramClient(
    new StringSession(sessionString),
    apiId,
    apiHash,
    { connectionRetries: 5 },
  );

  await client.connect();
  return client;
}

/**
 * Грузим все сообщения треда комментариев для поста и строим дерево replies любой глубины.
 * ВАЖНО:
 * - text: string | null (медиа без caption -> null)
 * - сортировка не делается (есть date)
 */
async function fetchThreadedCommentsForPost(
  client,
  tgChannelEntity,
  username,
  postId,
) {
  const flat = [];

  let offsetId = 0;
  while (true) {
    const replies = await withRetry(
      () =>
        client.getMessages(tgChannelEntity, {
          replyTo: postId,
          limit: 100,
          offsetId,
        }),
      { label: `comments(post=${postId})` },
    );

    if (!replies || replies.length === 0) break;

    for (const item of replies) {
      const msg = item;
      const commentId = Number(msg && msg.id);
      if (!Number.isFinite(commentId) || commentId <= 0) continue;

      const dt = toDate(msg.date);
      const authorTelegramId = extractAuthorTelegramId(msg.fromId);

      // Берем только текст / caption. Если пусто -> null (НЕ пропускаем!)
      const rawText = String((msg && msg.message) || '');
      const textTrimmed = rawText.trim();
      const text = textTrimmed.length ? textTrimmed : null;

      const parentId = extractParentId(msg, postId);

      flat.push({
        commentId,
        parentId, // нужно для сборки дерева
        commentLink: commentLink(username, postId, commentId),
        date: dt ? dt.toISOString() : null,
        authorTelegramId: Number.isFinite(authorTelegramId)
          ? authorTelegramId
          : null,
        text,
        reactions: extractReactions(msg),
        replies: [], // заполним после
      });
    }

    const last = replies[replies.length - 1];
    const lastId = Number(last && last.id);
    if (!Number.isFinite(lastId) || lastId <= 0) break;

    offsetId = lastId;
    if (replies.length < 100) break;
  }

  if (flat.length === 0) return [];

  // Map для O(1) доступа
  const byId = new Map();
  for (const node of flat) {
    byId.set(node.commentId, node);
  }

  // Сборка дерева
  const roots = [];
  for (const node of flat) {
    const pid = node.parentId;

    // Корневые:
    // - если pid == postId (ответ прямо на пост)
    // - или если родитель не найден (удален/не попал в выборку)
    if (pid === postId || !byId.has(pid)) {
      roots.push(node);
      continue;
    }

    // Вложенные
    const parent = byId.get(pid);
    parent.replies.push(node);
  }

  // Убираем техническое поле parentId из финальных объектов (не обязательно, но чище)
  const stripParent = (arr) => {
    for (const n of arr) {
      delete n.parentId;
      if (n.replies && n.replies.length) stripParent(n.replies);
    }
  };
  stripParent(roots);

  return roots;
}

async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const now = new Date();
  const fromDate = new Date(now);
  fromDate.setMonth(fromDate.getMonth() - POSTS_LOOKBACK_MONTHS);

  console.log(`Channel: @${CHANNEL_USERNAME}`);
  console.log(
    `Posts window: ${fromDate.toISOString()} -> ${now.toISOString()}`,
  );
  console.log(`Output: ${OUT_FILE}`);

  const client = await getClient();

  try {
    const tgChannelEntity = await withRetry(
      () => client.getEntity(CHANNEL_USERNAME),
      { label: 'getEntity' },
    );

    const result = {
      generatedAt: now.toISOString(),
      channel: {
        username: CHANNEL_USERNAME,
      },
      window: {
        from: fromDate.toISOString(),
        to: now.toISOString(),
      },
      posts: [],
    };

    // Пагинация по постам (новые -> старые)
    let offsetId = 0;

    while (true) {
      const messages = await withRetry(
        () =>
          client.getMessages(tgChannelEntity, {
            limit: 100,
            offsetId,
          }),
        { label: 'posts' },
      );

      if (!messages || messages.length === 0) break;

      let stop = false;

      for (const item of messages) {
        const msg = item;

        const postId = Number(msg && msg.id);
        if (!Number.isFinite(postId) || postId <= 0) continue;

        const publishedAt = toDate(msg.date);
        if (!publishedAt) continue;

        // stop по окну 3 месяца
        if (publishedAt < fromDate) {
          stop = true;
          break;
        }

        // Текст поста: только message/caption. Если пусто -> null
        const postTextRaw = String((msg && msg.message) || '');
        const postTextTrimmed = postTextRaw.trim();
        const postText = postTextTrimmed.length ? postTextTrimmed : null;

        // Реакции поста (агрегация)
        const postReactions = extractReactions(msg);

        // Комменты (если есть)
        const repliesCount =
          msg.replies && typeof msg.replies.replies === 'number'
            ? msg.replies.replies
            : 0;

        const postObj = {
          postId,
          postLink: postLink(CHANNEL_USERNAME, postId),
          publishedAt: publishedAt.toISOString(),
          postText, // null если нет текста/caption
          reactions: postReactions,
          comments: [],
        };

        if (repliesCount > 0) {
          console.log(`Post ${postId}: fetching threaded comments...`);
          postObj.comments = await fetchThreadedCommentsForPost(
            client,
            tgChannelEntity,
            CHANNEL_USERNAME,
            postId,
          );
          console.log(
            `Post ${postId}: root comments exported = ${postObj.comments.length}`,
          );
        }

        result.posts.push(postObj);
      }

      const last = messages[messages.length - 1];
      const lastId = Number(last && last.id);
      if (!Number.isFinite(lastId) || lastId <= 0) break;

      offsetId = lastId;

      if (stop) break;
      if (messages.length < 100) break;
    }

    // Без сортировки комментов (как просил). Посты тоже можно не сортировать,
    // но обычно удобнее сохранить от старых к новым:
    result.posts.sort((a, b) =>
      String(a.publishedAt || '').localeCompare(String(b.publishedAt || '')),
    );

    fs.writeFileSync(OUT_FILE, JSON.stringify(result, null, 2), 'utf8');
    console.log(`Done. Posts exported: ${result.posts.length}`);
  } finally {
    await client.disconnect();
  }
}

main().catch((e) => {
  console.error('Export failed:', e);
  process.exit(1);
});
