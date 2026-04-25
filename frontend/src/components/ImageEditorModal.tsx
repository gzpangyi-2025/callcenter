import React, { useState, useRef, useEffect } from 'react';
import { Modal, Button, Space, Tooltip } from 'antd';
import { EditOutlined, FontSizeOutlined, UndoOutlined, ClearOutlined, SaveOutlined, ArrowRightOutlined, DragOutlined } from '@ant-design/icons';
import { Stage, Layer, Image as KonvaImage, Line, Text, Transformer, Arrow } from 'react-konva';
import useImage from 'use-image';
import { useScreenshotStore } from '../stores/screenshotStore';
import type { ScreenshotItem } from '../stores/screenshotStore';

interface ImageEditorModalProps {
  open: boolean;
  onCancel: () => void;
  item?: ScreenshotItem | null;
  file?: File | null;
  onSaveFile?: (file: File) => void;
}

type Tool = 'select' | 'pen' | 'arrow' | 'text';

interface BaseAction {
  id: string;
  x?: number;
  y?: number;
  scaleX?: number;
  scaleY?: number;
  rotation?: number;
}

interface LineData extends BaseAction {
  tool: 'pen';
  points: number[];
  color: string;
  strokeWidth: number;
}

interface ArrowData extends BaseAction {
  tool: 'arrow';
  points: number[];
  color: string;
  strokeWidth: number;
}

interface TextData extends BaseAction {
  tool: 'text';
  text: string;
  color: string;
  fontSize: number;
}

type DrawAction = LineData | ArrowData | TextData;

const COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#000000', '#ffffff'];

