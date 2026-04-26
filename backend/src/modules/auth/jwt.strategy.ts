import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { Request } from 'express';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
  ) {
    const jwtSecret = configService.get<string>('JWT_SECRET');
    if (!jwtSecret) {
      throw new Error(
        '❌ 环境变量 JWT_SECRET 未配置！请在 .env 文件中设置 JWT_SECRET 后重新启动。',
      );
    }
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (request: Request) => {
          return request?.query?.token as string;
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: jwtSecret,
    });
  }

  async validate(payload: any) {
    if (payload.role === 'external') {
      return {
        id: payload.sub,
        username: payload.username,
        displayName: payload.username,
        role: { id: -1, name: 'external', permissions: [] },
        ticketId: payload.ticketId,
        bbsId: payload.bbsId,
      };
    }

    const user = await this.authService.validateUser(payload.sub);
    if (!user) {
      return null;
    }
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      realName: user.realName,
      role: user.role,
    };
  }
}
