import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Input, Button, Space, Typography, Spin, Empty, List, Popconfirm,
  message, Tag,
} from 'antd';
import {
  SendOutlined, PlusOutlined, DeleteOutlined,
  RobotOutlined, UserOutlined, LoadingOutlined,
  MessageOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import { aiAPI } from '../../../services/api';

const { Text, Paragraph } = Typography;

interface ChatMessage {
  id?: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: any;
  createdAt?: string;
}

interface ChatSession {
  id: string;
  title: string;
  updatedAt: string;
}

interface Props {
  /** Callback when a task is created from chat */
  onTaskCreated?: (taskId: string) => void;
}

const AiChatPanel: React.FC<Props> = ({ onTaskCreated }) => {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [streaming, setStreaming] = useState('');
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load sessions
  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const res: any = await aiAPI.chatSessions();
      setSessions(res?.data ?? []);
    } catch { /* ignore */ }
    finally { setSessionsLoading(false); }
  }, []);

  // Load session messages
  const loadSession = useCallback(async (sessionId: string) => {
    try {
      const res: any = await aiAPI.chatSessionDetail(sessionId);
      setMessages(res?.data?.messages ?? []);
      setActiveSessionId(sessionId);
    } catch {
      message.error('加载会话失败');
    }
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  // Send message with SSE streaming
  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;

    setInput('');
    setSending(true);
    setStreaming('');

    // Optimistically add user message
    const userMsg: ChatMessage = { role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const response = await aiAPI.chatStream({
        sessionId: activeSessionId,
        message: text,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let newSessionId = activeSessionId;

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          // SSE format: "data: {...}\n\n"
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data.sessionId && !activeSessionId) {
                newSessionId = data.sessionId;
              }
              if (data.type === 'text') {
                fullText += data.content;
                setStreaming(fullText);
              } else if (data.type === 'task_created') {
                if (data.taskId && onTaskCreated) {
                  onTaskCreated(data.taskId);
                }
                message.success(`🚀 AI 任务已创建 (${data.taskId})`);
              } else if (data.type === 'error') {
                message.error(data.content);
              }
            } catch { /* partial JSON, skip */ }
          }
        }
      }

      // Add final assistant message
      if (fullText) {
        setMessages((prev) => [...prev, { role: 'assistant', content: fullText }]);
      }
      setStreaming('');

      // Update session
      if (newSessionId) {
        setActiveSessionId(newSessionId);
        loadSessions(); // Refresh session list
      }
    } catch (err: any) {
      message.error('发送失败: ' + err.message);
    } finally {
      setSending(false);
    }
  };

  // New conversation
  const handleNewChat = () => {
    setActiveSessionId(undefined);
    setMessages([]);
    setInput('');
  };

  // Delete session
  const handleDelete = async (sessionId: string) => {
    try {
      await aiAPI.deleteChatSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (activeSessionId === sessionId) {
        handleNewChat();
      }
      message.success('会话已删除');
    } catch {
      message.error('删除失败');
    }
  };

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 500, gap: 0 }}>
      {/* Left: Session List */}
      <div
        style={{
          width: 220,
          borderRight: '1px solid var(--border, #e5e7eb)',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-secondary, #fafafa)',
        }}
      >
        <div style={{ padding: '12px', borderBottom: '1px solid var(--border, #e5e7eb)' }}>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            block
            onClick={handleNewChat}
            style={{ borderRadius: 8 }}
          >
            新对话
          </Button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '4px 8px' }}>
          {sessionsLoading ? (
            <div style={{ textAlign: 'center', padding: 20 }}><Spin size="small" /></div>
          ) : sessions.length === 0 ? (
            <Empty description="暂无对话" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            <List
              dataSource={sessions}
              renderItem={(s) => (
                <div
                  key={s.id}
                  onClick={() => loadSession(s.id)}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    marginBottom: 2,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: activeSessionId === s.id ? 'var(--primary-bg, #e6f4ff)' : 'transparent',
                    transition: 'background 0.2s',
                  }}
                >
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <Text ellipsis style={{ fontSize: 13, display: 'block' }}>
                      <MessageOutlined style={{ marginRight: 6, color: '#8b5cf6' }} />
                      {s.title}
                    </Text>
                  </div>
                  <Popconfirm
                    title="确定删除此会话？"
                    onConfirm={(e) => { e?.stopPropagation(); handleDelete(s.id); }}
                    onCancel={(e) => e?.stopPropagation()}
                  >
                    <DeleteOutlined
                      style={{ color: '#ccc', fontSize: 12, marginLeft: 4 }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </Popconfirm>
                </div>
              )}
            />
          )}
        </div>
      </div>

      {/* Right: Chat Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* Messages */}
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '16px 20px',
            background: 'var(--bg-primary, #fff)',
          }}
        >
          {messages.length === 0 && !streaming ? (
            <div style={{ textAlign: 'center', padding: '60px 20px' }}>
              <RobotOutlined style={{ fontSize: 48, color: '#d1d5db', marginBottom: 16 }} />
              <div style={{ color: '#9ca3af', fontSize: 15 }}>
                你好！我是 AI 助手。
              </div>
              <div style={{ color: '#d1d5db', fontSize: 13, marginTop: 8 }}>
                你可以问我任何问题，或让我帮你生成 PPT、文档等
              </div>
            </div>
          ) : (
            <>
              {messages.map((m, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
                    marginBottom: 16,
                  }}
                >
                  <div
                    style={{
                      maxWidth: '75%',
                      padding: '10px 14px',
                      borderRadius: m.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                      background: m.role === 'user'
                        ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
                        : '#f3f4f6',
                      color: m.role === 'user' ? '#fff' : '#1f2937',
                      fontSize: 14,
                      lineHeight: '22px',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    <div style={{ marginBottom: 4, fontSize: 11, opacity: 0.7 }}>
                      {m.role === 'user' ? (
                        <><UserOutlined /> 我</>
                      ) : (
                        <><RobotOutlined /> AI 助手</>
                      )}
                    </div>
                    {m.content}
                    {m.metadata?.intent === 'create_task' && (
                      <Tag color="purple" style={{ marginTop: 6 }}>
                        <ThunderboltOutlined /> 已调度任务
                      </Tag>
                    )}
                  </div>
                </div>
              ))}
              {/* Streaming indicator */}
              {streaming && (
                <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 16 }}>
                  <div
                    style={{
                      maxWidth: '75%',
                      padding: '10px 14px',
                      borderRadius: '16px 16px 16px 4px',
                      background: '#f3f4f6',
                      color: '#1f2937',
                      fontSize: 14,
                      lineHeight: '22px',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    <div style={{ marginBottom: 4, fontSize: 11, opacity: 0.7 }}>
                      <RobotOutlined /> AI 助手 <LoadingOutlined spin style={{ marginLeft: 4 }} />
                    </div>
                    {streaming}
                    <span style={{ animation: 'blink 1s infinite' }}>▍</span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* Input */}
        <div
          style={{
            borderTop: '1px solid var(--border, #e5e7eb)',
            padding: '12px 16px',
            background: 'var(--bg-secondary, #fafafa)',
          }}
        >
          <Space.Compact style={{ width: '100%' }}>
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPressEnter={handleSend}
              placeholder="输入消息... (Enter 发送)"
              disabled={sending}
              style={{ borderRadius: '8px 0 0 8px' }}
              size="large"
            />
            <Button
              type="primary"
              icon={sending ? <LoadingOutlined spin /> : <SendOutlined />}
              onClick={handleSend}
              disabled={!input.trim() || sending}
              size="large"
              style={{ borderRadius: '0 8px 8px 0' }}
            />
          </Space.Compact>
          <div style={{ marginTop: 6, fontSize: 11, color: '#9ca3af' }}>
            Powered by Gemini 3.1 Flash · 简单问答秒回，复杂任务自动调度 Codex
          </div>
        </div>
      </div>
    </div>
  );
};

export default AiChatPanel;
