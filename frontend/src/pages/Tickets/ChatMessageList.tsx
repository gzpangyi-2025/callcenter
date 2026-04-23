import React from 'react';
import { Avatar, Tag, Image, Tooltip, Popconfirm, Spin } from 'antd';
import {
  CheckOutlined, UndoOutlined, ClockCircleOutlined, CopyOutlined,
  FileWordOutlined, FileExcelOutlined, FilePptOutlined,
  FilePdfOutlined, FileTextOutlined, FileMarkdownOutlined,
  FileZipOutlined, FileUnknownOutlined, CodeOutlined,
} from '@ant-design/icons';

// 文件类型图标映射
export const getFileIcon = (fileName: string) => {
  const ext = (fileName || '').split('.').pop()?.toLowerCase() || '';
  const iconMap: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
    doc:  { icon: <FileWordOutlined />, color: '#2b579a', label: 'Word' },
    docx: { icon: <FileWordOutlined />, color: '#2b579a', label: 'Word' },
    xls:  { icon: <FileExcelOutlined />, color: '#217346', label: 'Excel' },
    xlsx: { icon: <FileExcelOutlined />, color: '#217346', label: 'Excel' },
    ppt:  { icon: <FilePptOutlined />, color: '#d24726', label: 'PPT' },
    pptx: { icon: <FilePptOutlined />, color: '#d24726', label: 'PPT' },
    pdf:  { icon: <FilePdfOutlined />, color: '#e5252a', label: 'PDF' },
    md:   { icon: <FileMarkdownOutlined />, color: '#083fa1', label: 'Markdown' },
    txt:  { icon: <FileTextOutlined />, color: '#64748b', label: 'Text' },
    log:  { icon: <FileTextOutlined />, color: '#64748b', label: 'Log' },
    sh:   { icon: <CodeOutlined />, color: '#4ade80', label: 'Shell' },
    bat:  { icon: <CodeOutlined />, color: '#4ade80', label: 'Script' },
    py:   { icon: <CodeOutlined />, color: '#3776ab', label: 'Python' },
    js:   { icon: <CodeOutlined />, color: '#f7df1e', label: 'JavaScript' },
    ts:   { icon: <CodeOutlined />, color: '#3178c6', label: 'TypeScript' },
    html: { icon: <CodeOutlined />, color: '#e34f26', label: 'HTML' },
    css:  { icon: <CodeOutlined />, color: '#1572b6', label: 'CSS' },
    json: { icon: <CodeOutlined />, color: '#f59e0b', label: 'JSON' },
    xml:  { icon: <CodeOutlined />, color: '#f59e0b', label: 'XML' },
    zip:  { icon: <FileZipOutlined />, color: '#f59e0b', label: 'ZIP' },
    rar:  { icon: <FileZipOutlined />, color: '#f59e0b', label: 'RAR' },
    '7z': { icon: <FileZipOutlined />, color: '#f59e0b', label: '7Z' },
    tar:  { icon: <FileZipOutlined />, color: '#f59e0b', label: 'TAR' },
    gz:   { icon: <FileZipOutlined />, color: '#f59e0b', label: 'GZ' },
  };
  return iconMap[ext] || { icon: <FileUnknownOutlined />, color: '#64748b', label: ext.toUpperCase() || 'FILE' };
};

export const formatFileSize = (bytes: number): string => {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
};

interface ChatMessageListProps {
  messages: any[];
  user: any;
  isMobile: boolean;
  initialChatLoading: boolean;
  hasMoreHistory: boolean;
  loadingHistory: boolean;
  copiedMessageId: number | null;
  chatMessagesRef: React.RefObject<HTMLDivElement>;
  onChatScroll: () => void;
  onLoadMoreHistory: () => void;
  onRecall: (msgId: number) => void;
  onCopyMessage: (msgId: number, text: string) => void;
}

