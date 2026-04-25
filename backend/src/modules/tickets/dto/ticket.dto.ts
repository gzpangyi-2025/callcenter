import {
  IsString,
  IsEnum,
  IsOptional,
  MaxLength,
  IsNumber,
} from 'class-validator';
import { TicketType } from '../../../entities/ticket.entity';

export class CreateTicketDto {
  @IsString()
  @MaxLength(200)
  title: string;

  @IsString()
  description: string;

  @IsEnum(TicketType)
  @IsOptional()
  type?: TicketType;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  serviceNo?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  customerName?: string;

  @IsNumber()
  @IsOptional()
  assigneeId?: number;

  @IsString()
  @IsOptional()
  category1?: string;

  @IsString()
  @IsOptional()
  category2?: string;

  @IsString()
  @IsOptional()
  category3?: string;
}

export class UpdateTicketDto {
  @IsString()
  @IsOptional()
  @MaxLength(200)
  title?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(TicketType)
  @IsOptional()
  type?: TicketType;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  serviceNo?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  customerName?: string;

  @IsString()
  @IsOptional()
  category1?: string;

  @IsString()
  @IsOptional()
  category2?: string;

  @IsString()
  @IsOptional()
  category3?: string;
}
