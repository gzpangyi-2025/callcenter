import {
  IsString,
  IsEmail,
  MinLength,
  MaxLength,
  IsOptional,
} from 'class-validator';

export class RegisterDto {
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  username: string;

  @IsString()
  @MinLength(6)
  @MaxLength(50)
  password: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  displayName?: string;

  @IsString()
  @MaxLength(50)
  realName: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  phone?: string;
}

export class LoginDto {
  @IsString()
  username: string;

  @IsString()
  password: string;
}
