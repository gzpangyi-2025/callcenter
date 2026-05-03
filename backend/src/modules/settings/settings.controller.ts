import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { AuthGuard } from '@nestjs/passport';
import { PermissionsGuard } from '../auth/permissions.guard';
import {
  AllowExternalAccess,
  Permissions,
} from '../auth/permissions.decorator';
import { SettingsService } from './settings.service';

// 确保上传目录存在
const uploadDir = join(process.cwd(), 'uploads', 'logo');
if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });

@Controller('settings')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@UsePipes(
  new ValidationPipe({
    whitelist: false,
    forbidNonWhitelisted: false,
    transform: true,
  }),
)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  /** 获取所有系统配置 */
  @Get()
  @Permissions('settings:read', 'settings:manage') // Allow read or manage to view
  async getAll() {
    const data = await this.settingsService.getAll();
    return { code: 0, data };
  }

  /** 保存 AI 模型配置 */
  @Post('ai')
  @Permissions('settings:manage')
  async saveAi(
    @Body()
    body: {
      visionModel?: string;
      visionApiKey?: string;
      systemPrompt?: string;
      imageModel?: string;
      imageApiKey?: string;
    },
  ) {
    await this.settingsService.saveMany({
      'ai.visionModel': body.visionModel || '',
      'ai.visionApiKey': body.visionApiKey || '',
      'ai.systemPrompt': body.systemPrompt || '',
      'ai.imageModel': body.imageModel || '',
      'ai.imageApiKey': body.imageApiKey || '',
    });
    return { code: 0, message: 'AI 模型配置保存成功' };
  }

  /** 保存企业信息 */
  @Post('biz')
  @Permissions('settings:manage')
  async saveBiz(
    @Body()
    body: {
      companyName?: string;
      websiteUrl?: string;
      companyEmail?: string;
      companyPhone?: string;
      sla?: string;
    },
  ) {
    await this.settingsService.saveMany({
      'biz.companyName': body.companyName || '',
      'biz.websiteUrl': body.websiteUrl || '',
      'biz.companyEmail': body.companyEmail || '',
      'biz.companyPhone': body.companyPhone || '',
      'biz.sla': body.sla || '',
    });
    return { code: 0, message: '企业信息保存成功' };
  }

  /** 上传 Logo */
  @Post('logo')
  @Permissions('settings:manage')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: uploadDir,
        filename: (_req, _file, cb) => {
          // 始终保存为 logo.xxx，覆盖旧文件
          const ext = extname(_file.originalname);
          cb(null, `logo${ext}`);
        },
      }),
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) {
          return cb(new Error('仅允许上传图片文件'), false);
        }
        cb(null, true);
      },
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    }),
  )
  async uploadLogo(@UploadedFile() file: Express.Multer.File) {
    if (!file) return { code: -1, message: '文件上传失败' };
    const logoUrl = `/uploads/logo/${file.filename}`;
    await this.settingsService.set('biz.logoUrl', logoUrl);
    return { code: 0, message: 'Logo 上传成功', data: { logoUrl } };
  }

  /** 保存安全设置 */
  @Post('security')
  @Permissions('settings:manage')
  async saveSecurity(@Body() body: { shareExpiration?: string }) {
    await this.settingsService.saveMany({
      'security.shareExpiration': body.shareExpiration || '7d',
    });
    return { code: 0, message: '安全设置保存成功' };
  }

  /** 获取 WebRTC 配置 (供前端直调) */
  @Get('webrtc-config')
  @AllowExternalAccess('webrtc')
  async getWebRtcConfig() {
    const data = await this.settingsService.getAll();
    const mode = data['webrtc.mode'] || 'auto';

    if (mode === 'auto') {
      // 返回国内可用的免费高可用 STUN
      return {
        code: 0,
        data: [
          { urls: 'stun:stun.qq.com:3478' },
          { urls: 'stun:stun.miwifi.com:3478' },
          { urls: 'stun:stun.chat.bilibili.com:3478' },
        ],
      };
    } else {
      // 返回自定义配置
      const iceServers: any[] = [];
      const customStun = data['webrtc.customStun'];
      const customTurn = data['webrtc.customTurn'];

      if (customStun) {
        iceServers.push({ urls: `stun:${customStun}` });
      }
      if (customTurn) {
        iceServers.push({
          urls: `turn:${customTurn}`,
          username: data['webrtc.turnUsername'] || '',
          credential: data['webrtc.turnPassword'] || '',
        });
      }

      // Fallback 机制：如果什么都没配，给一个保底的
      if (iceServers.length === 0) {
        iceServers.push({ urls: 'stun:stun.qq.com:3478' });
      }
      return { code: 0, data: iceServers };
    }
  }

  /** 保存 WebRTC 设置 */
  @Post('webrtc')
  @Permissions('settings:manage')
  async saveWebRtc(
    @Body()
    body: {
      mode?: string;
      customStun?: string;
      customTurn?: string;
      turnUsername?: string;
      turnPassword?: string;
      screenShareMaxViewers?: number;
      voiceMaxParticipants?: number;
    },
  ) {
    await this.settingsService.saveMany({
      'webrtc.mode': body.mode || 'auto',
      'webrtc.customStun': body.customStun || '',
      'webrtc.customTurn': body.customTurn || '',
      'webrtc.turnUsername': body.turnUsername || '',
      'webrtc.turnPassword': body.turnPassword || '',
    });

    // 保存人数限制（如果提供了）
    if (body.screenShareMaxViewers !== undefined) {
      await this.settingsService.set(
        'screenShare_maxViewers',
        String(body.screenShareMaxViewers),
      );
    }
    if (body.voiceMaxParticipants !== undefined) {
      await this.settingsService.set(
        'voice_maxParticipants',
        String(body.voiceMaxParticipants),
      );
    }

    return { code: 0, message: 'WebRTC 配置保存成功' };
  }

  /** 保存存储配置 */
  @Post('storage')
  @Permissions('settings:manage')
  async saveStorage(
    @Body()
    body: {
      provider?: string;
      cosSecretId?: string;
      cosSecretKey?: string;
      cosBucket?: string;
      cosRegion?: string;
    },
  ) {
    await this.settingsService.saveMany({
      'storage.provider': body.provider || 'local',
      'storage.cos.secretId': body.cosSecretId || '',
      'storage.cos.secretKey': body.cosSecretKey || '',
      'storage.cos.bucket': body.cosBucket || '',
      'storage.cos.region': body.cosRegion || '',
    });
    return { code: 0, message: '存储配置保存成功' };
  }
}
