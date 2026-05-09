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

  @IsString()
  @IsOptional()
  status?: string;
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

    // Lookup users by employeeId
    const creator = await this.userRepository.findOne({ where: { employeeId: dto.creatorEmployeeId } });
    if (!creator) {
      throw new BadRequestException(`Creator with employeeId ${dto.creatorEmployeeId} not found`);
    }

    const assignee = await this.userRepository.findOne({ where: { employeeId: dto.assigneeEmployeeId } });
    if (!assignee) {
      throw new BadRequestException(`Assignee with employeeId ${dto.assigneeEmployeeId} not found`);
    }

    // Check for duplicate serviceNo (UPSERT logic)
    const existingTicket = await this.ticketRepository.findOne({ 
      where: { serviceNo: dto.serviceNo },
      relations: ['participants']
    });

    if (existingTicket) {
      // Update existing ticket
      let changed = false;
      if (dto.title && existingTicket.title !== dto.title) { existingTicket.title = dto.title; changed = true; }
      if (dto.description && existingTicket.description !== dto.description) { existingTicket.description = dto.description; changed = true; }
      if (dto.customerName && existingTicket.customerName !== dto.customerName) { existingTicket.customerName = dto.customerName; changed = true; }
      if (dto.type && existingTicket.type !== dto.type) { existingTicket.type = dto.type as TicketType; changed = true; }
      if (dto.category1 && existingTicket.category1 !== dto.category1) { existingTicket.category1 = dto.category1; changed = true; }
      if (dto.category2 && existingTicket.category2 !== dto.category2) { existingTicket.category2 = dto.category2; changed = true; }
      if (dto.category3 && existingTicket.category3 !== dto.category3) { existingTicket.category3 = dto.category3; changed = true; }
      
      // Update Creator
      if (existingTicket.creatorId !== creator.id) {
        existingTicket.creatorId = creator.id;
        if (!existingTicket.participants.some(p => p.id === creator.id)) {
          existingTicket.participants.push(creator);
        }
        changed = true;
      }
      
      // Update Assignee
      if (existingTicket.assigneeId !== assignee.id) {
        existingTicket.assigneeId = assignee.id;
        
        // Ensure new assignee is in participants
        if (!existingTicket.participants.some(p => p.id === assignee.id)) {
          existingTicket.participants.push(assignee);
        }
        changed = true;
      }

      // Update status if provided and valid
      if (dto.status && Object.values(TicketStatus).includes(dto.status as TicketStatus)) {
        if (existingTicket.status !== dto.status) {
          existingTicket.status = dto.status as TicketStatus;
          changed = true;
        }
      }

      let savedTicket = existingTicket;
      if (changed) {
        savedTicket = await this.ticketRepository.save(existingTicket);
      }

      return {
        id: savedTicket.id,
        ticketNo: savedTicket.ticketNo,
        title: savedTicket.title,
        status: savedTicket.status,
        serviceNo: savedTicket.serviceNo,
        customerName: savedTicket.customerName,
        createdAt: savedTicket.createdAt,
        updated: changed
      };
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
      status: TicketStatus.IN_PROGRESS,
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
      createdAt: savedTicket.createdAt,
      updated: false
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
