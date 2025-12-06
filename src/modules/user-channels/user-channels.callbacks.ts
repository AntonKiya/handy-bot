export const CHANNELS_NAMESPACE = 'channels';

export enum ChannelsAction {
  Open = 'open',
  List = 'list',
  AddNew = 'add-new',
  Back = 'back',
}

export const CHANNELS_CB = {
  open: `${CHANNELS_NAMESPACE}:${ChannelsAction.Open}`,
  list: `${CHANNELS_NAMESPACE}:${ChannelsAction.List}`,
  addNew: `${CHANNELS_NAMESPACE}:${ChannelsAction.AddNew}`,
  back: `${CHANNELS_NAMESPACE}:${ChannelsAction.Back}`,
} as const;
