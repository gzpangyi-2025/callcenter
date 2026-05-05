import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Button, Typography, Spin, Empty, List, Popconfirm,
  message,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined,
  RobotOutlined, UserOutlined, LoadingOutlined,
  MessageOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import { aiAPI } from '../../../services/api';
import ChatInputBar from '../../Tickets/ChatInputBar';

const { Text } = Typography;

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
  tasks?: any[];
  onViewTaskDetail?: (task: any) => void;
}

const AiChatPanel: React.FC<Props> = ({ onTaskCreated, tasks = [], onViewTaskDetail }) => {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [streaming, setStreaming] = useState('');
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [enterToNewline, setEnterToNewline] = useState(
    localStorage.getItem('aiChatEnterToNewline') === 'true'
  );
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isComposing = useRef(false);

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

  // Auto-focus after sending
  useEffect(() => {
    if (!sending) {
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 50);
    }
  }, [sending]);

  // Monitor task completions to inject response.md
  useEffect(() => {
    if (!tasks || tasks.length === 0 || !activeSessionId || messages.length === 0) return;

    const messageTaskIds = messages
      .filter((m) => m.metadata?.intent === 'create_task' && m.metadata?.taskId)
      .map((m) => m.metadata.taskId);

    for (const taskId of messageTaskIds) {
      const task = tasks.find((t) => t.id === taskId);
      if (task && task.status === 'completed') {
        const hasFeedback = messages.some((m) => m.metadata?.responseForTask === taskId);
        if (!hasFeedback) {
          injectFeedbackMessage(task);
        }
      }
    }
  }, [tasks, messages, activeSessionId]);

  const injectFeedbackMessage = async (task: any) => {
    try {
      const filesRes: any = await aiAPI.getTaskFiles(task.id);
      const files = filesRes.data || [];
      const responseMd = files.find((f: any) => f.name === 'response.md' || f.name.endsWith('response.md'));
      let feedbackContent = '';
      if (responseMd && responseMd.url) {
        const res = await fetch(responseMd.url);
        feedbackContent = await res.text();
      } else {
        feedbackContent = '任务已执行完成。';
      }

      const content = `【Codex 执行反馈】\n\n${feedbackContent}`;
      const injectRes: any = await aiAPI.injectChatMessage(activeSessionId!, {
        role: 'assistant',
        content,
        metadata: { responseForTask: task.id },
      });
      
      setMessages((prev) => [...prev, injectRes.data]);
    } catch (err) {
      console.error('Failed to inject feedback message:', err);
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = error => reject(error);
    });
  };

  // Send message with SSE streaming
  const handleSend = async () => {
    const text = input.trim();
    if ((!text && pendingFiles.length === 0) || sending) return;

    setInput('');
    const currentFiles = [...pendingFiles];
    setPendingFiles([]);
    setSending(true);
    setStreaming('');

    // Optimistically add user message
    let displayContent = text;
    if (currentFiles.length > 0) {
      displayContent += (displayContent ? '\n\n' : '') + `[已附加 ${currentFiles.length} 个文件]`;
    }

    const userMsg: ChatMessage = { role: 'user', content: displayContent };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const images: string[] = [];
      for (const file of currentFiles) {
        if (file.type.startsWith('image/')) {
          images.push(await fileToBase64(file));
        }
      }

      const response = await aiAPI.chatStream({
        sessionId: activeSessionId,
        message: text,
        images,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let errorText = '';
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
                // Show error as an assistant message in the chat
                errorText = data.content;
              }
            } catch { /* partial JSON, skip */ }
          }
        }
      }

      // Add final assistant message
      const displayText = fullText || (errorText ? `⚠️ ${errorText}` : '');
      if (displayText) {
        setMessages((prev) => [...prev, { role: 'assistant', content: displayText }]);
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isComposing.current) return;
    
    if (enterToNewline) {
      if (e.key === 'Enter' && e.ctrlKey) {
        e.preventDefault();
        handleSend();
      }
    } else {
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
        e.preventDefault();
        handleSend();
      } else if (e.key === 'Enter' && e.ctrlKey) {
        e.preventDefault();
        setInput(prev => prev + '\n');
      }
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) setPendingFiles(prev => [...prev, file]);
      }
    }
  };

  return (
    <div style={{ display: 'flex', height: '100%', width: '100%', minHeight: 0, gap: 0 }}>
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
                    }}
                  >
                    <div style={{ marginBottom: 4, fontSize: 11, opacity: 0.7 }}>
                      {m.role === 'user' ? (
                        <><UserOutlined /> 我</>
                      ) : (
                        <><RobotOutlined /> AI 助手</>
                      )}
                    </div>
                    <pre
                      style={{
                        whiteSpace: 'pre-wrap',
                        fontFamily: 'inherit',
                        margin: 0,
                        wordBreak: 'break-word',
                      }}
                    >
                      {m.content}
                    </pre>

                    {/* Task Card Injection */}
                    {m.metadata?.intent === 'create_task' && m.metadata?.taskId && (
                      <div style={{ marginTop: 12, padding: 12, background: 'var(--bg-secondary, #fafafa)', borderRadius: 8, border: '1px solid var(--border, #e5e7eb)' }}>
                        <Text strong style={{ display: 'block', marginBottom: 8 }}><ThunderboltOutlined /> 任务进度</Text>
                        {(() => {
                          const task = tasks?.find(t => t.id === m.metadata.taskId);
                          if (!task) return <Text type="secondary">正在拉取任务状态...</Text>;
                          
                          if (task.status === 'pending' || task.status === 'running') {
                            return (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <Spin size="small" />
                                <Text type="secondary">Codex 正在处理中: {task.progress}% - {task.currentStep || '执行中'}</Text>
                              </div>
                            );
                          }
                          if (task.status === 'completed') {
                            return (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                                <Text type="success" style={{ color: '#52c41a' }}>✓ 任务已完成</Text>
                                {onViewTaskDetail && (
                                  <Button size="small" type="primary" ghost onClick={() => onViewTaskDetail(task)}>查看产物</Button>
                                )}
                              </div>
                            );
                          }
                          if (task.status === 'failed') {
                            return <Text type="danger" style={{ color: '#ff4d4f' }}>✗ 任务失败: {task.errorMessage}</Text>;
                          }
                          return <Text type="secondary">状态: {task.status}</Text>;
                        })()}
                      </div>
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
            background: 'var(--bg-secondary, #fafafa)',
          }}
        >
          <ChatInputBar
            inputValue={input}
            setInputValue={setInput}
            pendingFiles={pendingFiles}
            setPendingFiles={setPendingFiles}
            uploading={sending}
            isMobile={false}
            enterToNewline={enterToNewline}
            setEnterToNewline={(v) => {
              setEnterToNewline(v);
              localStorage.setItem('aiChatEnterToNewline', String(v));
            }}
            textareaRef={textareaRef}
            onSendMessage={handleSend}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onCompositionStart={() => { isComposing.current = true; }}
            onCompositionEnd={() => { isComposing.current = false; }}
          />
          <div style={{ padding: '0 16px 8px', fontSize: 11, color: '#9ca3af', textAlign: 'center' }}>
            Powered by Gemini 3.1 Flash · 简单问答秒回，复杂任务自动调度 Codex
          </div>
        </div>
      </div>
    </div>
  );
};

export default AiChatPanel;
