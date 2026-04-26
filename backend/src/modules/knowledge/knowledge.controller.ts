import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Res,
  Req,
} from '@nestjs/common';
import type { Response, Request } from 'express';
import { KnowledgeService } from './knowledge.service';
import { AuthGuard } from '@nestjs/passport';
import { Permissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import type { AuthenticatedUser } from '../../common/types/auth.types';

@Controller('knowledge')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  @Post('tickets/:ticketId/generate')
  @Permissions('knowledge:generate')
  async generateDraft(@Param('ticketId') ticketId: string) {
    const existDoc = await this.knowledgeService.getByTicketIdAndType(
      +ticketId,
      'ai_doc',
    );
    if (existDoc) {
      return {
        code: 2,
        data: existDoc,
        message: '已经存在知识库文档，正在为您跳转',
      };
    }
    const draft = await this.knowledgeService.generateKnowledge(+ticketId);
    return { code: 0, data: draft, message: '草稿生成成功，请编辑后保存' };
  }

  @Post('tickets/:ticketId/export-chat')
  @Permissions('knowledge:export_history')
  async exportChat(@Param('ticketId') ticketId: string, @Req() req: Request) {
    const existDoc = await this.knowledgeService.getByTicketIdAndType(
      +ticketId,
      'chat_history',
    );
    if (existDoc) {
      return {
        code: 2,
        data: existDoc,
        message: '已经导出过聊天记录，正在为您跳转',
      };
    }
    const user = req.user as AuthenticatedUser;
    const exporterName =
      user?.realName || user?.displayName || user?.username || 'System';
    const doc = await this.knowledgeService.exportChatHistory(
      +ticketId,
      exporterName,
    );
    return { code: 0, data: doc, message: '聊天记录已成功导出并保存至知识库' };
  }

  @Post()
  @Permissions('knowledge:manage')
  async saveKnowledge(
    @Body()
    body: {
      ticketId: number;
      title: string;
      content: string;
      tags?: string;
      category?: string;
      severity?: string;
      analysisImgUrl?: string;
      flowImgUrl?: string;
    },
  ) {
    const doc = await this.knowledgeService.saveKnowledge(body);
    return { code: 0, data: doc, message: '知识文档保存成功' };
  }

  @Put(':id')
  @Permissions('knowledge:manage')
  async updateKnowledge(
    @Param('id') id: string,
    @Body() body: { content: string; title?: string; tags?: string },
  ) {
    const doc = await this.knowledgeService.updateKnowledge(
      +id,
      body.content,
      body.title,
      body.tags,
    );
    return { code: 0, data: doc, message: '知识文档更新成功' };
  }

  @Get()
  @Permissions('knowledge:read')
  async search(
    @Query('q') q: string,
    @Query('page') page: string = '1',
    @Query('docType') docType?: string,
  ) {
    const data = await this.knowledgeService.searchKnowledge(
      q,
      parseInt(page, 10),
      20,
      docType,
    );
    return { code: 0, data };
  }

  @Get('ticket/:ticketId')
  @Permissions('knowledge:read')
  async getByTicket(@Param('ticketId') ticketId: string) {
    const doc = await this.knowledgeService.getByTicketId(+ticketId);
    return { code: 0, data: doc };
  }

  @Get(':id')
  @Permissions('knowledge:read')
  async getOne(@Param('id') id: string) {
    const doc = await this.knowledgeService.getDocById(+id);
    return { code: 0, data: doc };
  }

  @Delete(':id')
  @Permissions('knowledge:manage')
  async deleteOne(@Param('id') id: string) {
    await this.knowledgeService.deleteKnowledge(+id);
    return { code: 0, message: '删除成功' };
  }

  @Get(':id/export/md')
  @Permissions('knowledge:read')
  async exportMd(@Param('id') id: string, @Res() res: Response) {
    const { doc, safeName } =
      await this.knowledgeService.getDocAndSafeName(+id);
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(safeName)}.md"`,
    );
    res.send(doc.content);
  }

  @Get(':id/export/docx')
  @Permissions('knowledge:read')
  async exportDocx(@Param('id') id: string, @Res() res: Response) {
    const buffer = await this.knowledgeService.exportDocx(+id);
    const { safeName } = await this.knowledgeService.getDocAndSafeName(+id);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(safeName)}.docx"`,
    );
    res.send(buffer);
  }

  @Get(':id/export/zip')
  @Permissions('knowledge:read')
  async exportZip(@Param('id') id: string, @Res() res: Response) {
    await this.knowledgeService.exportZip(+id, res);
  }
}
