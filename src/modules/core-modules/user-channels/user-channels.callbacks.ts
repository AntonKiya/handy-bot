export const CHANNELS_NAMESPACE = 'channels';

export enum ChannelsAction {
  OpenMenu = 'open-menu',
  ListMenu = 'list-menu',
  AddChannelMenu = 'add-channel-menu',
  CancelAddChannelMenu = 'cancel-add-channel-menu',
  BackMenu = 'back-menu',
}

export const CHANNELS_CB = {
  openMenu: `${CHANNELS_NAMESPACE}:${ChannelsAction.OpenMenu}`,
  listMenu: `${CHANNELS_NAMESPACE}:${ChannelsAction.ListMenu}`,
  addChannelMenu: `${CHANNELS_NAMESPACE}:${ChannelsAction.AddChannelMenu}`,
  cancelAddChannelMenu: `${CHANNELS_NAMESPACE}:${ChannelsAction.CancelAddChannelMenu}`,
  backMenu: `${CHANNELS_NAMESPACE}:${ChannelsAction.BackMenu}`,
} as const;
