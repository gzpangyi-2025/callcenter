import { ScreenShareService } from './screen-share.service';

describe('ScreenShareService', () => {
  let service: ScreenShareService;

  beforeEach(() => {
    service = new ScreenShareService();
  });

  describe('startShare / getActiveSharer / stopShare', () => {
    it('should track active sharer', () => {
      service.startShare('ticket_1', 1, 'Alice');
      const sharer = service.getActiveSharer('ticket_1');
      expect(sharer).toEqual({ userId: 1, userName: 'Alice' });
    });

    it('should stop share and return undefined', () => {
      service.startShare('ticket_1', 1, 'Alice');
      service.stopShare('ticket_1');
      expect(service.getActiveSharer('ticket_1')).toBeUndefined();
    });
  });

  describe('hasActiveShare', () => {
    it('should return true when sharing is active', () => {
      service.startShare('ticket_42', 1, 'Alice');
      expect(service.hasActiveShare(42)).toBe(true);
    });

    it('should return false when no sharing', () => {
      expect(service.hasActiveShare(999)).toBe(false);
    });
  });

  describe('cleanupUser', () => {
    it('should remove all shares for disconnected user', () => {
      service.startShare('ticket_1', 1, 'Alice');
      service.startShare('ticket_2', 1, 'Alice');
      service.startShare('ticket_3', 2, 'Bob');

      const cleaned = service.cleanupUser(1);
      expect(cleaned).toContain('ticket_1');
      expect(cleaned).toContain('ticket_2');
      expect(cleaned).not.toContain('ticket_3');
      expect(service.getActiveSharer('ticket_3')).toEqual({ userId: 2, userName: 'Bob' });
    });

    it('should return empty array if user has no shares', () => {
      expect(service.cleanupUser(999)).toEqual([]);
    });
  });
});
