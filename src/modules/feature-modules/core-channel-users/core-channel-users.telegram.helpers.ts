import { Api } from 'telegram';

export type TgAuthorPeer =
  | { type: 'user'; id: string }
  | { type: 'channel'; id: string }
  | { type: 'chat'; id: string };

export function tgDateToDate(raw: any): Date {
  if (raw instanceof Date) return raw;

  // Telegram часто отдаёт seconds (unix time)
  if (typeof raw === 'number') {
    // эвристика: если похоже на seconds — умножаем
    if (raw > 0 && raw < 10_000_000_000) {
      return new Date(raw * 1000);
    }
    return new Date(raw);
  }

  // fallback
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d : new Date(0);
}

/**
 * Возвращает id "корня треда" в discussion group:
 * - предпочтительно topMsgId (корень треда)
 * - иначе replyToMsgId (если topMsgId отсутствует)
 *
 * Если сообщение не является reply / не в треде — вернёт null.
 */
export function extractThreadRootId(msg: Api.Message): number | null {
  const replyTo: any = (msg as any)?.replyTo;
  if (!replyTo) return null;

  const raw =
    replyTo?.topMsgId ??
    replyTo?.top_msg_id ??
    replyTo?.replyToTopId ??
    replyTo?.reply_to_top_id ??
    replyTo?.replyToMsgId ??
    replyTo?.reply_to_msg_id ??
    null;

  const id = Number(raw);
  if (!Number.isFinite(id) || id <= 0) return null;

  return id;
}

/**
 * Достаёт fromId в виде {type,id}.
 * В комментах обычно PeerUser, но поддержим и send-as channel.
 */
export function extractAuthorPeerId(msg: Api.Message): TgAuthorPeer | null {
  const fromId: any = (msg as any)?.fromId;
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
  const u = sender?.username;
  return typeof u === 'string' && u.trim().length > 0 ? u : null;
}
