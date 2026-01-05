/**
 * Построение ссылки на комментарий в посте канала
 *
 * Формат: https://t.me/{channel_username}/{post_id}?comment={comment_id}
 */
export function buildCommentLink(
  channelUsername: string,
  postMessageId: number,
  commentMessageId: number,
): string {
  return `https://t.me/${channelUsername}/${postMessageId}?comment=${commentMessageId}`;
}

/**
 * Построение ссылки на сообщение в Telegram
 *
 * Для supergroup: https://t.me/c/{chat_id_без_минуса_и_100}/{message_id}
 * Для обычной группы: https://t.me/{username}/{message_id}
 */
export function buildMessageLink(
  chatId: number,
  messageId: number,
  chatType: string,
  username?: string | null,
): string {
  // Supergroup: chat_id начинается с -100
  if (chatType === 'supergroup' && chatId < 0) {
    // Убираем минус и первые 3 цифры (100)
    const chatIdStr = String(chatId).replace('-100', '');
    return `https://t.me/c/${chatIdStr}/${messageId}`;
  }

  // Обычная группа с username
  if (chatType === 'group' && username) {
    return `https://t.me/${username}/${messageId}`;
  }

  // Fallback: возвращаем базовую ссылку (может не работать)
  return `https://t.me/c/${Math.abs(chatId)}/${messageId}`;
}
