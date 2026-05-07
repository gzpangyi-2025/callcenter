import { RoomService, RoomUserInfo } from './room.service';
import { Ticket, TicketStatus } from '../../entities/ticket.entity';

describe('RoomService', () => {
  let service: RoomService;

  beforeEach(() => {
    service = new RoomService();
  });

  // ── Helper: 构造 Ticket mock ──
  const makeTicket = (overrides: Partial<Ticket> = {}): Ticket =>
    ({
      id: 1,
      creatorId: 10,
      assigneeId: 20,
      participants: [{ id: 30 }],
      status: TicketStatus.IN_PROGRESS,
      isRoomLocked: false,
      isExternalLinkDisabled: false,
      ...overrides,
    }) as unknown as Ticket;

  // ══════════════════════════════════════════════
  //  在线用户映射
  // ══════════════════════════════════════════════

  describe('onlineUsers', () => {
    it('should track add / get / remove', () => {
      service.addOnlineUser(1, 'socket-abc');
      expect(service.getSocketId(1)).toBe('socket-abc');

      service.removeOnlineUser(1);
      expect(service.getSocketId(1)).toBeUndefined();
    });

    it('should handle string userId', () => {
      service.addOnlineUser('ext-99', 'socket-xyz');
      expect(service.getSocketId('ext-99')).toBe('socket-xyz');
    });
  });

  // ══════════════════════════════════════════════
  //  isAuthorizedForRoom (锁定房间权限)
  // ══════════════════════════════════════════════

  describe('isAuthorizedForRoom', () => {
    it('should allow admin regardless', () => {
      const user: RoomUserInfo = { userId: 99, role: 'admin' };
      expect(service.isAuthorizedForRoom(user, makeTicket())).toBe(true);
    });

    it('should allow external user with matching ticketId and link enabled', () => {
      const user: RoomUserInfo = { userId: 99, role: 'external', allowedTicketId: 1 };
      expect(service.isAuthorizedForRoom(user, makeTicket())).toBe(true);
    });

    it('should deny external user if link is disabled', () => {
      const user: RoomUserInfo = { userId: 99, role: 'external', allowedTicketId: 1 };
      expect(
        service.isAuthorizedForRoom(user, makeTicket({ isExternalLinkDisabled: true })),
      ).toBe(false);
    });

    it('should deny external user with wrong ticketId', () => {
      const user: RoomUserInfo = { userId: 99, role: 'external', allowedTicketId: 999 };
      expect(service.isAuthorizedForRoom(user, makeTicket())).toBe(false);
    });

    it('should allow ticket creator', () => {
      const user: RoomUserInfo = { userId: 10, role: 'user' };
      expect(service.isAuthorizedForRoom(user, makeTicket())).toBe(true);
    });

    it('should allow ticket assignee', () => {
      const user: RoomUserInfo = { userId: 20, role: 'user' };
      expect(service.isAuthorizedForRoom(user, makeTicket())).toBe(true);
    });

    it('should allow ticket participant', () => {
      const user: RoomUserInfo = { userId: 30, role: 'user' };
      expect(service.isAuthorizedForRoom(user, makeTicket())).toBe(true);
    });

    it('should deny unrelated user', () => {
      const user: RoomUserInfo = { userId: 999, role: 'user' };
      expect(service.isAuthorizedForRoom(user, makeTicket())).toBe(false);
    });
  });

  // ══════════════════════════════════════════════
  //  canAccessTicketRoom (工单聊天室访问)
  // ══════════════════════════════════════════════

  describe('canAccessTicketRoom', () => {
    it('should allow admin', () => {
      const user: RoomUserInfo = { userId: 99, role: 'admin' };
      expect(service.canAccessTicketRoom(user, makeTicket())).toBe(true);
    });

    it('should allow ticket member even if room is locked', () => {
      const user: RoomUserInfo = { userId: 10, role: 'user' };
      expect(
        service.canAccessTicketRoom(user, makeTicket({ isRoomLocked: true })),
      ).toBe(true);
    });

    it('should deny non-member if room is locked', () => {
      const user: RoomUserInfo = { userId: 999, role: 'user' };
      expect(
        service.canAccessTicketRoom(user, makeTicket({ isRoomLocked: true })),
      ).toBe(false);
    });

    it('should allow non-member to unlocked in_progress room', () => {
      const user: RoomUserInfo = { userId: 999, role: 'user' };
      expect(service.canAccessTicketRoom(user, makeTicket())).toBe(true);
    });

    it('should deny non-member to directed pending ticket (has assignee)', () => {
      const user: RoomUserInfo = { userId: 999, role: 'user' };
      const ticket = makeTicket({
        status: TicketStatus.PENDING,
        assigneeId: 20, // directed
      });
      expect(service.canAccessTicketRoom(user, ticket)).toBe(false);
    });

    it('should allow non-member to undirected pending ticket (no assignee)', () => {
      const user: RoomUserInfo = { userId: 999, role: 'user' };
      const ticket = makeTicket({
        status: TicketStatus.PENDING,
        assigneeId: null as any, // undirected
      });
      expect(service.canAccessTicketRoom(user, ticket)).toBe(true);
    });

    it('should deny external user with disabled link', () => {
      const user: RoomUserInfo = { userId: 99, role: 'external', allowedTicketId: 1 };
      expect(
        service.canAccessTicketRoom(user, makeTicket({ isExternalLinkDisabled: true })),
      ).toBe(false);
    });

    it('should allow external user with valid link', () => {
      const user: RoomUserInfo = { userId: 99, role: 'external', allowedTicketId: 1 };
      expect(service.canAccessTicketRoom(user, makeTicket())).toBe(true);
    });
  });
});
