import React from 'react';
import { Button, Upload, Tooltip, message } from 'antd';
import { PaperClipOutlined, PictureOutlined, SendOutlined } from '@ant-design/icons';
import { getFileIcon } from './ChatMessageList';
import ImageEditorModal from '../../components/ImageEditorModal';

interface ChatInputBarProps {
  inputValue: string;
  setInputValue: (v: string) => void;
  pendingFiles: File[];
  setPendingFiles: React.Dispatch<React.SetStateAction<File[]>>;
  uploading: boolean;
  isMobile: boolean;
  enterToNewline: boolean;
  setEnterToNewline: (v: boolean) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onSendMessage: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onPaste: (e: React.ClipboardEvent) => void;
  onCompositionStart?: (e: React.CompositionEvent) => void;
  onCompositionEnd?: (e: React.CompositionEvent) => void;
}

const ChatInputBar: React.FC<ChatInputBarProps> = ({
  inputValue,
  setInputValue,
  pendingFiles,
  setPendingFiles,
  uploading,
  isMobile,
  enterToNewline,
  setEnterToNewline,
  textareaRef,
  onSendMessage,
  onKeyDown,
  onPaste,
  onCompositionStart,
  onCompositionEnd,
}) => {
  const removePendingFile = (index: number) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== index));
  };

  const [editingFileIndex, setEditingFileIndex] = React.useState<number | null>(null);

  const handleSaveEditedFile = (newFile: File) => {
    if (editingFileIndex !== null) {
      setPendingFiles(prev => {
        const newFiles = [...prev];
        newFiles[editingFileIndex] = newFile;
        return newFiles;
      });
    }
  };

  const enterNewlineBtn = (
    <Tooltip title={enterToNewline ? '当前：回车换行 (组合键发送)' : '当前：回车发送 (组合键换行)'} placement={isMobile ? 'top' : 'right'}>
      <Button
        onClick={() => {
          const newVal = !enterToNewline;
          setEnterToNewline(newVal);
          localStorage.setItem('enterToNewline', String(newVal));
          message.success(newVal ? '已切换为：回车换行' : '已切换为：回车发送');
        }}
        style={{
          color: enterToNewline ? '#ffffff' : 'var(--text-primary)',
          background: enterToNewline ? 'linear-gradient(135deg, #4f46e5, #818cf8)' : 'var(--bg-hover)',
          fontSize: 10,
          fontWeight: 'bold',
          lineHeight: '1.1',
          padding: '2px 4px',
          height: 30,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 0,
          borderRadius: 6,
          border: enterToNewline ? '1px solid transparent' : '1px solid var(--border)',
          boxShadow: enterToNewline ? '0 2px 4px rgba(79,70,229,0.3)' : 'none',
          marginBottom: isMobile ? 0 : 4,
        }}
      >
        <span>回车</span>
        <span>换行</span>
      </Button>
    </Tooltip>
  );

  return (
    <div className="chat-input-area">
      {/* 待发送文件预览条 */}
      {pendingFiles.length > 0 && (
        <div className="pending-files-strip">
          {pendingFiles.map((file, i) => (
            <div key={i} className="pending-file-item">
              {file.type.startsWith('image/') ? (
                <img 
                  src={URL.createObjectURL(file)} 
                  alt={file.name} 
                  className="pending-img-preview" 
                  onClick={() => setEditingFileIndex(i)}
                  style={{ cursor: 'pointer' }}
                  title="点击批注图片"
                />
              ) : (
                <div className="pending-file-icon" style={{ color: getFileIcon(file.name).color }}>
                  {getFileIcon(file.name).icon}
                </div>
              )}
              <span className="pending-file-name">{file.name}</span>
              <button className="pending-file-remove" onClick={() => removePendingFile(i)}>×</button>
            </div>
          ))}
        </div>
      )}
      <div className="chat-input-row">
        <div className="chat-input-actions">
          {!isMobile && enterNewlineBtn}
          <Upload showUploadList={false} beforeUpload={(file) => { setPendingFiles(prev => [...prev, file]); return false; }} disabled={uploading}>
            <Button icon={<PaperClipOutlined />} type="text" title="添加文件"
              style={{ color: 'var(--text-secondary)', fontSize: 16 }} disabled={uploading} />
          </Upload>
          <Upload showUploadList={false} accept="image/*" beforeUpload={(file) => { setPendingFiles(prev => [...prev, file]); return false; }} disabled={uploading}>
            <Button icon={<PictureOutlined />} type="text" title="添加图片"
              style={{ color: 'var(--text-secondary)', fontSize: 16 }} disabled={uploading} />
          </Upload>
        </div>
        <textarea
          ref={textareaRef}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
          placeholder={
            enterToNewline
              ? (isMobile ? '输入消息... (回车换行)' : '输入消息... (回车换行，按 Ctrl+Enter 发送，可粘贴图片)')
              : (isMobile ? '输入消息... (回车发送)' : '输入消息... (回车发送，按 Ctrl+Enter 换行，可粘贴图片)')
          }
          rows={isMobile ? 1 : 3}
        />
        {isMobile ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'flex-end', height: '100%' }}>
            {enterNewlineBtn}
            <button
              className="chat-send-btn"
              onClick={onSendMessage}
              disabled={(!inputValue.trim() && pendingFiles.length === 0) || uploading}
            >
              <SendOutlined />
            </button>
          </div>
        ) : (
          <button
            className="chat-send-btn"
            onClick={onSendMessage}
            disabled={(!inputValue.trim() && pendingFiles.length === 0) || uploading}
          >
            <SendOutlined />
          </button>
        )}
      </div>
      <ImageEditorModal
        open={editingFileIndex !== null}
        file={editingFileIndex !== null ? pendingFiles[editingFileIndex] : null}
        onCancel={() => setEditingFileIndex(null)}
        onSaveFile={handleSaveEditedFile}
      />
    </div>
  );
};

export default ChatInputBar;
