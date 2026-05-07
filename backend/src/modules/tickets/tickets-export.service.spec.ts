import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { TicketsExportService } from './tickets-export.service';
import { Ticket } from '../../entities/ticket.entity';
import { FilesService } from '../files/files.service';

// Mock heavy external dependencies
jest.mock('docx', () => ({
  Document: jest.fn().mockImplementation(() => ({})),
  Paragraph: jest.fn().mockImplementation(() => ({})),
  TextRun: jest.fn().mockImplementation(() => ({})),
  ImageRun: jest.fn().mockImplementation(() => ({})),
  Packer: { toBuffer: jest.fn().mockResolvedValue(Buffer.from('docx-content')) },
  HeadingLevel: { HEADING_1: 'HEADING_1', HEADING_2: 'HEADING_2', TITLE: 'TITLE' },
  AlignmentType: { LEFT: 'LEFT', RIGHT: 'RIGHT', CENTER: 'CENTER' },
  ShadingType: { CLEAR: 'CLEAR' },
  Table: jest.fn().mockImplementation(() => ({})),
  TableRow: jest.fn().mockImplementation(() => ({})),
  TableCell: jest.fn().mockImplementation(() => ({})),
  WidthType: { DXA: 'DXA', PERCENTAGE: 'PERCENTAGE', AUTO: 'AUTO' },
  BorderStyle: { NONE: 'NONE', SINGLE: 'SINGLE' },
}));

jest.mock('image-size', () => jest.fn().mockReturnValue({ width: 800, height: 600, type: 'png' }));

jest.mock('archiver', () => {
  const mockArchive = {
    pipe: jest.fn(),
    append: jest.fn(),
    finalize: jest.fn().mockResolvedValue(undefined),
  };
  return jest.fn().mockReturnValue(mockArchive);
});

