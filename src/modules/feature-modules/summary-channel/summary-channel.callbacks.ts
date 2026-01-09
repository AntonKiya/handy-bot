// Базовый namespace домена
export const SUMMARY_CHANNEL_NAMESPACE = 'summary-channel';

// Действия внутри домена summary-channel
export enum SummaryChannelAction {
  OpenMenu = 'open-menu',
  ListMenu = 'list-menu',
  AddChannelMenu = 'add-channel-menu',
  CancelAddChannelMenu = 'cancel-add-channel-menu',

  DetachChannelMenu = 'detach-channel-menu',
  DetachChannel = 'detach-channel',

  BackMenu = 'back-menu',
}

export const SUMMARY_CHANNEL_CB = {
  openMenu: `${SUMMARY_CHANNEL_NAMESPACE}:${SummaryChannelAction.OpenMenu}`,
  listMenu: `${SUMMARY_CHANNEL_NAMESPACE}:${SummaryChannelAction.ListMenu}`,
  addChannelMenu: `${SUMMARY_CHANNEL_NAMESPACE}:${SummaryChannelAction.AddChannelMenu}`,
  cancelAddMenu: `${SUMMARY_CHANNEL_NAMESPACE}:${SummaryChannelAction.CancelAddChannelMenu}`,

  detachChannelMenu: `${SUMMARY_CHANNEL_NAMESPACE}:${SummaryChannelAction.DetachChannelMenu}`,
  detachChannel: (telegramChatIdRaw: string) =>
    `${SUMMARY_CHANNEL_NAMESPACE}:${SummaryChannelAction.DetachChannel}:${telegramChatIdRaw}`,

  backMenu: `${SUMMARY_CHANNEL_NAMESPACE}:${SummaryChannelAction.BackMenu}`,
} as const;
