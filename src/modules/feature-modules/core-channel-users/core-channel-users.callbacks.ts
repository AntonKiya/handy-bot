export const CORE_CHANNEL_USERS_NAMESPACE = 'core-users';

export type CoreChannelUsersPeriod = '14d' | '90d';

export enum CoreChannelUsersAction {
  OpenMenu = 'open-menu',
  SelectPeriod = 'select-period',
  Back = 'back',
  MainMenu = 'main-menu',
}

export const CORE_CHANNEL_USERS_CB = {
  openMenu: `${CORE_CHANNEL_USERS_NAMESPACE}:${CoreChannelUsersAction.OpenMenu}`,

  selectPeriod: (period: CoreChannelUsersPeriod) =>
    `${CORE_CHANNEL_USERS_NAMESPACE}:${CoreChannelUsersAction.SelectPeriod}:${period}`,

  back: `${CORE_CHANNEL_USERS_NAMESPACE}:${CoreChannelUsersAction.Back}`,
  mainMenu: `${CORE_CHANNEL_USERS_NAMESPACE}:${CoreChannelUsersAction.MainMenu}`,
} as const;
