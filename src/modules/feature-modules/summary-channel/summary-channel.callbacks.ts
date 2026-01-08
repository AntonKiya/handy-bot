// Базовый namespace домена
export const SUMMARY_CHANNEL_NAMESPACE = 'summary-channel';

// Действия внутри домена summary-channel
export enum SummaryChannelAction {
  OpenMenu = 'open-menu',
  ListMenu = 'list-menu',
  AddChannelMenu = 'add-channel-menu',
  CancelAddChannelMenu = 'cancel-add-channel-menu',
  BackMenu = 'back-menu',
}

export const SUMMARY_CHANNEL_CB = {
  openMenu: `${SUMMARY_CHANNEL_NAMESPACE}:${SummaryChannelAction.OpenMenu}`,
  listMenu: `${SUMMARY_CHANNEL_NAMESPACE}:${SummaryChannelAction.ListMenu}`,
  addChannelMenu: `${SUMMARY_CHANNEL_NAMESPACE}:${SummaryChannelAction.AddChannelMenu}`,
  cancelAddMenu: `${SUMMARY_CHANNEL_NAMESPACE}:${SummaryChannelAction.CancelAddChannelMenu}`,
  backMenu: `${SUMMARY_CHANNEL_NAMESPACE}:${SummaryChannelAction.BackMenu}`,
} as const;
