import { Test, TestingModule } from '@nestjs/testing';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

jest.mock('axios');

describe('SettingsController', () => {
  let controller: SettingsController;
  let settingsService: SettingsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SettingsController],
      providers: [
        {
          provide: SettingsService,
          useValue: {
            getAll: jest.fn(),
            saveMany: jest.fn(),
            set: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key, defaultValue) => defaultValue),
          },
        },
      ],
    }).compile();

    controller = module.get<SettingsController>(SettingsController);
    settingsService = module.get<SettingsService>(SettingsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return all settings', async () => {
    (settingsService.getAll as jest.Mock).mockResolvedValue({ key: 'val' });
    const result = await controller.getAll();
    expect(result.data).toEqual({ key: 'val' });
  });

  it('should save AI settings', async () => {
    await controller.saveAi({ visionModel: 'v1' });
    expect(settingsService.saveMany).toHaveBeenCalledWith(expect.objectContaining({ 'ai.visionModel': 'v1' }));
  });

  it('should save Biz settings', async () => {
    await controller.saveBiz({ companyName: 'Corp' });
    expect(settingsService.saveMany).toHaveBeenCalledWith(expect.objectContaining({ 'biz.companyName': 'Corp' }));
  });

  it('should upload Logo', async () => {
    const file = { filename: 'logo.png' } as any;
    const result = await controller.uploadLogo(file);
    expect(result.code).toBe(0);
    expect(settingsService.set).toHaveBeenCalledWith('biz.logoUrl', '/uploads/logo/logo.png');
  });

  it('should save Security settings', async () => {
    await controller.saveSecurity({ shareExpiration: '7d' });
    expect(settingsService.saveMany).toHaveBeenCalledWith(expect.objectContaining({ 'security.shareExpiration': '7d' }));
  });

  describe('getWebRtcConfig', () => {
    it('should return auto config', async () => {
      (settingsService.getAll as jest.Mock).mockResolvedValue({ 'webrtc.mode': 'auto' });
      const result = await controller.getWebRtcConfig();
      expect(result.data.length).toBeGreaterThan(0);
    });

    it('should return custom config', async () => {
      (settingsService.getAll as jest.Mock).mockResolvedValue({
        'webrtc.mode': 'custom',
        'webrtc.customStun': 'stun:80',
        'webrtc.customTurn': 'turn:80',
      });
      const result = await controller.getWebRtcConfig();
      expect(result.data.length).toBe(2);
    });
  });

  it('should save WebRTC settings', async () => {
    await controller.saveWebRtc({ mode: 'auto' });
    expect(settingsService.saveMany).toHaveBeenCalledWith(expect.objectContaining({ 'webrtc.mode': 'auto' }));
  });



  describe('saveCodexConfig', () => {
    it('should save to DB and push config to Worker successfully', async () => {
      (axios.post as jest.Mock).mockResolvedValue({ data: { success: true } });
      const result = await controller.saveCodexConfig({ concurrency: 4, maxResumeAttempts: 5 });
      expect(settingsService.saveMany).toHaveBeenCalledWith({
        'codex.concurrency': '4',
        'codex.maxResumeAttempts': '5',
      });
      expect(result.data.workerUpdated).toBe(true);
    });

    it('should gracefully handle Worker unreachable', async () => {
      (axios.post as jest.Mock).mockRejectedValue(new Error('Network Error'));
      const result = await controller.saveCodexConfig({ concurrency: 2 });
      expect(settingsService.saveMany).toHaveBeenCalled();
      expect(result.data.workerUpdated).toBe(false);
    });
  });
});
