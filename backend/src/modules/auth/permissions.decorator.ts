import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';
// Defines the exact codes required for a route
export const Permissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const EXTERNAL_ACCESS_KEY = 'externalAccess';
export type ExternalAccessKind = 'ticket' | 'bbs' | 'webrtc';

// Marks routes that may be reached by an external share token.
// The route handler must still validate the token-scoped resource id.
export const AllowExternalAccess = (...kinds: ExternalAccessKind[]) =>
  SetMetadata(EXTERNAL_ACCESS_KEY, kinds);
