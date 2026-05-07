import { VoiceService } from './voice.service';

describe('VoiceService', () => {
  let service: VoiceService;

  beforeEach(() => {
    service = new VoiceService();
  });

  describe('joinVoice', () => {
    it('should add user to room and return ok', () => {
      const result = service.joinVoice('ticket_1', 1, 'Alice', 6);
      expect(result.status).toBe('ok');
      expect(result.existingParticipants).toHaveLength(0);
    });

    it('should return existing participants on join', () => {
      service.joinVoice('ticket_1', 1, 'Alice', 6);
      const result = service.joinVoice('ticket_1', 2, 'Bob', 6);
      expect(result.status).toBe('ok');
      expect(result.existingParticipants).toHaveLength(1);
      expect(result.existingParticipants[0].userName).toBe('Alice');
    });

    it('should return full when at capacity', () => {
      service.joinVoice('ticket_1', 1, 'Alice', 2);
      service.joinVoice('ticket_1', 2, 'Bob', 2);
      const result = service.joinVoice('ticket_1', 3, 'Charlie', 2);
      expect(result.status).toBe('full');
    });

    it('should handle duplicate join by removing old entry first', () => {
      service.joinVoice('ticket_1', 1, 'Alice', 6);
      service.joinVoice('ticket_1', 1, 'Alice-Reconnect', 6);
      const participants = service.getParticipants('ticket_1');
      expect(participants?.size).toBe(1);
      expect(participants?.get(1)).toBe('Alice-Reconnect');
    });
  });

  describe('leaveVoice', () => {
    it('should remove user from room', () => {
      service.joinVoice('ticket_1', 1, 'Alice', 6);
      service.leaveVoice('ticket_1', 1);
      expect(service.getParticipants('ticket_1')).toBeUndefined();
    });

    it('should not throw on leaving non-existent room', () => {
      expect(() => service.leaveVoice('ticket_999', 1)).not.toThrow();
    });
  });

  describe('hasActiveVoice', () => {
    it('should return true when room has participants', () => {
      service.joinVoice('ticket_1', 1, 'Alice', 6);
      expect(service.hasActiveVoice(1)).toBe(true);
    });

    it('should return false for empty room', () => {
      expect(service.hasActiveVoice(999)).toBe(false);
    });
  });

  describe('cleanupUser', () => {
    it('should remove user from all rooms and return affected rooms', () => {
      service.joinVoice('ticket_1', 1, 'Alice', 6);
      service.joinVoice('ticket_2', 1, 'Alice', 6);
      service.joinVoice('ticket_2', 2, 'Bob', 6);

      const affected = service.cleanupUser(1);
      expect(affected).toContain('ticket_1');
      expect(affected).toContain('ticket_2');
      expect(service.getParticipants('ticket_1')).toBeUndefined(); // room deleted (empty)
      expect(service.getParticipants('ticket_2')?.size).toBe(1); // Bob still there
    });
  });
});