const ImageEditorModal: React.FC<ImageEditorModalProps> = ({ open, onCancel, item, file, onSaveFile }) => {
  const [fileUrl, setFileUrl] = useState('');
  
  useEffect(() => {
    if (file) {
      const url = URL.createObjectURL(file);
      setFileUrl(url);
      return () => URL.revokeObjectURL(url);
    } else {
      setFileUrl('');
    }
  }, [file]);

  const imageUrlToUse = item?.objectUrl || fileUrl || '';
  const [image] = useImage(imageUrlToUse);
  const { updateScreenshot } = useScreenshotStore();
  
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState<string>('#ef4444');
  const [actions, setActions] = useState<DrawAction[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  
  // 用于文字输入
  const [textInputVisible, setTextInputVisible] = useState(false);
  const [textInputValue, setTextInputValue] = useState('');
  const [textInputPos, setTextInputPos] = useState({ x: 0, y: 0 });

  const stageRef = useRef<any>(null);
  const trRef = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastTouchTime = useRef(0);

  // 自动获取焦点
  useEffect(() => {
    if (textInputVisible && inputRef.current) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [textInputVisible]);

  // 当弹窗打开时，重置状态
  useEffect(() => {
    if (open) {
      setActions([]);
      setTool('pen');
      setSelectedId(null);
      setTextInputVisible(false);
    }
  }, [open, item, file]);

  // 处理文本选择框
  useEffect(() => {
    if (selectedId && trRef.current && layerRef.current) {
      const node = layerRef.current.findOne(`#${selectedId}`);
      if (node) {
        trRef.current.nodes([node]);
        trRef.current.getLayer().batchDraw();
      }
    } else if (trRef.current) {
      trRef.current.nodes([]);
      trRef.current.getLayer().batchDraw();
    }
  }, [selectedId, actions]);

  const handleMouseDown = (e: any) => {
    // 防范移动端 Touch 穿透引起的 Ghost Click
    if (e.evt?.type === 'touchstart') {
      lastTouchTime.current = Date.now();
    } else if (e.evt?.type === 'mousedown') {
      if (Date.now() - lastTouchTime.current < 500) {
        return;
      }
    }

    if (textInputVisible) {
      // 确认当前文字
      handleTextSubmit();
      return;
    }

    // 如果点击在 Transformer 上，什么都不做
    if (e.target.getParent()?.className === 'Transformer') {
      return;
    }

    if (tool === 'select') {
      // 检查是否点中了可移动元素
      const clickedOnNode = e.target.className === 'Text' || e.target.className === 'Arrow' || e.target.className === 'Line';
      if (clickedOnNode) {
        setSelectedId(e.target.id());
      } else {
        setSelectedId(null);
      }
      return;
    }

    if (tool === 'text') {
      const pos = e.target.getStage().getPointerPosition();
      setTextInputPos(pos);
      setTextInputValue('');
      setTextInputVisible(true);
      return;
    }

    setIsDrawing(true);
    const pos = e.target.getStage().getPointerPosition();
    if (tool === 'pen') {
      setActions([...actions, { id: `pen_${Date.now()}`, tool: 'pen', points: [pos.x, pos.y], color, strokeWidth: 4 }]);
    } else if (tool === 'arrow') {
      setActions([...actions, { id: `arrow_${Date.now()}`, tool: 'arrow', points: [pos.x, pos.y, pos.x, pos.y], color, strokeWidth: 4 }]);
    }
  };

  const handleMouseMove = (e: any) => {
    if (!isDrawing) return;

    const stage = e.target.getStage();
    const point = stage.getPointerPosition();
    let lastAction = actions[actions.length - 1];
    
    if (tool === 'pen' && lastAction?.tool === 'pen') {
      const updatedAction = { ...lastAction, points: lastAction.points.concat([point.x, point.y]) };
      const newActions = [...actions];
      newActions.splice(actions.length - 1, 1, updatedAction);
      setActions(newActions);
    } else if (tool === 'arrow' && lastAction?.tool === 'arrow') {
      const updatedAction = { ...lastAction, points: [lastAction.points[0], lastAction.points[1], point.x, point.y] };
      const newActions = [...actions];
      newActions.splice(actions.length - 1, 1, updatedAction);
      setActions(newActions);
    }
  };

  const handleMouseUp = () => {
    setIsDrawing(false);
    // 绘制完箭头后自动切换到选择模式，方便用户立刻调整
    if (tool === 'arrow' && actions.length > 0) {
      setTool('select');
      setSelectedId(actions[actions.length - 1].id);
    }
  };

  const handleDragEnd = (e: any, index: number) => {
    const newActions = [...actions];
    newActions[index] = {
      ...newActions[index],
      x: e.target.x(),
      y: e.target.y()
    };
    setActions(newActions);
  };

  const handleTransformEnd = (e: any, index: number) => {
    const node = e.target;
    const newActions = [...actions];
    newActions[index] = {
      ...newActions[index],
      x: node.x(),
      y: node.y(),
      scaleX: node.scaleX(),
      scaleY: node.scaleY(),
      rotation: node.rotation()
    };
    setActions(newActions);
  };

  const handleTextSubmit = () => {
    if (textInputValue.trim()) {
      const newText: TextData = {
        id: `text_${Date.now()}`,
        tool: 'text',
        text: textInputValue,
        x: textInputPos.x,
        y: textInputPos.y,
        color,
        fontSize: 24,
      };
      setActions([...actions, newText]);
      // 输入完毕自动切到选择模式并选中该文字
      setTool('select');
      setSelectedId(newText.id);
    }
    setTextInputVisible(false);
    setTextInputValue('');
  };

  const handleUndo = () => {
    if (actions.length > 0) {
      setActions(actions.slice(0, actions.length - 1));
    }
    setSelectedId(null);
  };

  const handleClear = () => {
    setActions([]);
    setSelectedId(null);
  };

  const handleSave = () => {
    if (!stageRef.current) return;
    if (!item && !file) return;
    
    // 取消选中状态，避免框被画进去
    setSelectedId(null);
    
    setTimeout(() => {
      // 导出整个舞台
      const dataURL = stageRef.current.toDataURL({ pixelRatio: 2 });
      
      // DataURL to Blob
      fetch(dataURL)
        .then(res => res.blob())
        .then(blob => {
          if (item) {
            updateScreenshot(item.id, blob);
          } else if (file && onSaveFile) {
            // 将 blob 转为 file 并保持原名称
            const newFile = new File([blob], file.name, { type: 'image/png' });
            onSaveFile(newFile);
          }
          onCancel();
        });
    }, 50);
  };

  if (!item && !file) return null;

  // 计算适配屏幕的尺寸
  let stageWidth = window.innerWidth * 0.8;
  let stageHeight = window.innerHeight * 0.7;


  if (image) {
    const imgRatio = image.width / image.height;
    const stageRatio = stageWidth / stageHeight;
    
    if (imgRatio > stageRatio) {
      // 图片更宽，以宽度为准
      stageHeight = stageWidth / imgRatio;
    } else {
      // 图片更高，以高度为准
      stageWidth = stageHeight * imgRatio;
    }
  }

  return (
    <Modal
      title="图片批注"
      open={open}
      onCancel={onCancel}
      width={Math.max(stageWidth + 48, 750)}
      footer={null}
      destroyOnClose
      style={{ top: 20 }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* 工具栏 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <Space wrap>
            <Tooltip title="选择/移动">
              <Button 
                type={tool === 'select' ? 'primary' : 'default'} 
                icon={<DragOutlined />} 
                onClick={() => setTool('select')}
              />
            </Tooltip>
            <Tooltip title="画笔 (任意画线)">
              <Button 
                type={tool === 'pen' ? 'primary' : 'default'} 
                icon={<EditOutlined />} 
                onClick={() => setTool('pen')}
              />
            </Tooltip>
            <Tooltip title="箭头">
              <Button 
                type={tool === 'arrow' ? 'primary' : 'default'} 
                icon={<ArrowRightOutlined />} 
                onClick={() => setTool('arrow')}
              />
            </Tooltip>
            <Tooltip title="文本 (点击画面输入)">
              <Button 
                type={tool === 'text' ? 'primary' : 'default'} 
                icon={<FontSizeOutlined />} 
                onClick={() => setTool('text')}
              />
            </Tooltip>
            <div style={{ width: 1, height: 24, background: 'var(--border)', margin: '0 8px' }} />
            {COLORS.map(c => (
              <div
                key={c}
                onClick={() => setColor(c)}
                style={{
                  width: 24, height: 24, borderRadius: '50%', background: c,
                  cursor: 'pointer', border: color === c ? '2px solid #000' : '1px solid #ccc',
                  transform: color === c ? 'scale(1.2)' : 'scale(1)',
                  transition: 'all 0.2s'
                }}
              />
            ))}
          </Space>
          <Space wrap>
            <Button icon={<UndoOutlined />} onClick={handleUndo} disabled={actions.length === 0}>撤销</Button>
            <Button icon={<ClearOutlined />} onClick={handleClear} disabled={actions.length === 0}>清空批注</Button>
            <Button type="primary" icon={<SaveOutlined />} onClick={handleSave}>保存并更新</Button>
          </Space>
        </div>

        {/* 画板区 */}
        <div style={{ 
          position: 'relative', 
          background: '#f0f0f0', 
          width: stageWidth, 
          height: stageHeight,
          margin: '0 auto',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
        }}>
          <Stage
            width={stageWidth}
            height={stageHeight}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onTouchStart={handleMouseDown}
            onTouchMove={handleMouseMove}
            onTouchEnd={handleMouseUp}
            ref={stageRef}
            style={{ cursor: tool === 'pen' ? 'crosshair' : tool === 'text' ? 'text' : 'default' }}
          >
            <Layer>
              {/* 底图 */}
              {image && (
                <KonvaImage
                  image={image}
                  x={0}
                  y={0}
                  width={stageWidth}
                  height={stageHeight}
                />
              )}
            </Layer>
            
            <Layer ref={layerRef}>
              {/* 绘制的内容 */}
              {actions.map((act, i) => {
                const commonProps = {
                  key: act.id,
                  id: act.id,
                  x: act.x || 0,
                  y: act.y || 0,
                  scaleX: act.scaleX || 1,
                  scaleY: act.scaleY || 1,
                  rotation: act.rotation || 0,
                  draggable: tool === 'select',
                  onDragEnd: (e: any) => handleDragEnd(e, i),
                  onTransformEnd: (e: any) => handleTransformEnd(e, i),
                  onClick: () => { if (tool === 'select') setSelectedId(act.id); },
                  onTap: () => { if (tool === 'select') setSelectedId(act.id); }
                };

                if (act.tool === 'pen') {
                  return (
                    <Line
                      {...commonProps}
                      points={act.points}
                      stroke={act.color}
                      strokeWidth={act.strokeWidth}
                      tension={0.5}
                      lineCap="round"
                      lineJoin="round"
                    />
                  );
                }
                if (act.tool === 'arrow') {
                  return (
                    <Arrow
                      {...commonProps}
                      points={act.points}
                      stroke={act.color}
                      fill={act.color}
                      strokeWidth={act.strokeWidth}
                      pointerLength={10}
                      pointerWidth={10}
                      lineCap="round"
                      lineJoin="round"
                    />
                  );
                }
                if (act.tool === 'text') {
                  return (
                    <Text
                      {...commonProps}
                      text={act.text}
                      fill={act.color}
                      fontSize={act.fontSize}
                    />
                  );
                }
                return null;
              })}
              
              <Transformer ref={trRef} boundBoxFunc={(_oldBox: any, newBox: any) => {
                newBox.width = Math.max(30, newBox.width);
                return newBox;
              }} />
            </Layer>
          </Stage>

          {/* 悬浮文本输入框 */}
          {textInputVisible && (
            <div
              style={{
                position: 'absolute',
                top: textInputPos.y,
                left: textInputPos.x,
                zIndex: 10,
              }}
            >
              <input
                ref={inputRef}
                value={textInputValue}
                onChange={(e) => setTextInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleTextSubmit();
                  }
                }}
                onBlur={handleTextSubmit}
                style={{
                  background: 'transparent',
                  border: `1px dashed ${color}`,
                  color: color,
                  fontSize: 24,
                  outline: 'none',
                  padding: 4,
                  minWidth: 100,
                }}
                placeholder="输入文字后回车"
              />
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default ImageEditorModal;
