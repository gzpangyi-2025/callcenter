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
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (request: Request) => {
          return request?.query?.token as string;
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET') || 'fallback_secret',
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
