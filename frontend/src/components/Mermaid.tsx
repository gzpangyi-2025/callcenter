import React, { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { Spin } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';

mermaid.initialize({
  startOnLoad: false,
  theme: 'default', // 改为默认的浅色主题，适应明亮的页面背景
  securityLevel: 'strict',
  fontFamily: 'inherit'
});

const sanitizeMermaidSvg = (svg: string): string => {
  // Mermaid is initialized with securityLevel: 'strict', which already
  // mitigates most XSS risks. DOMParser with 'image/svg+xml' is too strict
  // and frequently throws parsererror on perfectly valid Mermaid SVGs
  // due to HTML inside <foreignObject>. 
  
  // As a fallback defense-in-depth, we do a basic string replacement
  // to remove any script tags or javascript: hrefs that might have somehow bypassed Mermaid.
  let cleanSvg = svg;
  
  // Remove <script> tags
  cleanSvg = cleanSvg.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  
  // Remove javascript: and data:text/html links
  cleanSvg = cleanSvg.replace(/href\s*=\s*["']\s*(javascript:|data:text\/html)[^"']*["']/gi, 'href="#"');
  cleanSvg = cleanSvg.replace(/xlink:href\s*=\s*["']\s*(javascript:|data:text\/html)[^"']*["']/gi, 'xlink:href="#"');
  
  // Remove inline on* event handlers
  cleanSvg = cleanSvg.replace(/\bon[a-z]+\s*=\s*["'][^"']*["']/gi, '');

  return cleanSvg;
};

interface MermaidProps {
  chart: string;
}

export const Mermaid: React.FC<MermaidProps> = ({ chart }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgContent, setSvgContent] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    let isMounted = true;
    const renderChart = async () => {
      setLoading(true);
      setError('');
      try {
        const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;
        const { svg } = await mermaid.render(id, chart);
        if (isMounted) {
          setSvgContent(sanitizeMermaidSvg(svg));
          setLoading(false);
        }
      } catch (err: any) {
        console.error('Mermaid rendering failed:', err);
        if (isMounted) {
          setError(err?.message || '图表渲染失败');
          setLoading(false);
        }
      }
    };

    if (chart) {
      renderChart();
    }

    return () => {
      isMounted = false;
    };
  }, [chart]);

  return (
    <div 
      className="mermaid-wrapper" 
      ref={containerRef}
      style={{
        background: '#f8f9fa', // 柔和的浅灰背景
        border: '1px solid #ebedf0', // 细微的边框
        padding: '20px',
        borderRadius: '8px',
        margin: '16px 0',
        display: 'block', // 移除 flex，避免 flex item 压缩 SVG
        minHeight: '100px',
        overflowX: 'auto', // 允许横向滚动
        boxShadow: '0 2px 8px rgba(0,0,0,0.04)', // 极其轻微的阴影
        textAlign: 'center' // 让内容居中
      }}
    >
      {loading && <Spin indicator={<LoadingOutlined style={{ fontSize: 24, color: '#6366f1' }} spin />} tip="正在渲染图表..." />}
      {error && (
        <div style={{ color: '#ff4d4f', fontFamily: 'monospace', whiteSpace: 'pre-wrap', textAlign: 'left', width: '100%' }}>
          {error}
        </div>
      )}
      {!loading && !error && (
        <div 
          style={{ minWidth: 'max-content', margin: '0 auto' }}
          dangerouslySetInnerHTML={{ __html: svgContent }} 
        />
      )}
    </div>
  );
};
