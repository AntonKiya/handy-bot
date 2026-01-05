export const IMPORTANT_MESSAGES_NAMESPACE = 'important-messages';

export enum ImportantMessagesAction {
  DoneAlert = 'done-alert',
}

export const IMPORTANT_MESSAGES_CB = {
  doneAlert: (messageId: string) =>
    `${IMPORTANT_MESSAGES_NAMESPACE}:${ImportantMessagesAction.DoneAlert}:${messageId}`,
} as const;