const ChatMessageList: React.FC<ChatMessageListProps> = ({
  messages,
  user,
  isMobile,
  initialChatLoading,
  hasMoreHistory,
  loadingHistory,
  copiedMessageId,
  chatMessagesRef,
  onChatScroll,
  onLoadMoreHistory,
  onRecall,
  onCopyMessage,
}) => {
  return (
    <div 
      className="chat-body chat-messages" 
      ref={chatMessagesRef}
      onScroll={onChatScroll}
      style={{ flex: 1, minWidth: 0, overflowY: 'auto', overflowX: 'hidden', flexDirection: 'column', position: 'relative' }}
    >
      {initialChatLoading && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', background: 'var(--bg-panel)', zIndex: 10 }}>
          <Spin size="large" />
          <div style={{ marginTop: 16, color: 'var(--text-secondary)' }}>正在加载通信协议...</div>
        </div>
      )}

      {/* 上滑分页加载更多 */}
      {hasMoreHistory && messages.length > 0 && !initialChatLoading && (
        <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--text-secondary)', fontSize: 13 }}>
          <button
            onClick={onLoadMoreHistory}
            disabled={loadingHistory}
            style={{ 
              color: 'var(--text-secondary)', background: 'transparent', border: 'none', 
              cursor: loadingHistory ? 'not-allowed' : 'pointer', fontSize: 13 
            }}
          >
            <ClockCircleOutlined style={{ marginRight: 4 }} /> 点击查看更早的记录
          </button>
        </div>
      )}

      {messages.map((msg: any, index: number) => {
        const displayName = msg.sender?.realName || msg.sender?.displayName || msg.senderName || '未知用户';
        const isMe = msg.sender?.id === user?.id || (user?.role?.name === 'external' && !msg.sender && msg.senderName === user?.username);
        const isExternal = !msg.sender && msg.senderName;
        const canRecall = isMe && !msg.isRecalled && msg.type !== 'system'
          && (Date.now() - new Date(msg.createdAt).getTime()) < 10 * 60 * 1000;
          
        return (
          <div key={msg.id} className={`chat-message ${isMe ? 'self' : ''}`} style={{ 
            paddingLeft: isMobile ? 12 : 16, 
            paddingRight: isMobile ? 12 : 16,
            paddingTop: index === 0 ? (isMobile ? 12 : 16) : 0,
            paddingBottom: index === messages.length - 1 ? (isMobile ? 12 : 16) : 0 
          }}>
            {!isMobile && (
              <Avatar style={{ background: isMe ? '#4f46e5' : isExternal ? '#f59e0b' : '#64748b', flexShrink: 0 }} size={36}>
                {displayName[0]?.toUpperCase() || '?'}
              </Avatar>
            )}
            <div className="chat-bubble-wrap">
              <div className="chat-meta">
                {displayName}{isExternal && <Tag color="orange" style={{ marginLeft: 4, fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>外部</Tag>}
                <span style={{ marginLeft: 8 }}>{new Date(msg.createdAt).toLocaleTimeString('zh-CN')}</span>
              </div>
              {msg.isRecalled ? (
                <div className="chat-bubble" style={{ opacity: 0.5, fontStyle: 'italic', fontSize: 12 }}>
                  <UndoOutlined style={{ marginRight: 4 }} />该消息已被撤回
                </div>
              ) : (
                <>
                  <div className={`chat-bubble ${['image', 'file'].includes(msg.type) ? 'transparent-bubble' : ''}`}>
                    {msg.type === 'image' ? (
                      <div className="chat-image-wrap">
                        <Image
                          src={msg.fileUrl}
                          alt={msg.fileName}
                          style={{ maxWidth: isMobile ? 200 : 300, maxHeight: 260, borderRadius: 8, cursor: 'pointer' }}
                          preview={{ mask: '点击预览' }}
                          fallback="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjEyMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjEyMCIgZmlsbD0iIzMzNDE1NSIvPjx0ZXh0IHg9IjEwMCIgeT0iNjAiIGZvbnQtc2l6ZT0iMTQiIGZpbGw9IiM5NGEzYjgiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGRvbWluYW50LWJhc2VsaW5lPSJtaWRkbGUiPuWbvueJh+WKoOi9veWksei0pTwvdGV4dD48L3N2Zz4="
                        />
                        {msg.fileName && (
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{msg.fileName}</div>
                        )}
                      </div>
                    ) : msg.type === 'file' ? (
                      <a href={`/api/files/download/${(msg.fileUrl || '').split('/').pop()}?name=${encodeURIComponent(msg.fileName || '')}&token=${localStorage.getItem('accessToken') || ''}`}
                        target="_blank" rel="noopener noreferrer" className="chat-file-card">
                        {(() => {
                          const fi = getFileIcon(msg.fileName);
                          return (
                            <>
                              <div className="file-icon" style={{ color: fi.color }}>{fi.icon}</div>
                              <div className="file-info">
                                <div className="file-name">{msg.fileName || '未知文件'}</div>
                                <div className="file-meta">
                                  <span className="file-type-badge" style={{ background: fi.color + '20', color: fi.color }}>{fi.label}</span>
                                  {msg.fileSize > 0 && <span>{formatFileSize(msg.fileSize)}</span>}
                                </div>
                              </div>
                            </>
                          );
                        })()}
                      </a>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexDirection: isMe ? 'row-reverse' : 'row' }}>
                        <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.content}</span>
                        <Tooltip title={copiedMessageId === msg.id ? "已复制" : "复制"}>
                          {copiedMessageId === msg.id ? (
                            <CheckOutlined style={{ color: '#52c41a', fontSize: 13 }} />
                          ) : (
                            <CopyOutlined 
                              style={{ cursor: 'pointer', opacity: 0.5, fontSize: 13 }}
                              onClick={() => onCopyMessage(msg.id, msg.content)}
                            />
                          )}
                        </Tooltip>
                      </div>
                    )}
                  </div>
                  {canRecall && (
                    <Popconfirm title="确定撤回这条消息？" onConfirm={() => onRecall(msg.id)} okText="撤回" cancelText="取消" placement={isMe ? 'left' : 'right'}>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer', marginTop: 2, display: 'inline-block' }}
                        className="recall-link">撤回</span>
                    </Popconfirm>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default ChatMessageList;
