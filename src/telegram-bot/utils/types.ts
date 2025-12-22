export interface GroupMessageData {
  chatId: number;
  chatTitle: string | null;
  chatType: string;
  chatUsername: string | null;
  userId: number;
  text: string | null;
  messageId: number;
  timestamp: Date;
  isReply: boolean;
  replyToMessageId: number | null;
  hasPhoto: boolean;
  hasVideo: boolean;
  hasDocument: boolean;
  hasSticker: boolean;
  hasAudio: boolean;
  hasVoice: boolean;
}
