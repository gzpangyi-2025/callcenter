import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Ticket } from '../../entities/ticket.entity';
import {
  Document,
  Paragraph,
  TextRun,
  ImageRun,
  Packer,
  HeadingLevel,
  AlignmentType,
  ShadingType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
} from 'docx';
import sizeOf from 'image-size';
import archiver from 'archiver';

import { FilesService } from '../files/files.service';

@Injectable()
export class TicketsExportService {
  constructor(
    @InjectRepository(Ticket)
    private readonly ticketRepository: Repository<Ticket>,
    private readonly filesService: FilesService,
  ) {}

  async exportChatZip(
    ticketId: number,
    userId: number,
    userRole: string,
    res: any,
  ): Promise<void> {
    const ticket = await this.ticketRepository.findOne({
      where: { id: ticketId },
      relations: [
        'creator',
        'assignee',
        'participants',
        'messages',
        'messages.sender',
      ],
    });
    if (!ticket) throw new NotFoundException('工单不存在');

    // 权限校验：creator / assignee / participant / admin
    const isCreator = ticket.creatorId === userId;
    const isAssignee = ticket.assigneeId === userId;
    const isParticipant = ticket.participants?.some((p) => p.id === userId);
    const isAdmin = userRole === 'admin';

    if (!isCreator && !isAssignee && !isParticipant && !isAdmin) {
      throw new ForbiddenException('您无权导出此工单的聊天记录');
    }

    const safeName = `${ticket.ticketNo}_聊天记录`;
    const archive = archiver('zip', { zlib: { level: 9 } });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(safeName)}.zip"`,
    );
    archive.pipe(res);

    const sortedMessages = (ticket.messages || []).sort((a, b) => a.id - b.id);
    const creatorName =
      ticket.creator?.realName || ticket.creator?.displayName || '-';
    const assigneeName =
      ticket.assignee?.realName || ticket.assignee?.displayName || '-';
    const exportTime = new Date().toLocaleString();

    // 1. 生成 Markdown 聊天记录
    let md = `# 工单 ${ticket.ticketNo} 聊天记录\n\n`;
    md += `**标题:** ${ticket.title}\n`;
    md += `**创建人:** ${creatorName}\n`;
    md += `**接单人:** ${assigneeName}\n`;
    md += `**导出时间:** ${exportTime}\n\n---\n\n`;

    for (const msg of sortedMessages) {
      const senderName =
        msg.sender?.realName ||
        msg.sender?.displayName ||
        msg.senderName ||
        '未知用户';
      const timeStr = new Date(msg.createdAt).toLocaleString();
      if (msg.isRecalled) {
        md += `**【${senderName}】 ${timeStr}**\n_[该消息已被撤回]_\n\n`;
      } else {
        md += `**【${senderName}】 ${timeStr}**\n${msg.content}\n\n`;
      }
    }
    archive.append(md, { name: `${safeName}.md` });

    // 2. 生成 DOCX 聊天记录
    const docChildren: any[] = [
      new Paragraph({
        text: `工单 ${ticket.ticketNo} 聊天记录`,
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
      }),
      new Paragraph({
        children: [
          new TextRun({ text: `标题: ${ticket.title}`, color: '555555' }),
        ],
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `创建人: ${creatorName}    接单人: ${assigneeName}`,
            color: '555555',
          }),
        ],
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `导出时间: ${exportTime}`,
            color: '999999',
            size: 18,
          }),
        ],
        alignment: AlignmentType.RIGHT,
      }),
      new Paragraph({ text: '' }),
    ];

    for (const msg of sortedMessages) {
      if (msg.isRecalled) {
        docChildren.push(
          new Paragraph({
            children: [
              new TextRun({
                text: '[该消息已被撤回]',
                italics: true,
                color: '999999',
              }),
            ],
          }),
        );
        docChildren.push(new Paragraph({ text: '' }));
        continue;
      }

      const isMsgFromCreator = ticket.creatorId === msg.senderId;
      const align = isMsgFromCreator ? AlignmentType.LEFT : AlignmentType.RIGHT;
      const senderName =
        msg.sender?.realName ||
        msg.sender?.displayName ||
        msg.senderName ||
        '未知用户';
      const timeStr = new Date(msg.createdAt).toLocaleString();

      // 发送者和时间头
      docChildren.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `【${senderName}】 ${timeStr}`,
              bold: true,
              color: '555555',
              size: 18,
            }),
          ],
          alignment: align,
        }),
      );

      // 尝试提取并嵌入图片
      let imageEmbedded = false;
      if (
        msg.type === 'image' ||
        (msg.content && msg.content.includes('/api/files/static/'))
      ) {
        const urlMatch = msg.content.match(/\/api\/files\/static\/([^\)\s]+)/);
        if (urlMatch) {
          const filename = urlMatch[1];
          try {
            const imgBuffer = await this.filesService.getFileBuffer(filename);
            const dimensions = sizeOf(imgBuffer);
            let w = dimensions.width || 400;
            let h = dimensions.height || 300;
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
            imageEmbedded = true;
          } catch {
            // 图片嵌入失败，降级为文本
          }
        }
      }

      // 文本内容（如果不是纯图片消息）
      if (!imageEmbedded) {
        const lines = msg.content.split('\n');
        const textRuns = lines.map(
          (line: string, idx: number) =>
            new TextRun({
              text: line,
              break: idx > 0 ? 1 : 0,
              shading: {
                type: ShadingType.CLEAR,
                fill: isMsgFromCreator ? 'E8F4F8' : 'F0F0F0',
              },
            }),
        );
        docChildren.push(
          new Paragraph({
            children: textRuns,
            alignment: align,
          }),
        );
      }

      docChildren.push(new Paragraph({ text: '' }));
    }

    const docxDoc = new Document({
      sections: [
        {
          properties: {},
          children: docChildren,
        },
      ],
    });
    const docxBuffer = await Packer.toBuffer(docxDoc);
    archive.append(docxBuffer, { name: `${safeName}.docx` });

    // 3. 提取附件
    for (const msg of sortedMessages) {
      if (msg.isRecalled) continue;
      let internalFilename = '';
      if (msg.fileUrl) {
        const match = msg.fileUrl.match(/\/api\/files\/static\/([^\?]+)/);
        if (match) internalFilename = match[1];
      } else if (msg.content && msg.content.includes('/api/files/static/')) {
        const urlMatch = msg.content.match(/\/api\/files\/static\/([^\)\s]+)/);
        if (urlMatch) internalFilename = urlMatch[1];
      }
      if (internalFilename) {
        try {
          const fileBuffer =
            await this.filesService.getFileBuffer(internalFilename);
          archive.append(fileBuffer, {
            name: `attachments/${msg.fileName || internalFilename}`,
          });
        } catch {}
      }
    }

    await archive.finalize();
  }

  // ==================== 生成结构化处理报告 DOCX ====================
  async exportReport(
    ticketId: number,
    userId: number,
    userRole: string,
    res: any,
  ): Promise<void> {
    const ticket = await this.ticketRepository.findOne({
      where: { id: ticketId },
      relations: [
        'creator',
        'assignee',
        'participants',
        'messages',
        'messages.sender',
        'messages.sender.role',
      ],
    });
    if (!ticket) throw new NotFoundException('工单不存在');

    const isCreator = ticket.creatorId === userId;
    const isAssignee = ticket.assigneeId === userId;
    const isParticipant = ticket.participants?.some((p) => p.id === userId);
    const isAdmin = userRole === 'admin';
    if (!isCreator && !isAssignee && !isParticipant && !isAdmin) {
      throw new ForbiddenException('您无权导出此工单报告');
    }

    const creatorName =
      ticket.creator?.realName || ticket.creator?.displayName || '-';
    const assigneeName =
      ticket.assignee?.realName || ticket.assignee?.displayName || '-';
    const participantNames =
      (ticket.participants || [])
        .map((p) => p.realName || p.displayName || p.username)
        .join('、') || '-';
    const categoryStr = ticket.category1
      ? [ticket.category1, ticket.category2, ticket.category3]
          .filter(Boolean)
          .join(' → ')
      : ticket.type || '-';
    const statusText: Record<string, string> = {
      pending: '待接单',
      in_progress: '服务中',
      closing: '待确认关单',
      closed: '已关闭',
    };

    const sortedMessages = (ticket.messages || []).sort((a, b) => a.id - b.id);

    // ── 辅助：创建信息表格行 ──
    const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
    const noBorders = {
      top: noBorder,
      bottom: noBorder,
      left: noBorder,
      right: noBorder,
    };

    const makeInfoRow = (label: string, value: string) =>
      new TableRow({
        children: [
          new TableCell({
            width: { size: 2200, type: WidthType.DXA },
            borders: noBorders,
            shading: { fill: 'F0F4F8', type: ShadingType.CLEAR },
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: label,
                    bold: true,
                    size: 20,
                    font: 'Microsoft YaHei',
                  }),
                ],
                spacing: { before: 40, after: 40 },
              }),
            ],
          }),
          new TableCell({
            width: { size: 7000, type: WidthType.DXA },
            borders: noBorders,
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: value,
                    size: 20,
                    font: 'Microsoft YaHei',
                  }),
                ],
                spacing: { before: 40, after: 40 },
              }),
            ],
          }),
        ],
      });

    // ── 构建章节 ──
    const docChildren: any[] = [];

    // 封面标题
    docChildren.push(new Paragraph({ text: '' }));
    docChildren.push(
      new Paragraph({
        children: [
          new TextRun({
            text: '技术支持工单处理报告',
            bold: true,
            size: 36,
            font: 'Microsoft YaHei',
            color: '1a1a2e',
          }),
        ],
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
      }),
    );
    docChildren.push(
      new Paragraph({
        children: [
          new TextRun({
            text: ticket.ticketNo,
            size: 24,
            color: '6366f1',
            font: 'Microsoft YaHei',
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
      }),
    );
    docChildren.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `导出时间: ${new Date().toLocaleString('zh-CN')}`,
            size: 18,
            color: '999999',
            font: 'Microsoft YaHei',
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
      }),
    );

    // ── 一、问题背景 ──
    docChildren.push(
      new Paragraph({
        text: '一、问题背景',
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 300, after: 200 },
      }),
    );

    // 信息表格
    const infoTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        makeInfoRow('工单标题', ticket.title),
        makeInfoRow('问题类型', categoryStr),
        makeInfoRow('客户名称', ticket.customerName || '-'),
        makeInfoRow('服务单号', ticket.serviceNo || '-'),
        makeInfoRow('创建人', creatorName),
        makeInfoRow('接单工程师', assigneeName),
        ...(ticket.participants && ticket.participants.length > 0
          ? [makeInfoRow('协作专家', participantNames)]
          : []),
        makeInfoRow('工单状态', statusText[ticket.status] || ticket.status),
        makeInfoRow(
          '创建时间',
          new Date(ticket.createdAt).toLocaleString('zh-CN'),
        ),
        ...(ticket.assignedAt
          ? [
              makeInfoRow(
                '接单时间',
                new Date(ticket.assignedAt).toLocaleString('zh-CN'),
              ),
            ]
          : []),
        ...(ticket.closedAt
          ? [
              makeInfoRow(
                '关单时间',
                new Date(ticket.closedAt).toLocaleString('zh-CN'),
              ),
            ]
          : []),
      ],
    });
    docChildren.push(infoTable);

    // 问题描述子标题
    docChildren.push(
      new Paragraph({
        text: '1.1 问题描述',
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 300, after: 100 },
      }),
    );

    // 问题描述正文
    const descLines = (ticket.description || '无').split('\n');
    for (const line of descLines) {
      docChildren.push(
        new Paragraph({
          children: [
            new TextRun({ text: line, size: 21, font: 'Microsoft YaHei' }),
          ],
          spacing: { after: 60 },
        }),
      );
    }

    // ── 二、处理过程 ──
    docChildren.push(
      new Paragraph({
        text: '二、处理过程',
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 200 },
      }),
    );

    docChildren.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `以下为完整的工单沟通记录，共 ${sortedMessages.length} 条消息。`,
            size: 20,
            color: '666666',
            italics: true,
            font: 'Microsoft YaHei',
          }),
        ],
        spacing: { after: 200 },
      }),
    );

    for (const msg of sortedMessages) {
      if (msg.isRecalled) {
        docChildren.push(
          new Paragraph({
            children: [
              new TextRun({
                text: '[该消息已被撤回]',
                italics: true,
                color: '999999',
                size: 18,
              }),
            ],
            spacing: { after: 100 },
          }),
        );
        continue;
      }

      const senderName =
        msg.sender?.realName ||
        msg.sender?.displayName ||
        msg.senderName ||
        '未知用户';
      const timeStr = new Date(msg.createdAt).toLocaleString('zh-CN');

      // 角色判定与颜色映射
      let roleTag: string;
      let roleColor: string;
      if (ticket.creatorId === msg.senderId) {
        roleTag = '申请人';
        roleColor = '2563eb'; // 蓝
      } else if (ticket.assigneeId === msg.senderId) {
        roleTag = '接单工程师';
        roleColor = '059669'; // 绿
      } else if (ticket.participants?.some((p) => p.id === msg.senderId)) {
        roleTag = '协助专家';
        roleColor = '7c3aed'; // 紫
      } else if (
        msg.sender?.role?.name === 'external' ||
        (typeof msg.senderId === 'string' &&
          String(msg.senderId).startsWith('ext-'))
      ) {
        roleTag = '外部';
        roleColor = 'd97706'; // 橙
      } else {
        roleTag = '内部';
        roleColor = '6366f1'; // 靛蓝
      }

      // 发送者头信息
      docChildren.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `【${senderName}`,
              bold: true,
              size: 20,
              color: roleColor,
              font: 'Microsoft YaHei',
            }),
            new TextRun({
              text: ` · ${roleTag}`,
              bold: true,
              size: 18,
              color: '888888',
              font: 'Microsoft YaHei',
            }),
            new TextRun({
              text: `】 ${timeStr}`,
              size: 18,
              color: '888888',
              font: 'Microsoft YaHei',
            }),
          ],
          spacing: { before: 160, after: 40 },
        }),
      );

      // 尝试嵌入图片
      let imageEmbedded = false;
      if (
        msg.type === 'image' ||
        (msg.content && msg.content.includes('/api/files/static/'))
      ) {
        const urlMatch = msg.content.match(/\/api\/files\/static\/([^\)\s]+)/);
        if (urlMatch) {
          const filename = urlMatch[1];
          try {
            const imgBuffer = await this.filesService.getFileBuffer(filename);
            const dimensions = sizeOf(imgBuffer);
            const rawW = dimensions.width || 400;
            const rawH = dimensions.height || 300;

            let rotation = 0;
            let isSwapped = false;
            if (dimensions.orientation === 6) {
              rotation = 90;
              isSwapped = true;
            } else if (dimensions.orientation === 8) {
              rotation = 270;
              isSwapped = true;
            } else if (dimensions.orientation === 3) {
              rotation = 180;
            }

            let visualW = isSwapped ? rawH : rawW;
            let visualH = isSwapped ? rawW : rawH;

            if (visualW > 500) {
              visualH = Math.floor(visualH * (500 / visualW));
              visualW = 500;
            }

            const configW = isSwapped ? visualH : visualW;
            const configH = isSwapped ? visualW : visualH;

            const imgType =
              dimensions.type === 'jpg' ? 'jpeg' : dimensions.type || 'png';

            const imgConfig: any = {
              data: imgBuffer,
              transformation: { width: configW, height: configH },
              type: imgType,
            };
            if (rotation !== 0) {
              imgConfig.transformation.rotation = rotation;
            }

            docChildren.push(
              new Paragraph({
                children: [new ImageRun(imgConfig)],
                spacing: { after: 80 },
              }),
            );
            imageEmbedded = true;
          } catch {
            // 图片嵌入失败，降级为文本
          }
        }
      }

      // 文本内容
      if (!imageEmbedded) {
        // 角色对应的浅色底色
        const shadingMap: Record<string, string> = {
          申请人: 'EBF5FF', // 浅蓝
          接单工程师: 'F0FDF4', // 浅绿
          协助专家: 'F5F3FF', // 浅紫
          外部: 'FFF7ED', // 浅橙
          内部: 'EEF2FF', // 浅靛蓝
        };
        const fillColor = shadingMap[roleTag] || 'F5F5F5';
        const lines = msg.content.split('\n');

        docChildren.push(
          new Table({
            width: { size: 100, type: WidthType.AUTO },
            borders: {
              top: { style: BorderStyle.SINGLE, size: 4, color: 'E5E7EB' },
              bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E5E7EB' },
              left: { style: BorderStyle.SINGLE, size: 4, color: 'E5E7EB' },
              right: { style: BorderStyle.SINGLE, size: 4, color: 'E5E7EB' },
            },
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    shading: { fill: fillColor, type: ShadingType.CLEAR },
                    margins: { top: 100, bottom: 100, left: 150, right: 150 },
                    children: lines.map(
                      (line: string) =>
                        new Paragraph({
                          children: [
                            new TextRun({
                              text: line,
                              size: 20,
                              font: 'Microsoft YaHei',
                            }),
                          ],
                          spacing: { after: 0, before: 0, line: 300 },
                        }),
                    ),
                  }),
                ],
              }),
            ],
          }),
        );

        // 空白间距
        docChildren.push(new Paragraph({ spacing: { after: 80 } }));
      }
    }

    // ── 页脚 ──
    docChildren.push(new Paragraph({ text: '' }));
    docChildren.push(
      new Paragraph({
        children: [
          new TextRun({ text: '─'.repeat(60), color: 'CCCCCC', size: 16 }),
        ],
        alignment: AlignmentType.CENTER,
      }),
    );
    docChildren.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `本报告由 CallCenter 系统自动生成 · ${new Date().toLocaleString('zh-CN')}`,
            color: '999999',
            size: 16,
            italics: true,
            font: 'Microsoft YaHei',
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { before: 40 },
      }),
    );

    // ── 生成 DOCX ──
    const docxDoc = new Document({
      sections: [
        {
          properties: {},
          children: docChildren,
        },
      ],
    });

    const safeName = `${ticket.ticketNo}_处理报告`;
    const docxBuffer = await Packer.toBuffer(docxDoc);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(safeName)}.docx"`,
    );
    res.end(docxBuffer);
  }
}
