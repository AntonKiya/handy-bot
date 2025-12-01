export const SUMMARY_COMMENTS_NAMESPACE = 'summary:comments';

export enum SummaryCommentsAction {
  AddNew = 'add-new',
  CancelAdd = 'cancel-add',
}

export const SUMMARY_COMMENTS_CB = {
  addNew: `${SUMMARY_COMMENTS_NAMESPACE}:${SummaryCommentsAction.AddNew}`,
  cancelAdd: `${SUMMARY_COMMENTS_NAMESPACE}:${SummaryCommentsAction.CancelAdd}`,
} as const;
