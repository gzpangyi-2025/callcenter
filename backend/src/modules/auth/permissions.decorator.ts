import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';
// Defines the exact codes required for a route
export const Permissions = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);
