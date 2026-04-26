import {
  Controller,
  Post,
  Body,
  Res,
  Req,
  HttpCode,
  HttpStatus,
  Get,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto, LoginDto } from './dto/auth.dto';
import { AuthGuard } from '@nestjs/passport';
import { AuditService } from '../audit/audit.service';
import { AuditType } from '../../entities/audit-log.entity';
import * as express from 'express';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly auditService: AuditService,
  ) {}

  @Post('register')
  async register(
    @Body() registerDto: RegisterDto,
    @Req() req: express.Request,
    @Res() res: express.Response,
  ) {
    const result = await this.authService.register(registerDto);

    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production' && req.secure,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/api/auth',
    });

    return res.json({
      code: 0,
      message: '注册成功',
      data: {
        accessToken: result.accessToken,
        user: result.user,
      },
    });
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() loginDto: LoginDto,
    @Req() req: express.Request,
    @Res() res: express.Response,
  ) {
    const ip =
      (req.headers['x-forwarded-for'] as string) ||
      req.ip ||
      req.socket?.remoteAddress ||
      null;
    try {
      const result = await this.authService.login(loginDto);

      // 审计：登录成功
      void this.auditService.log({
        type: AuditType.USER_LOGIN,
        action: 'login',
        userId: result.user.id,
        username: result.user.username,
        detail: `用户 ${result.user.realName || result.user.username} 登录成功`,
        ip,
      });

      res.cookie('refreshToken', result.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production' && req.secure,
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/api/auth',
      });

      return res.json({
        code: 0,
        message: '登录成功',
        data: {
          accessToken: result.accessToken,
          user: result.user,
        },
      });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : '密码错误';
      void this.auditService.log({
        type: AuditType.USER_LOGIN,
        action: 'login_failed',
        username: loginDto.username,
        detail: `用户 ${loginDto.username} 登录失败: ${errMsg}`,
        ip,
      });
      throw err;
    }
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: express.Request, @Res() res: express.Response) {
    const refreshToken = (req as express.Request & { cookies?: Record<string, string> })
      .cookies?.refreshToken;
    if (!refreshToken) {
      return res.status(HttpStatus.UNAUTHORIZED).json({
        code: -1,
        message: '请重新登录',
      });
    }

    const result = await this.authService.refreshToken(refreshToken);

    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production' && req.secure,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/api/auth',
    });

    return res.json({
      code: 0,
      message: '刷新成功',
      data: {
        accessToken: result.accessToken,
        user: result.user,
      },
    });
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Res() res: express.Response) {
    res.clearCookie('refreshToken', { path: '/api/auth' });
    return res.json({ code: 0, message: '退出成功' });
  }

  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  async getProfile(@Req() req: express.Request) {
    return { code: 0, data: (req as express.Request & { user: unknown }).user };
  }

  @Post('external/login')
  async externalLogin(
    @Body() body: { ticketToken: string; nickname: string },
    @Req() req: express.Request,
  ) {
    if (!body.ticketToken || !body.nickname) {
      return { code: -1, message: '缺少 token 或昵称参数' };
    }
    const ip =
      (req.headers['x-forwarded-for'] as string) ||
      req.ip ||
      req.socket?.remoteAddress ||
      null;
    const data = await this.authService.externalLogin(
      body.ticketToken,
      body.nickname,
    );

    // 审计：外部用户登录
    void this.auditService.log({
      type: AuditType.EXTERNAL_LOGIN,
      action: 'external_login',
      username: body.nickname,
      targetId: data.user?.ticketId || null,
      detail: `外部用户「${body.nickname}」通过共享链接接入工单`,
      ip,
    });

    return { code: 0, message: '临时接入成功', data };
  }

  @Post('external/bbs-login')
  async bbsExternalLogin(@Body() body: { token: string }, @Req() req: express.Request) {
    if (!body.token) {
      return { code: -1, message: '缺少 token 参数' };
    }
    const ip =
      (req.headers['x-forwarded-for'] as string) ||
      req.ip ||
      req.socket?.remoteAddress ||
      null;
    const data = await this.authService.bbsExternalLogin(body.token);

    void this.auditService.log({
      type: AuditType.EXTERNAL_LOGIN,
      action: 'external_login',
      username: '匿名访客',
      targetId: data.user?.bbsId || null,
      detail: `外部访客通过免密链接匿名接入 BBS 帖子 #${data.user?.bbsId}`,
      ip,
    });

    return { code: 0, message: '临时接入 BBS 成功', data };
  }
}
