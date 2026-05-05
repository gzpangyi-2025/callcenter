// ─────────────────────────────────────────────────────────────────────────────
//  AI Chat Service — Gemini 3.1 Flash dispatcher for conversational AI
// ─────────────────────────────────────────────────────────────────────────────
import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GoogleGenerativeAI } from '@google/generative-ai';

import { AiChatSession } from '../../entities/ai-chat-session.entity';
import { AiChatMessage } from '../../entities/ai-chat-message.entity';
import { SettingsService } from '../settings/settings.service';
import { AiService } from './ai.service';
import { Response } from 'express';

interface ChatRequest {
  sessionId?: string;
  message: string;
  userId: number;
  images?: string[];
}

interface ChatStreamChunk {
  type: 'text' | 'task_created' | 'done' | 'error' | 'title_update';
  content: string;
  taskId?: string;
  sessionId?: string;
}

@Injectable()
export class AiChatService {
  private readonly logger = new Logger(AiChatService.name);

  constructor(
    @InjectRepository(AiChatSession)
    private readonly sessionRepo: Repository<AiChatSession>,
    @InjectRepository(AiChatMessage)
    private readonly messageRepo: Repository<AiChatMessage>,
    private readonly settingsService: SettingsService,
    private readonly aiService: AiService,
  ) {}

  // ── Chat (SSE streaming) ──────────────────────────────────────────────────

  async chatStream(req: ChatRequest, res: Response) {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    const send = (chunk: ChatStreamChunk) => {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    };

    try {
      // 1. Resolve or create session
      let session: AiChatSession;
      if (req.sessionId) {
        const existing = await this.sessionRepo.findOne({
          where: { id: req.sessionId, userId: req.userId },
        });
        if (!existing) throw new BadRequestException('会话不存在');
        session = existing;
      } else {
        session = this.sessionRepo.create({
          userId: req.userId,
          title: req.message.substring(0, 50) + (req.message.length > 50 ? '...' : ''),
        });
        session = await this.sessionRepo.save(session);
      }

      send({ type: 'text', content: '', sessionId: session.id });

      // 2. Save user message
      await this.messageRepo.save(
        this.messageRepo.create({
          sessionId: session.id,
          role: 'user',
          content: req.message,
        }),
      );

      // 3. Load conversation history (last 20 messages for context window)
      const history = await this.messageRepo.find({
        where: { sessionId: session.id },
        order: { createdAt: 'DESC' },
        take: 20,
      });
      history.reverse(); // Reverse back to chronological order

      // 4. Get API key and model from settings
      const settings = await this.settingsService.getAll();
      const apiKey = settings['ai.chatApiKey'] || settings['ai.visionApiKey'];
      const modelName = settings['ai.chatModel'] || 'gemini-3.1-flash';

      if (!apiKey) {
        send({ type: 'error', content: '未配置 AI Chat API Key，请在管理后台 → AI 设置中配置。' });
        send({ type: 'done', content: '' });
        res.end();
        return;
      }

      // 5. Build Gemini conversation
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: this.buildSystemPrompt(settings),
      });

