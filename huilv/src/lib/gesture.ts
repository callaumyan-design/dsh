/** 行上的手势状态：横滑和长按排序互斥，排序刚结束时忽略随之而来的 click */
export const gesture = {
  /** 正在横滑 */
  swiping: false,
  /** 正在长按拖动排序 */
  sorting: false,
  /** 上一次排序结束的时间 */
  sortEndedAt: 0,
};
