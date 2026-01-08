export const IMPORTANT_MESSAGES_NAMESPACE = 'important-msg';

export enum ImportantMessagesAction {
  // Menu
  OpenMenu = 'open-menu',
  ListMenu = 'list-menu',
  AddChannelMenu = 'add-channel-menu',
  CancelAddChannelMenu = 'cancel-add-channel-menu',
  DetachChannelMenu = 'detach-channel-menu',
  DetachChannel = 'detach-channel',
  BackMenu = 'back-menu',

  // Alert
  DoneAlert = 'done-alert',
}

export const IMPORTANT_MESSAGES_CB = {
  // Menu
  openMenu: `${IMPORTANT_MESSAGES_NAMESPACE}:${ImportantMessagesAction.OpenMenu}`,
  listMenu: `${IMPORTANT_MESSAGES_NAMESPACE}:${ImportantMessagesAction.ListMenu}`,
  addChannelMenu: `${IMPORTANT_MESSAGES_NAMESPACE}:${ImportantMessagesAction.AddChannelMenu}`,
  cancelAddChannelMenu: `${IMPORTANT_MESSAGES_NAMESPACE}:${ImportantMessagesAction.CancelAddChannelMenu}`,
  detachChannelMenu: `${IMPORTANT_MESSAGES_NAMESPACE}:${ImportantMessagesAction.DetachChannelMenu}`,
  detachChannel: (telegramChatId: string) =>
    `${IMPORTANT_MESSAGES_NAMESPACE}:${ImportantMessagesAction.DetachChannel}:${telegramChatId}`,
  backMenu: `${IMPORTANT_MESSAGES_NAMESPACE}:${ImportantMessagesAction.BackMenu}`,

  // Alert
  doneAlert: (messageId: string) =>
    `${IMPORTANT_MESSAGES_NAMESPACE}:${ImportantMessagesAction.DoneAlert}:${messageId}`,
} as const;