      // Convert history to Gemini format
      const geminiHistory = history
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role === 'assistant' ? 'model' as const : 'user' as const,
          parts: [{ text: m.content }],
        }));

      // Remove the last user message from history (it will be sent as the current turn)
      const currentMessage = geminiHistory.pop();

      const chat = model.startChat({
        history: geminiHistory,
      });

      // 6. Stream response
      const messageParts: any[] = [{ text: currentMessage?.parts?.[0]?.text ?? req.message }];

      if (req.images && req.images.length > 0) {
        for (const base64Image of req.images) {
          // base64Image is typically "data:image/png;base64,iVBORw0K..."
          const match = base64Image.match(/^data:(image\/\w+);base64,(.*)$/);
          if (match) {
            messageParts.push({
              inlineData: {
                mimeType: match[1],
                data: match[2],
              },
            });
          }
        }
      }

      const result = await chat.sendMessageStream(messageParts);

      let fullResponse = '';
      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) {
          fullResponse += text;
          send({ type: 'text', content: text });
        }
      }

      // 7. Check if response contains task dispatch instructions
      let dispatchedTaskId: string | undefined;
      const taskMatch = fullResponse.match(/\[DISPATCH_TASK\]([\s\S]*?)\[\/DISPATCH_TASK\]/);
      if (taskMatch) {
        try {
          const taskInstruction = JSON.parse(taskMatch[1].trim());
          const taskResult = await this.aiService.createTask(
            {
              type: taskInstruction.type || 'custom',
              params: taskInstruction.params || {},
              prompt: taskInstruction.prompt,
            },
            req.userId,
          );
          const taskId = taskResult?.data?.id || taskResult?.id;
          if (taskId) {
            dispatchedTaskId = taskId;
            // Link task to session
            const linkedIds = session.linkedTaskIds
              ? session.linkedTaskIds.split(',')
              : [];
            linkedIds.push(taskId);
            session.linkedTaskIds = linkedIds.join(',');
            await this.sessionRepo.save(session);

            send({ type: 'task_created', content: `任务已创建`, taskId });
          }
        } catch (err: any) {
          this.logger.error(`Task dispatch failed: ${err.message}`);
          send({ type: 'text', content: `\n\n⚠️ 任务创建失败: ${err.message}` });
        }
      }

      // 8. Save assistant message (strip dispatch tags for display)
      const cleanResponse = fullResponse.replace(
        /\[DISPATCH_TASK\][\s\S]*?\[\/DISPATCH_TASK\]/g,
        '',
      ).trim();
      await this.messageRepo.save(
        this.messageRepo.create({
          sessionId: session.id,
          role: 'assistant',
          content: cleanResponse || fullResponse,
          metadata: taskMatch ? { intent: 'create_task', taskId: dispatchedTaskId } : { intent: 'chat' },
        }),
      );

      // 9. Auto-generate title for new sessions (first message)
      if (!req.sessionId && history.length <= 1) {
        this.generateTitle(session.id, req.message, cleanResponse, apiKey, modelName).catch(
          (e) => this.logger.warn(`Title gen failed: ${e}`),
        );
      }

      send({ type: 'done', content: '', sessionId: session.id });
    } catch (err: any) {
      this.logger.error(`Chat stream error: ${err.message}`);
      send({ type: 'error', content: `AI 服务出错: ${err.message}` });
    } finally {
      res.end();
    }
  }

  // ── Session Management ────────────────────────────────────────────────────

  async listSessions(userId: number) {
    return this.sessionRepo.find({
      where: { userId },
      order: { updatedAt: 'DESC' },
      take: 50,
    });
  }

  async getSession(sessionId: string, userId: number) {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId, userId },
    });
    if (!session) throw new BadRequestException('会话不存在');

    const messages = await this.messageRepo.find({
      where: { sessionId },
      order: { createdAt: 'ASC' },
    });

    return { ...session, messages };
  }

  async deleteSession(sessionId: string, userId: number) {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId, userId },
    });
    if (!session) throw new BadRequestException('会话不存在');
    await this.sessionRepo.remove(session);
  }

  // ── Private Helpers ───────────────────────────────────────────────────────

  async injectMessage(
    sessionId: string,
    userId: number,
    role: 'assistant' | 'system',
    content: string,
    metadata?: any,
  ) {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId, userId },
    });
    if (!session) {
      throw new NotFoundException('Session not found');
    }

    const message = this.messageRepo.create({
      sessionId,
      role,
      content,
      metadata,
    });
    
    // Update session timestamp
    session.updatedAt = new Date();
    await this.sessionRepo.save(session);
    
    return this.messageRepo.save(message);
  }

  private buildSystemPrompt(settings: Record<string, string>): string {
    const customPrompt = settings['ai.systemPrompt'] || '';
    return `你是 CallCenter 系统的智能 AI 助手。你可以帮助用户完成以下任务：

1. **快速问答**：回答用户的各种问题，不仅限于技术或运维，可包含任何领域。
2. **任务调度**：当用户明确要求 AI 生成文件、PPT、文档、代码项目等复杂任务时，你可以调度 Codex Worker 来执行。
3. **任务迭代**：用户可以针对已完成的任务提出修改意见，你会帮助组装修改指令。

## 任务调度规则
【极其重要】当且仅当用户明确发出指令（例如：“帮我生成一份文档”、“写一段XX代码并创建任务”）时，才在回复末尾附上以下调度标签。
如果用户只是和你聊天、探讨方案、或者明确表示“不执行/不需要”，你必须只用文本回答，【绝不能】输出 DISPATCH_TASK 标签。

【中转与记忆】如果上下文中包含“Codex 反馈”或“任务已完成”的系统提示，这意味着后台工作流已返回了草稿、大纲或提问。当用户确认或修改后，**你必须把之前的草稿大纲和用户的修改意见一并打包，写在新的 DISPATCH_TASK 的 prompt 里发给 Codex**，因为 Codex 每次执行都是无状态的，必须由你来传递上下文。

调度标签格式：
\`\`\`
[DISPATCH_TASK]
{
  "type": "generate_ppt",
  "prompt": "用户的完整需求描述...",
  "params": {}
}
[/DISPATCH_TASK]
\`\`\`

type 可选值：generate_ppt, generate_code, generate_doc, custom
如果是修改已有任务的产物，在 prompt 中说明基于哪个任务进行修改。

## 重要规则
- 对于简单问答，直接回答，不要使用 DISPATCH_TASK 标签
- 回答使用中文
- 保持专业、简洁

${customPrompt ? `\n## 用户自定义预设\n${customPrompt}` : ''}`;
  }

  /**
   * Auto-generate a short title for a new session using Flash.
   */
  private async generateTitle(
    sessionId: string,
    userMsg: string,
    assistantMsg: string,
    apiKey: string,
    modelName: string,
  ) {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: modelName });
    const result = await model.generateContent(
      `请为以下对话生成一个简短的中文标题（10字以内，不需要引号）：\n用户：${userMsg.substring(0, 100)}\n助手：${assistantMsg.substring(0, 200)}`,
    );
    const title = result.response.text().trim().substring(0, 50);
    if (title) {
      await this.sessionRepo.update(sessionId, { title });
    }
  }
}
