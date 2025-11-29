// Базовый namespace домена
export const SUMMARY_CHANNEL_NAMESPACE = 'summary:channel';

// Действия внутри домена summary:channel
export enum SummaryChannelAction {
  Open = 'open',
  List = 'list',
  AddNew = 'add-new',
  Back = 'back',
  CancelAdd = 'cancel-add',
}

export const SUMMARY_CHANNEL_CB = {
  open: `${SUMMARY_CHANNEL_NAMESPACE}:${SummaryChannelAction.Open}`,
  list: `${SUMMARY_CHANNEL_NAMESPACE}:${SummaryChannelAction.List}`,
  add: `${SUMMARY_CHANNEL_NAMESPACE}:${SummaryChannelAction.AddNew}`,
  back: `${SUMMARY_CHANNEL_NAMESPACE}:${SummaryChannelAction.Back}`,
} as const;
