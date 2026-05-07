import { Test, TestingModule } from '@nestjs/testing';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { SettingsService } from '../settings/settings.service';
import { ScreenShareService } from './screen-share.service';
import { VoiceService } from './voice.service';
import { RoomService } from './room.service';
import { AiService } from '../ai/ai.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from '../../entities/user.entity';
import { Ticket, TicketStatus } from '../../entities/ticket.entity';

describe('ChatGateway', () => {
  let gateway: ChatGateway;
  let mockChatService: any;
  let mockJwtService: any;
  let mockUserRepo: any;
  let mockTicketRepo: any;
  let mockRoomService: any;

  beforeEach(async () => {
    mockChatService = {
      createMessage: jest.fn().mockResolvedValue({ id: 1, content: 'msg', type: 'text', sender: { id: 1 } }),
      getHistory: jest.fn().mockResolvedValue({ messages: [], total: 0 }),
      getMessagesByTicket: jest.fn().mockResolvedValue([]),
    };
    mockJwtService = {
      verify: jest.fn(),
    };
    mockUserRepo = {
      findOne: jest.fn(),
    };
    mockTicketRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
    };
    mockRoomService = {
      removeUserFromAllRooms: jest.fn(),
      addOnlineUser: jest.fn(),
      addUserToRoom: jest.fn(),
      removeUserFromRoom: jest.fn(),
      getUsersInRoom: jest.fn().mockReturnValue([{ id: 1 }]),
      canAccessTicketRoom: jest.fn().mockReturnValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatGateway,
        { provide: ChatService, useValue: mockChatService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('secret') } },
        { provide: SettingsService, useValue: {} },
        { provide: ScreenShareService, useValue: { handleDisconnect: jest.fn(), getActiveSharer: jest.fn().mockReturnValue(null), stopShare: jest.fn() } },
        { provide: VoiceService, useValue: { handleDisconnect: jest.fn(), getParticipants: jest.fn().mockReturnValue(new Map()), leaveVoice: jest.fn() } },
        { provide: RoomService, useValue: mockRoomService },
        { provide: AiService, useValue: { getTask: jest.fn() } },
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
        { provide: getRepositoryToken(Ticket), useValue: mockTicketRepo },
      ],
    }).compile();

    gateway = module.get<ChatGateway>(ChatGateway);
    gateway.server = {
      to: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnValue({ fetchSockets: jest.fn().mockResolvedValue([]) }),
      emit: jest.fn(),
    } as any;
  });

  describe('handleConnection', () => {
    it('should authenticate and join user room for valid token', async () => {
      const client = { 
        handshake: { auth: { token: 'valid' } }, 
        disconnect: jest.fn(),
        join: jest.fn()
      } as any;
      
      mockJwtService.verify.mockReturnValue({ sub: 1, role: 'tech' });
      mockUserRepo.findOne.mockResolvedValue({ id: 1, isActive: true });

      await gateway.handleConnection(client);

      expect(client.userId).toBe(1);
      expect(client.join).toHaveBeenCalledWith('user_1');
    });
  });

  describe('handleJoinRoom', () => {
    it('should join room successfully', async () => {
      const client = { userId: 1, join: jest.fn(), emit: jest.fn() } as any;
      mockTicketRepo.findOne.mockResolvedValue({
        id: 1, 
        status: TicketStatus.PENDING, 
        creatorId: 1,
        participants: []
      });

      await gateway.handleJoinRoom(client, { ticketId: 1 });

      expect(client.join).toHaveBeenCalledWith('ticket_1');

      expect(gateway.server.to).toHaveBeenCalledWith('ticket_1');
    });

    it('should emit error if ticket not found', async () => {
      const client = { userId: 1, emit: jest.fn() } as any;
      mockTicketRepo.findOne.mockResolvedValue(null);

      await gateway.handleJoinRoom(client, { ticketId: 999 });

      expect(client.emit).toHaveBeenCalledWith('error', expect.any(String));
    });
  });

  describe('handleSendMessage', () => {
    it('should send message and broadcast', async () => {
      const client = { userId: 1, emit: jest.fn(), id: 'socket1' } as any;
      mockTicketRepo.findOne.mockResolvedValue({ id: 1, status: TicketStatus.IN_PROGRESS, creatorId: 1, assigneeId: null, participants: [], isRoomLocked: false });

      await gateway.handleSendMessage(client, { ticketId: 1, type: 'text', content: 'hello' });

      expect(mockChatService.createMessage).toHaveBeenCalled();
      expect(gateway.server.to).toHaveBeenCalledWith('ticket_1');
    });
  });

  describe('handleLeaveRoom', () => {
    it('should leave room', async () => {
      const client = { userId: 1, leave: jest.fn(), emit: jest.fn() } as any;
      
      await gateway.handleLeaveRoom(client, { ticketId: 1 });

      expect(client.leave).toHaveBeenCalledWith('ticket_1');
    });
  });
});
