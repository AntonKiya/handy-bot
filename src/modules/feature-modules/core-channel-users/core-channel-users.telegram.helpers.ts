import { Api } from 'telegram';

export type TelegramAuthorPeer =
  | { type: 'user'; id: string }
  | { type: 'channel'; id: string }
  | { type: 'chat'; id: string };

export function tgDateToDate(date: any): Date {
  if (!date) return new Date(0);

  // GramJS обычно даёт number (unix seconds)
  if (typeof date === 'number') return new Date(date * 1000);

  // иногда может быть Date
  if (date instanceof Date) return date;

  const n = Number(date);
  if (Number.isFinite(n)) return new Date(n);

  return new Date(0);
}

/**
 * Коммит 7:
 * threadRootId = replyToTopId (если есть), иначе replyToMsgId.
 * (как в твоём рабочем скрипте)
 */
export function extractThreadRootId(msg: Api.Message): number | null {
  const r: any = (msg as any)?.replyTo ?? (msg as any)?.reply_to ?? null;
  if (!r) return null;

  const top =
    r?.replyToTopId ??
    r?.reply_to_top_id ??
    r?.topMsgId ??
    r?.top_msg_id ??
    r?.top ??
    null;

  const direct =
    r?.replyToMsgId ??
    r?.reply_to_msg_id ??
    r?.msgId ??
    r?.msg_id ??
    r?.msg ??
    null;

  const id =
    typeof top === 'number' && top > 0
      ? top
      : typeof direct === 'number' && direct > 0
        ? direct
        : null;

  return id;
}

export function extractReplyToMsgId(msg: Api.Message): number | null {
  const r: any = (msg as any)?.replyTo ?? (msg as any)?.reply_to ?? null;
  const direct =
    r?.replyToMsgId ??
    r?.reply_to_msg_id ??
    r?.msgId ??
    r?.msg_id ??
    r?.msg ??
    null;

  if (typeof direct === 'number' && direct > 0) return direct;
  return null;
}

export function extractAuthorPeerId(
  msg: Api.Message,
): TelegramAuthorPeer | null {
  const fromId: any = (msg as any)?.fromId ?? (msg as any)?.from_id ?? null;
  if (!fromId) return null;

  if (fromId instanceof Api.PeerUser) {
    return { type: 'user', id: String(fromId.userId) };
  }

  if (fromId instanceof Api.PeerChannel) {
    return { type: 'channel', id: String(fromId.channelId) };
  }

  if (fromId instanceof Api.PeerChat) {
    return { type: 'chat', id: String(fromId.chatId) };
  }

  return null;
}

export function extractSenderUsername(sender: any): string | null {
  if (!sender) return null;

  if (sender instanceof Api.User) {
    const u = (sender as any).username;
    return typeof u === 'string' && u.length ? u : null;
  }

  if (sender instanceof Api.Channel) {
    const u = (sender as any).username;
    return typeof u === 'string' && u.length ? u : null;
  }

  return null;
}
