/**
 * 计算全局通知 badge 总数。
 * 每次 unreadMap / newTicketIds / myTicketIds / bbsUnreadMap 变化时调用。
 */
export const calcBadge = (
  unreadMap: Record<number, number>,
  newTicketIds: number[],
  myTicketIds: number[],
  bbsUnreadMap: Record<number, number>,
): number => {
  const unreadTicketIds = myTicketIds.length > 0 ? myTicketIds : Object.keys(unreadMap).map(Number);
  const unreadTotal = unreadTicketIds.reduce((sum, id) => sum + (unreadMap[id] || 0), 0);
  const bbsTotal = Object.values(bbsUnreadMap).reduce((sum, count) => sum + count, 0);
  return unreadTotal + newTicketIds.length + bbsTotal;
};
