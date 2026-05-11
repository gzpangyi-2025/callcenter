import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../entities/user.entity';
import * as bcrypt from 'bcryptjs';

export class SyncUserDto {
  employeeId: string;
  realName: string;
  email: string;
  phone: string;
  wechatId: string;
  department: string;
  position: string;
  isActive: number; // 1 for enabled, 0 for disabled
}

@Injectable()
export class ExtUsersService {
  private readonly logger = new Logger(ExtUsersService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async syncUsers(users: SyncUserDto[]) {
    let inserted = 0;
    let updated = 0;

    // Use a transaction to ensure atomic bulk upsert or do it sequentially if few.
    // For simplicity and safety against deadlocks, we do it iteratively here,
    // but in a real massive sync, a query runner or raw bulk upsert is better.
    const defaultPasswordHash = await bcrypt.hash('trustfar123', 10);

    for (const dto of users) {
      if (
        !dto.employeeId ||
        !dto.realName ||
        !dto.email ||
        !dto.phone ||
        !dto.wechatId ||
        !dto.department ||
        !dto.position ||
        dto.isActive === undefined
      ) {
        throw new BadRequestException(
          `Missing required fields for employeeId: ${dto.employeeId || 'unknown'}`,
        );
      }

      const existingUser = await this.userRepository.findOne({
        where: { employeeId: dto.employeeId },
      });

      if (existingUser) {
        // Update
        let changed = false;
        if (dto.realName && existingUser.realName !== dto.realName) {
          existingUser.realName = dto.realName;
          changed = true;
        }
        if (dto.email && existingUser.email !== dto.email) {
          existingUser.email = dto.email;
          changed = true;
        }
        if (dto.phone && existingUser.phone !== dto.phone) {
          existingUser.phone = dto.phone;
          changed = true;
        }
        if (dto.wechatId !== undefined && existingUser.wechatId !== dto.wechatId) {
          existingUser.wechatId = dto.wechatId;
          changed = true;
        }
        if (dto.department && existingUser.department !== dto.department) {
          existingUser.department = dto.department;
          changed = true;
        }
        if (dto.position && existingUser.position !== dto.position) {
          existingUser.position = dto.position;
          changed = true;
        }

        if (dto.isActive !== undefined) {
          const activeBool = dto.isActive === 1;
          if (existingUser.isActive !== activeBool) {
            existingUser.isActive = activeBool;
            changed = true;
          }
        }

        if (changed) {
          await this.userRepository.save(existingUser);
          updated++;
        }
      } else {
        // Insert
        // Use email prefix as username if available, otherwise fallback to user_${employeeId}
        const generatedUsername =
          dto.email && dto.email.includes('@')
            ? dto.email.split('@')[0]
            : `user_${dto.employeeId}`;

        // Dynamically fetch the role ID for the 'user' role (普通用户)
        // This prevents severe privilege escalation bugs where environments have different role IDs.
        const [roleRow] = await this.userRepository.query(
          "SELECT id FROM roles WHERE name='user' LIMIT 1",
        );
        const defaultRoleId = roleRow ? roleRow.id : 5; // Fallback to 5 if not found

        const newUser = this.userRepository.create({
          username: generatedUsername,
          employeeId: dto.employeeId,
          realName: dto.realName,
          displayName: dto.realName,
          email: dto.email,
          phone: dto.phone,
          wechatId: dto.wechatId,
          department: dto.department,
          position: dto.position,
          password: defaultPasswordHash,
          roleId: defaultRoleId,
          isActive: dto.isActive !== undefined ? dto.isActive === 1 : true,
        });

        // Handle possible email/username collision gracefully
        try {
          await this.userRepository.save(newUser);
          inserted++;
        } catch (err) {
          this.logger.error(
            `Failed to insert user ${dto.employeeId}: ${err.message}`,
          );
        }
      }
    }

    this.logger.log(
      `User sync completed. Inserted: ${inserted}, Updated: ${updated}`,
    );

    return {
      total: users.length,
      inserted,
      updated,
    };
  }
}
