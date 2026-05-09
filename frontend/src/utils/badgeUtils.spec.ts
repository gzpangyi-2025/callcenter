import { describe, expect, it } from 'vitest';
import { calcBadge } from './badgeUtils';

describe('calcBadge', () => {
  it('sums unread tickets, new tickets, and BBS unread counts', () => {
    expect(
      calcBadge(
        { 1: 2, 2: 3, 99: 10 },
        [3, 4],
        [1, 2],
        { 8: 4, 9: 1 },
      ),
    ).toBe(12);
  });

  it('falls back to all unread ticket ids when myTicketIds is empty', () => {
    expect(calcBadge({ 1: 2, 2: 3 }, [], [], {})).toBe(5);
  });
});
