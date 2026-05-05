import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  Document,
  Paragraph,
  TextRun,
  ImageRun,
  Packer,
  HeadingLevel,
  AlignmentType,
  ShadingType,
} from 'docx';
import axios from 'axios';
import sizeOf from 'image-size';
import archiver from 'archiver';

import { KnowledgeDoc } from '../../entities/knowledge-doc.entity';
import { Ticket } from '../../entities/ticket.entity';
import { Message } from '../../entities/message.entity';
import { SettingsService } from '../settings/settings.service';
import { FilesService } from '../files/files.service';

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);

  constructor(
    @InjectRepository(KnowledgeDoc)
    private readonly knowledgeRepository: Repository<KnowledgeDoc>,
    @InjectRepository(Ticket)
    private readonly ticketRepository: Repository<Ticket>,
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,
    private readonly settingsService: SettingsService,
    private readonly filesService: FilesService,
  ) {}

  /**
   * AI 生成知识文档草稿（不入库，返回前端）
   */
  async generateKnowledge(ticketId: number): Promise<Partial<KnowledgeDoc>> {
    const ticket = await this.ticketRepository.findOne({
      where: { id: ticketId },
      relations: ['assignee', 'creator'],
    });

    if (!ticket) throw new NotFoundException('工单不存在');
    if (ticket.status !== 'closed')
      throw new BadRequestException('仅能为已关闭的工单生成知识文档');

    const messages = await this.messageRepository.find({
      where: { ticketId },
      order: { createdAt: 'ASC' },
      relations: ['sender'],
    });

    // 读取 AI 设置
    const settings = await this.settingsService.getAll();
    const visionApiKey = settings['ai.visionApiKey'];
    let systemPrompt = settings['ai.systemPrompt'];
    const imageApiKey = settings['ai.imageApiKey'];
    const imageModel = settings['ai.imageModel'] || 'gemini-3.1-flash-image-preview';

    if (!visionApiKey)
      throw new BadRequestException('未配置 AI 文本模型 (Gemini) API Key');

    if (!systemPrompt || systemPrompt.trim() === '') {
      systemPrompt = `你是一个专业的 IT 技术支持知识库撰写引擎。
请根据工单信息和聊天记录，生成规范的技术支持知识文档。
语言：中文。严格按照预设的 Markdown 模板输出，只要内容，不要说废话。`;
    }

    // 拼装上下文
    const chatHistory = messages
      .map((m) => {
        const sender = m.sender?.displayName || m.senderName || '系统';
        const time = m.createdAt.toLocaleString('zh-CN');
        let msg = `[${sender}] ${time}: ${m.content}`;
        if (m.fileUrl) {
          msg += ` (附件: ${m.fileName || m.fileUrl})`;
        }
        return msg;
      })
      .join('\n');

    const ticketInfo = `工单号: ${ticket.ticketNo}
标题: ${ticket.title}
客户: ${ticket.creator?.displayName || ticket.customerName || '未知'}
创建时间: ${ticket.createdAt.toLocaleString('zh-CN')}
关闭时间: ${ticket.updatedAt?.toLocaleString('zh-CN') || '未知'}
处理工程师: ${ticket.assignee?.displayName || '未知'}`;

    const prompt = `${systemPrompt}

============== 工单基本信息 ==============
${ticketInfo}

============== 完整聊天记录 ==============
${chatHistory}

============== 输出要求 ==============
请严格按照以下 Markdown 格式输出，替换其中的占位符（如 [标题]、[分析]...）：

---
title: [根据内容生成的精简标题，20字内]
ticketNo: ${ticket.ticketNo}
category: [问题类别，使用中文，如：系统软件 · 数据库、硬件设备 · X86服务器、系统软件 · 虚拟化软件 等]
tags: [提取3-5个相关技术关键词，用逗号分隔]
severity: [低/中/高/紧急]
createdAt: [此文档生成时间，格式 YYYY-MM-DD HH:mm:ss]
resolvedAt: ${ticket.updatedAt?.toLocaleString('zh-CN') || ''}
engineer: ${ticket.assignee?.displayName || '未知'}
---

# [问题标题]

## 📋 问题概述
[简要描述问题现象，1-3句]

## 🔍 问题分析

[ANALYSIS_IMAGE_PLACEHOLDER]

- **触发条件**：...
- **影响范围**：...
- **根本原因**：...

## ✅ 解决方案

### 操作步骤

[FLOW_IMAGE_PLACEHOLDER]

1. [步骤一]
2. [步骤二]

### 关键命令 / 配置
\`\`\`bash
[如果适用，放入相关命令或报错日志，没有则填无]
\`\`\`

## ⚠️ 注意事项
- [风险与前提]

## 🔗 延伸参考
- [相关链接，或写：无]

## 📎 附件记录
[附件名称列表]

---
*本文档由 CallCenter AI 根据工单 ${ticket.ticketNo} 历史记录自动生成*
`;

    // 调用 Gemini
    try {
      const genAI = new GoogleGenerativeAI(visionApiKey);
      const model = genAI.getGenerativeModel({
        model: 'gemini-3.1-pro-preview',
        systemInstruction: systemPrompt,
      });

      const result = await model.generateContent(prompt);
      const text = result.response.text();

      // 提取标题和 tags（简单正则或手动替换，后续存库时可由前端发送过来）
      // 返回生成的 Markdown 内容

      let finalMarkdown = text;

      // Real integration for Nano Banana 2 (or standard Imagen models)
      if (imageApiKey) {
        try {
          const analysisImgPrompt = `A simple, clean technical abstract system architecture diagram summarizing the issue: ${ticket.title}`;
          const flowImgPrompt = `A simple, professional step-by-step flowchart or workflow diagram for solving the issue: ${ticket.title}`;

          this.logger.log(`Generating images for ticket ${ticket.ticketNo}...`);

          const [analysisImgUrl, flowImgUrl] = await Promise.all([
            this.generateKnowledgeImage(analysisImgPrompt, imageApiKey, imageModel),
            this.generateKnowledgeImage(flowImgPrompt, imageApiKey, imageModel),
          ]);

          finalMarkdown = finalMarkdown.replace(
            '[ANALYSIS_IMAGE_PLACEHOLDER]',
            `![问题分析总结图](${analysisImgUrl})`,
          );
          finalMarkdown = finalMarkdown.replace(
            '[FLOW_IMAGE_PLACEHOLDER]',
            `![解决方案流程图](${flowImgUrl})`,
          );
        } catch (imgError: any) {
          this.logger.error(
            'Image generation failed, falling back to placeholders',
            imgError,
          );
          // Fallback to placeholder if generation fails
          const mockAnalysisImg = `https://via.placeholder.com/600x300.png?text=Analysis+Summary+for+${ticket.ticketNo}`;
          const mockFlowImg = `https://via.placeholder.com/600x400.png?text=Solution+Workflow+for+${ticket.ticketNo}`;
          finalMarkdown = finalMarkdown.replace(
            '[ANALYSIS_IMAGE_PLACEHOLDER]',
            `![问题分析总结图](${mockAnalysisImg})`,
          );
          finalMarkdown = finalMarkdown.replace(
            '[FLOW_IMAGE_PLACEHOLDER]',
            `![解决方案流程图](${mockFlowImg})`,
          );
        }
      } else {
        finalMarkdown = finalMarkdown
          .replace('[ANALYSIS_IMAGE_PLACEHOLDER]\n', '')
          .replace('[FLOW_IMAGE_PLACEHOLDER]\n', '');
      }

      // 解析 Front matter 提取标题、tags 等信息辅助前端预览
      const metadataMatches = finalMarkdown.match(/---\n([\s\S]*?)\n---/);
      let parsedTitle = ticket.title;
      let parsedTags = '';
      let parsedCategory = '其他';
      let parsedSeverity = '中';

      if (metadataMatches && metadataMatches[1]) {
        const metaStr = metadataMatches[1];
        const titleMatch = metaStr.match(/title:\s*(.*)/);
        if (titleMatch) parsedTitle = titleMatch[1];

        const tagsMatch = metaStr.match(/tags:\s*\[?(.*?)\]?$/m);
        if (tagsMatch) parsedTags = tagsMatch[1].replace(/[\[\]]/g, '');

        const catMatch = metaStr.match(/category:\s*(.*)/);
        if (catMatch) parsedCategory = catMatch[1];

        const sevMatch = metaStr.match(/severity:\s*(.*)/);
        if (sevMatch) parsedSeverity = sevMatch[1];
      }

      return {
        ticketId: ticket.id,
        title: parsedTitle,
        content: finalMarkdown,
        tags: parsedTags,
        category: parsedCategory,
        severity: parsedSeverity,
        generatedBy: 'Gemini 3.1 Pro Draft',
      };
    } catch (err: any) {
      this.logger.error('Gemini 解析报错: ', err);
      throw new BadRequestException('AI 服务调用失败: ' + err.message);
    }
  }

  /**
   * 保存校对后的知识文档入库
   */
  async saveKnowledge(data: {
    ticketId: number;
    title: string;
    content: string;
    tags?: string;
    category?: string;
    severity?: string;
    analysisImgUrl?: string; // 如果前端处理了真正的图片流，保留链接
    flowImgUrl?: string;
  }): Promise<KnowledgeDoc> {
    const doc = this.knowledgeRepository.create({
      ...data,
      generatedBy: 'AI (Edited)',
    });
    return this.knowledgeRepository.save(doc);
  }

  /**
   * 获取某工单关联知识文档
   */
  async getByTicketId(ticketId: number): Promise<KnowledgeDoc | null> {
    return this.knowledgeRepository.findOne({ where: { ticketId } });
  }

  /**
   * 获取某工单某种类型的文档
   */
  async getByTicketIdAndType(
    ticketId: number,
    docType: string,
  ): Promise<KnowledgeDoc | null> {
    return this.knowledgeRepository.findOne({ where: { ticketId, docType } });
  }

  /**
   * 获取知识库详情
   */
  async getDocById(id: number): Promise<KnowledgeDoc> {
    const doc = await this.knowledgeRepository.findOne({ where: { id } });
    if (!doc) throw new NotFoundException('文档不存在');
    return doc;
  }

  /**
   * 获取文档以及安全的文件名 (工单号_标题)
   */
  async getDocAndSafeName(
    id: number,
  ): Promise<{ doc: KnowledgeDoc; safeName: string }> {
    const doc = await this.getDocById(id);
    const ticket = await this.ticketRepository.findOne({
      where: { id: doc.ticketId },
    });
    const title = ticket ? ticket.title : doc.title;
    const ticketNo = ticket ? ticket.ticketNo : doc.ticketId;
    const safeName = `${ticketNo}_${title.replace(/[/\\]/g, '_')}`;
    return { doc, safeName };
  }

  /**
   * 全文搜索与分页列表
   */
  async searchKnowledge(q: string, page = 1, pageSize = 20, docType?: string) {
    const defaultDocType = docType || 'ai_doc';
    const baseWhere = { docType: defaultDocType };

    if (!q || q.trim() === '') {
      const [items, total] = await this.knowledgeRepository.findAndCount({
        where: baseWhere,
        order: { createdAt: 'DESC' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      });
      const augmentedItems = await Promise.all(
        items.map(async (item) => {
          const ticket = await this.ticketRepository.findOne({
            where: { id: item.ticketId },
            select: ['ticketNo'],
          });
          return {
            ...item,
            ticketNo: ticket ? ticket.ticketNo : item.ticketId,
          };
        }),
      );
      return { items: augmentedItems, total };
    }

    const keyword = `%${q}%`;
    const [items, total] = await this.knowledgeRepository.findAndCount({
      where: [
        { ...baseWhere, title: Like(keyword) },
        { ...baseWhere, tags: Like(keyword) },
      ],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    const augmentedItems = await Promise.all(
      items.map(async (item) => {
        const ticket = await this.ticketRepository.findOne({
          where: { id: item.ticketId },
          select: ['ticketNo'],
        });
        return { ...item, ticketNo: ticket ? ticket.ticketNo : item.ticketId };
      }),
    );

    return { items: augmentedItems, total };
  }

  /**
   * 直接导出聊天记录并入库
   */
  async exportChatHistory(
    ticketId: number,
    username: string,
  ): Promise<KnowledgeDoc> {
    const ticket = await this.ticketRepository.findOne({
      where: { id: ticketId },
      relations: ['messages', 'messages.sender', 'creator'],
    });

    if (!ticket) throw new NotFoundException('工单不存在');

    let markdownContent = `# 工单 ${ticket.ticketNo} 聊天记录\n\n`;
    markdownContent += `**时间:** ${new Date().toLocaleString()}\n**标题:** ${ticket.title}\n\n---\n\n`;

    const sortedMessages = ticket.messages.sort((a, b) => a.id - b.id);
    for (const msg of sortedMessages) {
      const senderName =
        msg.sender?.displayName || msg.sender?.username || 'System';
      const timeStr = msg.createdAt.toLocaleString();
      markdownContent += `**【${senderName}】 ${timeStr}**\n`;
      markdownContent += `${msg.content}\n\n`;
    }

    const doc = this.knowledgeRepository.create({
      ticketId: ticket.id,
      title: `[聊天记录] ${ticket.title}`,
      content: markdownContent,
      tags: '聊天记录',
      category: ticket.category1
        ? ticket.category2
          ? `${ticket.category1} · ${ticket.category2}`
          : ticket.category1
        : ticket.type || '全部',
      severity: '一般',
      docType: 'chat_history',
      generatedBy: username,
    });

    return await this.knowledgeRepository.save(doc);
  }

  /**
   * 更新原有知识文档
   */
  async updateKnowledge(
    id: number,
    content: string,
    title?: string,
    tags?: string,
  ): Promise<KnowledgeDoc> {
    const doc = await this.getDocById(id);
    doc.content = content;
    if (title) doc.title = title;
    if (tags) doc.tags = tags;
    return this.knowledgeRepository.save(doc);
  }

  /**
   * 删除文档
   */
  async deleteKnowledge(id: number): Promise<void> {
    await this.knowledgeRepository.delete(id);
  }

  /**
   * 导出为 Docx 工具
   */
  async exportDocx(id: number): Promise<Buffer> {
    const docInfo = await this.getDocById(id);

    const docChildren: any[] = [
      new Paragraph({
        text: docInfo.title,
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
      }),
      new Paragraph({
        text: '生成时间: ' + docInfo.createdAt.toLocaleString(),
        alignment: AlignmentType.RIGHT,
      }),
      new Paragraph({
        text: '工单追踪: ' + docInfo.ticketId,
      }),
      new Paragraph({
        text: '----- 内容正文 -----',
      }),
    ];

    if (docInfo.docType === 'chat_history') {
      // Chat History Mode: reverse generated from DB
      const ticket = await this.ticketRepository.findOne({
        where: { id: docInfo.ticketId },
        relations: ['messages', 'messages.sender', 'creator'],
      });

      if (ticket) {
        const sortedMessages = ticket.messages.sort((a, b) => a.id - b.id);

        for (const msg of sortedMessages) {
          const isCreator = ticket.creatorId === msg.senderId;
          const align = isCreator ? AlignmentType.LEFT : AlignmentType.RIGHT;
          const senderName =
            msg.sender?.displayName || msg.sender?.username || 'System';

          docChildren.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: `【${senderName}】 - ${msg.createdAt.toLocaleString()}`,
                  bold: true,
                  color: '555555',
                }),
              ],
              alignment: align,
            }),
          );

          if (
            msg.type === 'image' ||
            msg.content.includes('/api/files/static/')
          ) {
            // Extract file URL from markdown syntax ![alt](/api/files/static/uuid.png)
            const urlMatch = msg.content.match(
              /\/api\/files\/static\/([^\)]+)/,
            );
            if (urlMatch) {
              const filename = urlMatch[1];
              try {
                const imgBuffer =
                  await this.filesService.getFileBuffer(filename);
                const dimensions = sizeOf(imgBuffer);
                let w = dimensions.width || 400;
                let h = dimensions.height || 300;
                // scale down if too large for word doc
                if (w > 500) {
                  h = Math.floor(h * (500 / w));
                  w = 500;
                }
                docChildren.push(
                  new Paragraph({
                    children: [
                      new ImageRun({
                        data: imgBuffer,
                        transformation: { width: w, height: h },
                        type: 'png',
                      }),
                    ],
                    alignment: align,
                  }),
                );
                continue;
              } catch (e) {
                this.logger.error('Failed to embed image to docx', e);
              }
            }
          }

          const lines = msg.content.split('\n');
          const textRuns = lines.map(
            (line, idx) =>
              new TextRun({
                text: line,
                break: idx > 0 ? 1 : 0,
                shading: {
                  type: ShadingType.CLEAR,
                  fill: isCreator ? 'E8F4F8' : 'F0F0F0',
                },
              }),
          );

          docChildren.push(
            new Paragraph({
              children: textRuns,
              alignment: align,
            }),
          );

          docChildren.push(new Paragraph({ text: '' })); // Spacing
        }
      }
    } else {
      // Regular AI Knowledge Doc Mode
      docChildren.push(
        ...docInfo.content
          .split('\\n')
          .map((line) => new Paragraph({ text: line })),
      );
    }

    const doc = new Document({
      sections: [
        {
          properties: {},
          children: docChildren,
        },
      ],
    });

    return await Packer.toBuffer(doc);
  }

  private async generateKnowledgeImage(
    prompt: string,
    apiKey: string,
    imageModel: string,
  ): Promise<string> {
    // 动态使用数据库配置的生图模型，若前端选择nano-banana-2则映射回imagen-4.0
    const modelToUse = imageModel === 'nano-banana-2' ? 'imagen-4.0-generate-001' : imageModel;

    // Fallback placeholder
    const defaultImg =
      'https://via.placeholder.com/600x300.png?text=Image+Generating';

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelToUse}:predict?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instances: [{ prompt }],
            parameters: { sampleCount: 1 },
          }),
          signal: AbortSignal.timeout(60000),
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const b64 = data?.predictions?.[0]?.bytesBase64Encoded;
      if (!b64) {
        this.logger.warn('No base64 bytes returned from AI Image generation.');
        return defaultImg;
      }

      const fileName = `img_${Date.now()}_${Math.floor(Math.random() * 10000)}.png`;
      const buffer = Buffer.from(b64, 'base64');
      return await this.filesService.uploadToCos(fileName, buffer, 'image/png');
    } catch (error: any) {
      this.logger.error(
        'Failed to generate image via Google Google Generative AI API: ' +
          error.message,
      );
      throw error;
    }
  }

  /**
   * 一键 ZIP 导出附件与文档
   */
  async exportZip(id: number, res: any): Promise<void> {
    const { doc: docInfo, safeName } = await this.getDocAndSafeName(id);
    const archive = archiver('zip', { zlib: { level: 9 } });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(safeName)}.zip"`,
    );
    archive.pipe(res);

    // 1. 生成并追加 DOCX 与 Markdown
    const docxBuffer = await this.exportDocx(id);
    archive.append(docxBuffer, { name: `${safeName}.docx` });
    archive.append(docInfo.content || '', { name: `${safeName}.md` });

    // 2. 将 Ticket 内的消息附件提取进 attachments 文件夹
    const ticket = await this.ticketRepository.findOne({
      where: { id: docInfo.ticketId },
      relations: ['messages'],
    });

    if (ticket && ticket.messages) {
      for (const msg of ticket.messages) {
        let internalFilename = '';
        if (msg.fileUrl) {
          const match = msg.fileUrl.match(/\/api\/files\/static\/([^\?]+)/);
          if (match) internalFilename = match[1];
        } else if (msg.content && msg.content.includes('/api/files/static/')) {
          const urlMatch = msg.content.match(
            /\/api\/files\/static\/([^\)\s]+)/,
          );
          if (urlMatch) internalFilename = urlMatch[1];
        }

        if (internalFilename) {
          try {
            const buffer =
              await this.filesService.getFileBuffer(internalFilename);
            archive.append(buffer, {
              name: `attachments/${msg.fileName || internalFilename}`,
            });
          } catch (err) {
            this.logger.warn(
              `Knowledge ZIP: failed to attach ${internalFilename}: ${err instanceof Error ? err.message : 'unknown'}`,
            );
          }
        }
      }
    }

    await archive.finalize();
  }
}
