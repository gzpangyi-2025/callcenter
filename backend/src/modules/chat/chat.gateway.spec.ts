import { Test, TestingModule } from '@nestjs/testing';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { SettingsService } from '../settings/settings.service';
import { ScreenShareService } from './screen-share.service';
import { VoiceService } from './voice.service';
import { RoomService } from './room.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from '../../entities/user.entity';
import { Ticket } from '../../entities/ticket.entity';
import { WsException } from '@nestjs/websockets';

describe('ChatGateway', () => {
  let gateway: ChatGateway;
  let mockChatService: any;
  let mockJwtService: any;
  let mockUserRepo: any;

  beforeEach(async () => {
    mockChatService = {};
    mockJwtService = {
      verify: jest.fn(),
    };
    mockUserRepo = {
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatGateway,
        { provide: ChatService, useValue: mockChatService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('secret') } },
        { provide: SettingsService, useValue: {} },
        { provide: ScreenShareService, useValue: { handleDisconnect: jest.fn() } },
        { provide: VoiceService, useValue: { handleDisconnect: jest.fn() } },
        { provide: RoomService, useValue: { removeUserFromAllRooms: jest.fn(), addOnlineUser: jest.fn() } },
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
        { provide: getRepositoryToken(Ticket), useValue: {} },
      ],
    }).compile();

    gateway = module.get<ChatGateway>(ChatGateway);
    gateway.server = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    } as any;
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  describe('handleConnection', () => {
    it('should disconnect client if no token provided', async () => {
      const client = { handshake: { auth: {} }, disconnect: jest.fn() } as any;
      await gateway.handleConnection(client);
      expect(client.disconnect).toHaveBeenCalled();
    });

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
      expect(client.role).toBe('tech');
      expect(client.join).toHaveBeenCalledWith('user_1');
    });

    it('should throw exception if user is inactive', async () => {
      const client = { 
        handshake: { auth: { token: 'valid' } }, 
        disconnect: jest.fn(),
      } as any;
      
      mockJwtService.verify.mockReturnValue({ sub: 1, role: 'tech' });
      mockUserRepo.findOne.mockResolvedValue({ id: 1, isActive: false });

      await gateway.handleConnection(client);
      expect(client.disconnect).toHaveBeenCalled();
    });
  });
});
