import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ExtUsersService, SyncUserDto } from './ext-users.service';
import { ServiceTokenGuard } from '../../guards/service-token.guard';

@Controller('ext/users')
@UseGuards(ServiceTokenGuard)
export class ExtUsersController {
  constructor(private readonly extUsersService: ExtUsersService) {}

  @Post('sync')
  async syncUsers(@Body() users: SyncUserDto[]) {
    if (!Array.isArray(users)) {
      return { code: -1, message: 'Invalid payload, must be an array' };
    }

    const data = await this.extUsersService.syncUsers(users);

    return {
      code: 0,
      message: '同步成功',
      data
    };
  }
}
