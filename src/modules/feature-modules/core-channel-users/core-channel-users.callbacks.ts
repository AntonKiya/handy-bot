export const CORE_CHANNEL_USERS_NAMESPACE = 'core-users';

export enum CoreChannelUsersAction {
  OpenMenu = 'open-menu',
  SelectChannelMenu = 'select-channel-menu',
  BackMenu = 'back-menu',
}

export const CORE_CHANNEL_USERS_CB = {
  openMenu: `${CORE_CHANNEL_USERS_NAMESPACE}:${CoreChannelUsersAction.OpenMenu}`,
  selectChannelMenu: (channelId: string) =>
    `${CORE_CHANNEL_USERS_NAMESPACE}:${CoreChannelUsersAction.SelectChannelMenu}:${channelId}`,
  backMenu: `${CORE_CHANNEL_USERS_NAMESPACE}:${CoreChannelUsersAction.BackMenu}`,
} as const;