describe('TicketsExportService', () => {
  let service: TicketsExportService;
  let ticketRepo: any;
  let filesService: any;

  const mockTicket = {
    id: 1,
    ticketNo: 'TK-20260508-001',
    title: '测试工单',
    description: '问题描述',
    status: 'closed',
    type: '故障',
    creatorId: 10,
    assigneeId: 20,
    creator: { realName: '张三', displayName: 'zhangsan', username: 'zs' },
    assignee: { realName: '李四', displayName: 'lisi', username: 'ls' },
    participants: [{ id: 30, realName: '王五', displayName: 'wangwu', username: 'ww' }],
    customerName: 'ACME',
    category1: '硬件',
    category2: '服务器',
    category3: 'IBM',
    createdAt: new Date('2026-05-01'),
    assignedAt: new Date('2026-05-01'),
    closedAt: new Date('2026-05-02'),
    messages: [
      {
        id: 1, senderId: 10, content: '你好，我遇到了问题',
        createdAt: new Date('2026-05-01T10:00:00'),
        isRecalled: false, type: 'text',
        sender: { realName: '张三', displayName: 'zhangsan', role: { name: 'user' } },
        senderName: '张三',
      },
      {
        id: 2, senderId: 20, content: '我来帮你看看',
        createdAt: new Date('2026-05-01T10:05:00'),
        isRecalled: false, type: 'text',
        sender: { realName: '李四', displayName: 'lisi', role: { name: 'user' } },
        senderName: '李四',
      },
      {
        id: 3, senderId: 10, content: '[撤回的消息]',
        createdAt: new Date('2026-05-01T10:10:00'),
        isRecalled: true, type: 'text',
        sender: { realName: '张三', displayName: 'zhangsan' },
        senderName: '张三',
      },
    ],
  };

  beforeEach(async () => {
    ticketRepo = {
      findOne: jest.fn(),
    };
    filesService = {
      getFileBuffer: jest.fn().mockResolvedValue(Buffer.from('fake-image')),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TicketsExportService,
        { provide: getRepositoryToken(Ticket), useValue: ticketRepo },
        { provide: FilesService, useValue: filesService },
      ],
    }).compile();

    service = module.get<TicketsExportService>(TicketsExportService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── exportChatZip ──

  describe('exportChatZip', () => {
    it('should throw NotFoundException if ticket not found', async () => {
      ticketRepo.findOne.mockResolvedValue(null);
      const res = { setHeader: jest.fn(), end: jest.fn() };
      await expect(service.exportChatZip(999, 10, 'user', res)).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if user is not authorized', async () => {
      ticketRepo.findOne.mockResolvedValue(mockTicket);
      const res = { setHeader: jest.fn(), end: jest.fn() };
      await expect(service.exportChatZip(1, 999, 'user', res)).rejects.toThrow(ForbiddenException);
    });

    it('should allow creator to export', async () => {
      ticketRepo.findOne.mockResolvedValue(mockTicket);
      const res = { setHeader: jest.fn(), end: jest.fn() };
      await service.exportChatZip(1, 10, 'user', res); // creator
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/zip');
    });

    it('should allow admin to export', async () => {
      ticketRepo.findOne.mockResolvedValue(mockTicket);
      const res = { setHeader: jest.fn(), end: jest.fn() };
      await service.exportChatZip(1, 999, 'admin', res);
      expect(res.setHeader).toHaveBeenCalled();
    });

    it('should allow assignee to export', async () => {
      ticketRepo.findOne.mockResolvedValue(mockTicket);
      const res = { setHeader: jest.fn(), end: jest.fn() };
      await service.exportChatZip(1, 20, 'user', res);
      expect(res.setHeader).toHaveBeenCalled();
    });

    it('should allow participant to export', async () => {
      ticketRepo.findOne.mockResolvedValue(mockTicket);
      const res = { setHeader: jest.fn(), end: jest.fn() };
      await service.exportChatZip(1, 30, 'user', res);
      expect(res.setHeader).toHaveBeenCalled();
    });
  });

  // ── exportReport ──

  describe('exportReport', () => {
    it('should throw NotFoundException if ticket not found', async () => {
      ticketRepo.findOne.mockResolvedValue(null);
      const res = { setHeader: jest.fn(), end: jest.fn() };
      await expect(service.exportReport(999, 10, 'user', res)).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException for unauthorized user', async () => {
      ticketRepo.findOne.mockResolvedValue(mockTicket);
      const res = { setHeader: jest.fn(), end: jest.fn() };
      await expect(service.exportReport(1, 999, 'user', res)).rejects.toThrow(ForbiddenException);
    });

    it('should generate DOCX report for authorized creator', async () => {
      ticketRepo.findOne.mockResolvedValue(mockTicket);
      const res = { setHeader: jest.fn(), end: jest.fn() };
      await service.exportReport(1, 10, 'user', res);
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      );
      expect(res.end).toHaveBeenCalled();
    });

    it('should handle ticket with no messages', async () => {
      ticketRepo.findOne.mockResolvedValue({ ...mockTicket, messages: [] });
      const res = { setHeader: jest.fn(), end: jest.fn() };
      await service.exportReport(1, 10, 'user', res);
      expect(res.end).toHaveBeenCalled();
    });

    it('should handle ticket with recalled messages', async () => {
      const ticket = {
        ...mockTicket,
        messages: [mockTicket.messages[2]], // only recalled msg
      };
      ticketRepo.findOne.mockResolvedValue(ticket);
      const res = { setHeader: jest.fn(), end: jest.fn() };
      await service.exportReport(1, 10, 'user', res);
      expect(res.end).toHaveBeenCalled();
    });

    it('should handle image messages with /api/files/static/', async () => {
      const ticket = {
        ...mockTicket,
        messages: [{
          id: 4, senderId: 10, content: '![img](/api/files/static/test.png)',
          type: 'image', createdAt: new Date(), isRecalled: false,
          sender: { realName: '张三', role: { name: 'user' } }, senderName: '张三',
        }],
      };
      ticketRepo.findOne.mockResolvedValue(ticket);
      const res = { setHeader: jest.fn(), end: jest.fn() };
      await service.exportReport(1, 10, 'user', res);
      expect(filesService.getFileBuffer).toHaveBeenCalledWith('test.png');
    });
  });
});
