import { Injectable, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Ticket, TicketStatus, TicketType } from '../../entities/ticket.entity';
import { User } from '../../entities/user.entity';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class PushTicketDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsString()
  @IsNotEmpty()
  serviceNo: string;

  @IsString()
  @IsNotEmpty()
  customerName: string;

  @IsString()
  @IsNotEmpty()
  creatorEmployeeId: string;

  @IsString()
  @IsNotEmpty()
  assigneeEmployeeId: string;

  @IsString()
  @IsOptional()
  type?: string;

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

@Injectable()
export class ExtTicketsService {
  constructor(
    @InjectRepository(Ticket)
    private readonly ticketRepository: Repository<Ticket>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async createTicketFromOMM(dto: PushTicketDto) {
    if (!dto.title || !dto.description || !dto.serviceNo || !dto.creatorEmployeeId || !dto.assigneeEmployeeId) {
      throw new BadRequestException('Missing required fields');
    }

    // Check for duplicate serviceNo
    const existingTicket = await this.ticketRepository.findOne({ where: { serviceNo: dto.serviceNo } });
    if (existingTicket) {
      throw new ConflictException('serviceNo already exists');
    }

    // Lookup users by employeeId
    const creator = await this.userRepository.findOne({ where: { employeeId: dto.creatorEmployeeId } });
    if (!creator) {
      throw new BadRequestException(`Creator with employeeId ${dto.creatorEmployeeId} not found`);
    }

    const assignee = await this.userRepository.findOne({ where: { employeeId: dto.assigneeEmployeeId } });
    if (!assignee) {
      throw new BadRequestException(`Assignee with employeeId ${dto.assigneeEmployeeId} not found`);
    }

    // Generate ticket number (TK + YYYYMMDD + sequence)
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const ticketNo = `TK${dateStr}${Math.floor(1000 + Math.random() * 9000)}`;

    const newTicket = this.ticketRepository.create({
      ticketNo,
      title: dto.title,
      description: dto.description,
      serviceNo: dto.serviceNo,
      customerName: dto.customerName,
      creatorId: creator.id,
      assigneeId: assignee.id,
      status: TicketStatus.PENDING,
      type: dto.type as TicketType || TicketType.OTHER,
      category1: dto.category1,
      category2: dto.category2,
      category3: dto.category3,
      participants: [creator, assignee],
    });

    const savedTicket = await this.ticketRepository.save(newTicket);

    return {
      id: savedTicket.id,
      ticketNo: savedTicket.ticketNo,
      title: savedTicket.title,
      status: savedTicket.status,
      serviceNo: savedTicket.serviceNo,
      customerName: savedTicket.customerName,
      createdAt: savedTicket.createdAt
    };
  }

  async getTicketStatus(serviceNo: string) {
    const ticket = await this.ticketRepository.findOne({ 
      where: { serviceNo },
      relations: ['assignee']
    });

    if (!ticket) {
      throw new NotFoundException(`Ticket with serviceNo ${serviceNo} not found`);
    }

    return {
      id: ticket.id,
      ticketNo: ticket.ticketNo,
      serviceNo: ticket.serviceNo,
      status: ticket.status,
      assignee: ticket.assignee ? { realName: ticket.assignee.realName, employeeId: ticket.assignee.employeeId } : null,
      createdAt: ticket.createdAt,
      assignedAt: ticket.assignedAt,
    };
  }
}
