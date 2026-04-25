import React, { useState } from 'react';
import { Badge, Popover, Image, Space, Button, Tooltip } from 'antd';
import { PictureOutlined, DeleteOutlined, DownloadOutlined, SendOutlined, EditOutlined } from '@ant-design/icons';
import { useScreenshotStore } from '../stores/screenshotStore';
import type { ScreenshotItem } from '../stores/screenshotStore';
import ImageEditorModal from './ImageEditorModal';

interface ScreenshotContainerProps {
  onSendToChat: (file: File) => void;
  isMobile?: boolean;
}

const ScreenshotContainer: React.FC<ScreenshotContainerProps> = ({ onSendToChat, isMobile }) => {
  const { screenshots, removeScreenshot, clearScreenshots } = useScreenshotStore();
  const [open, setOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ScreenshotItem | null>(null);

  if (screenshots.length === 0) {
    return null;
  }

  const handleDownload = (item: ScreenshotItem) => {
    const a = document.createElement('a');
    a.href = item.objectUrl;
    a.download = `screenshot_${new Date(item.timestamp).getTime()}.png`;
    a.click();
    removeScreenshot(item.id);
  };

  const handleSend = (item: ScreenshotItem) => {
    const file = new File([item.blob], `screenshot_${new Date(item.timestamp).getTime()}.png`, { type: 'image/png' });
    onSendToChat(file);
    removeScreenshot(item.id);
    if (screenshots.length === 1) {
      setOpen(false);
    }
  };

  const handleDownloadAll = async () => {
    for (let i = 0; i < screenshots.length; i++) {
      const item = screenshots[i];
      const a = document.createElement('a');
      a.href = item.objectUrl;
      a.download = `screenshot_${new Date(item.timestamp).getTime()}_${i}.png`;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // 轻微延迟防止浏览器拦截多个下载
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    clearScreenshots();
    setOpen(false);
  };

  const content = (
    <div style={{ width: 280, maxHeight: 400, overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, alignItems: 'center' }}>
        <div>
          <span style={{ fontWeight: 600 }}>暂存箱 ({screenshots.length}/10)</span>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>未发送则刷新后丢失</div>
        </div>
        <Tooltip title="一键下载全部并清空">
          <Button size="small" type="primary" icon={<DownloadOutlined />} onClick={handleDownloadAll}>
            全部下载
          </Button>
        </Tooltip>
      </div>
      <Space direction="vertical" style={{ width: '100%' }}>
        {screenshots.map((item) => (
          <div key={item.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 8, display: 'flex', gap: 12 }}>
            <Image
              src={item.objectUrl}
              width={80}
              height={60}
              style={{ objectFit: 'cover', borderRadius: 4 }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', flex: 1 }}>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {new Date(item.timestamp).toLocaleTimeString()}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <Tooltip title="批注 (画线/打字)">
                  <Button size="small" type="text" icon={<EditOutlined />} onClick={() => { setEditingItem(item); setOpen(false); }} />
                </Tooltip>
                <Tooltip title="下载并清理">
                  <Button size="small" type="text" icon={<DownloadOutlined />} onClick={() => handleDownload(item)} />
                </Tooltip>
                <Tooltip title="删除">
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => removeScreenshot(item.id)} />
                </Tooltip>
                <Tooltip title="发送至聊天">
                  <Button size="small" type="primary" icon={<SendOutlined />} onClick={() => handleSend(item)} />
                </Tooltip>
              </div>
            </div>
          </div>
        ))}
      </Space>
    </div>
  );

  return (
    <div style={{ 
      position: 'fixed', 
      left: isMobile ? 16 : undefined, 
      right: isMobile ? undefined : 32, 
      bottom: 100, 
      zIndex: 1000 
    }}>
      <Popover 
        content={content} 
        trigger="click" 
        placement={isMobile ? "rightBottom" : "leftBottom"}
        open={open}
        onOpenChange={setOpen}
      >
        <Badge count={screenshots.length} showZero={false} color="#f59e0b">
          <Button 
            shape="circle" 
            size="large" 
            icon={<PictureOutlined />} 
            style={{ 
              width: 50, 
              height: 50, 
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              background: 'var(--bg-primary)'
            }} 
          />
        </Badge>
      </Popover>
      <ImageEditorModal
        open={!!editingItem}
        item={editingItem}
        onCancel={() => { setEditingItem(null); setOpen(true); }}
      />
    </div>
  );
};

export default ScreenshotContainer;
