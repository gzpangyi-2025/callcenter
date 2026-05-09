import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class ServiceTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      throw new UnauthorizedException('Missing Authorization header');
    }

    const [type, token] = authHeader.split(' ');

    if (type !== 'Bearer' || !token) {
      throw new UnauthorizedException('Invalid Authorization format');
    }

    const expectedToken = process.env.SERVICE_TOKEN;

    if (!expectedToken) {
      // If no token is configured on the server, deny access to prevent security hole.
      throw new UnauthorizedException('Server SERVICE_TOKEN is not configured');
    }

    if (token !== expectedToken) {
      throw new UnauthorizedException('Invalid Service Token');
    }

    return true;
  }
}
