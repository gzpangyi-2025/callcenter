import { Request } from 'express';
import { Socket } from 'socket.io';

/**
 * 经过 JWT 认证后挂载到 request.user 上的用户信息
 */
export interface AuthenticatedUser {
  id: number;
  username: string;
  realName?: string;
  displayName?: string;
  role: {
    id: number;
    name: string;
    permissions?: {
      id: number;
      code: string;
      resource: string;
      action: string;
    }[];
  };
}

/**
 * 经过 AuthGuard 鉴权后的 Express Request
 */
export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}

/**
 * 经过 JWT 认证后的 Socket.IO 连接
 */
export interface AuthenticatedSocket extends Socket {
  userId: number;
  username: string;
  role: string;
  realName?: string;
  displayName?: string;
  allowedTicketId?: number;
}
