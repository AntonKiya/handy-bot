export const IMPORTANT_MESSAGES_NAMESPACE = 'important';

export enum ImportantMessagesAction {
  Open = 'open',
  Done = 'done',
}

export const IMPORTANT_MESSAGES_CB = {
  open: (messageId: string) =>
    `${IMPORTANT_MESSAGES_NAMESPACE}:${ImportantMessagesAction.Open}:${messageId}`,
  done: (messageId: string) =>
    `${IMPORTANT_MESSAGES_NAMESPACE}:${ImportantMessagesAction.Done}:${messageId}`,
} as const;
