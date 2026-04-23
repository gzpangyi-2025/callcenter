import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { CopyOutlined, CheckOutlined, InfoCircleOutlined, CheckCircleOutlined, ExclamationCircleOutlined, WarningOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { message, Image } from 'antd';
import { Mermaid } from './Mermaid';

const alertConfig: Record<string, any> = {
  NOTE: { color: '#0969da', icon: <InfoCircleOutlined />, title: 'Note' },
  TIP: { color: '#1a7f37', icon: <CheckCircleOutlined />, title: 'Tip' },
  IMPORTANT: { color: '#8250df', icon: <ExclamationCircleOutlined />, title: 'Important' },
  WARNING: { color: '#9a6700', icon: <WarningOutlined />, title: 'Warning' },
  CAUTION: { color: '#d1242f', icon: <CloseCircleOutlined />, title: 'Caution' },
};

const extractAlert = (children: React.ReactNode): { type: string | null, newChildren: React.ReactNode } => {
  let type: string | null = null;
  let textFound = false;

  const processNode = (node: React.ReactNode): React.ReactNode => {
    if (typeof node === 'string') {
      if (node.trim() === '') return node;
      if (!textFound) {
        textFound = true;
        const match = node.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i);
        if (match) {
          type = match[1].toUpperCase();
          return node.substring(match[0].length);
        }
      }
      return node;
    }

    if (React.isValidElement(node)) {
      if (node.props && (node.props as any).children) {
        const newPropsChildren = React.Children.map((node.props as any).children, processNode);
        return React.cloneElement(node, { ...(node.props as any), children: newPropsChildren } as any);
      }
    }

    if (Array.isArray(node)) {
      return node.map(processNode);
    }

    return node;
  };

  const newChildren = React.Children.map(children, processNode);
  return { type, newChildren };
};

interface MarkdownViewerProps {
  content: string;
}

export const MarkdownViewer: React.FC<MarkdownViewerProps> = ({ content }) => {
  return (
    <div className="markdown-viewer">
      <ReactMarkdown
        urlTransform={(value: string) => value}
        remarkPlugins={[remarkGfm]}
        components={{
          blockquote({ node, children, ...props }: any) {
            const { type, newChildren } = extractAlert(children);
            
            if (type && alertConfig[type]) {
              const config = alertConfig[type];
              return (
                <div style={{
                  borderLeft: `4px solid ${config.color}`,
                  padding: '8px 16px',
                  margin: '16px 0',
                  color: '#57606a',
                  backgroundColor: 'transparent',
                }} className={`markdown-alert markdown-alert-${type.toLowerCase()}`}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: config.color, fontWeight: 600, marginBottom: '8px', fontSize: '14px' }}>
                    {config.icon}
                    <span>{config.title}</span>
                  </div>
                  <div className="markdown-alert-content" style={{ margin: 0 }}>
                    {newChildren}
                  </div>
                </div>
              );
            }
            return <blockquote {...props}>{children}</blockquote>;
          },
          code({ node, inline, className, children, ...props }: any) {
            const match = /language-(\w+)/.exec(className || '');
            const language = match ? match[1] : '';
            const codeString = String(children).replace(/\n$/, '');

            const [copied, setCopied] = useState(false);

            const handleCopy = () => {
              if (navigator.clipboard && window.isSecureContext) {
                navigator.clipboard.writeText(codeString)
                  .then(() => {
                    setCopied(true);
                    message.success('已复制到剪贴板');
                    setTimeout(() => setCopied(false), 2000);
                  })
                  .catch(() => message.error('复制失败'));
              } else {
                // Fallback for non-https environment or older browsers
                const textArea = document.createElement("textarea");
                textArea.value = codeString;
                textArea.style.position = "absolute";
                textArea.style.left = "-999999px";
                document.body.prepend(textArea);
                textArea.select();
                try {
                  document.execCommand('copy');
                  setCopied(true);
                  message.success('已复制到剪贴板');
                  setTimeout(() => setCopied(false), 2000);
                } catch (error) {
                  message.error('复制失败');
                } finally {
                  textArea.remove();
                }
              }
            };

            // 修复 ReactMarkdown v9/10 的 block 鉴别问题：
            // 因为 node.parent 无法访问，且 inline 属性被移除。
            // 使用可靠的启发式判断：如果指定了语言(match) 或者内容中包含换行符（代码块自带尾随换行），则是区块代码。
            const isBlock = match || String(children).includes('\n');

            if (isBlock && language === 'mermaid') {
              return <Mermaid chart={codeString} />;
            }

            return isBlock ? (
              <div style={{ position: 'relative', marginTop: 16, marginBottom: 16, borderRadius: 8, overflow: 'hidden', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                {/* 顶部标题栏，仿语雀极客风格 */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: '#1e1e1e', // 匹配 vscDarkPlus 背景色
                  color: '#888',
                  padding: '4px 12px',
                  fontSize: 12,
                  fontFamily: 'Consolas, Monaco, "Courier New", monospace',
                  borderBottom: '1px solid #333'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {/* Mac 风格的三个红黄绿窗口控制按钮点缀 */}
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff5f56' }}></span>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ffbd2e' }}></span>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#27c93f' }}></span>
                    <span style={{ marginLeft: 8, fontSize: 13, color: '#a0a0a0', fontWeight: 600 }}>{language || 'text'}</span>
                  </div>
                  
                  <div
                    onClick={handleCopy}
                    style={{
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      opacity: 0.8,
                      transition: 'opacity 0.2s',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
                    onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.8')}
                  >
                    {copied ? <CheckOutlined style={{ color: '#27c93f' }} /> : <CopyOutlined />}
                    <span style={{ userSelect: 'none' }}>{copied ? 'Copied' : 'Copy'}</span>
                  </div>
                </div>
                
                {/* 代码主体区域 */}
                <SyntaxHighlighter
                  {...props}
                  style={vscDarkPlus as any}
                  language={language || 'text'}
                  PreTag="div"
                  customStyle={{
                    margin: 0,
                    borderRadius: '0 0 8px 8px', // 下方圆角
                    padding: '16px',
                    fontSize: '14px',
                    lineHeight: '1.5',
                  }}
                  showLineNumbers={true}
                  wrapLines={true}
                >
                  {codeString}
                </SyntaxHighlighter>
              </div>
            ) : (
              <code className={`markdown-inline-code ${className || ''}`} {...props}>
                {children}
              </code>
            );
          },
          img({ src, alt }: any) {
            return (
              <Image
                src={src || ''}
                alt={alt || '图片'}
                style={{ maxWidth: '100%', borderRadius: 8, cursor: 'pointer' }}
                preview={{ mask: '点击放大' }}
                fallback="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iI2YwZjBmMCIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBkb21pbmFudC1iYXNlbGluZT0ibWlkZGxlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSIjYWFhIiBmb250LXNpemU9IjE0Ij7lm77niYfliqDovb3lpLHotKU8L3RleHQ+PC9zdmc+"
              />
            );
          }
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};
