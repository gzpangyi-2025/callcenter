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
  if (typeof DOMParser === 'undefined') {
    return '';
  }

  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  if (doc.querySelector('parsererror')) {
    return '';
  }

  doc
    .querySelectorAll('script, foreignObject, iframe, object, embed')
    .forEach((node) => node.remove());

  doc.querySelectorAll('*').forEach((element) => {
    Array.from(element.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();

      if (name.startsWith('on')) {
        element.removeAttribute(attr.name);
        return;
      }

      if (
        (name === 'href' || name === 'xlink:href') &&
        (value.startsWith('javascript:') || value.startsWith('data:text/html'))
      ) {
        element.removeAttribute(attr.name);
      }
    });
  });

  return new XMLSerializer().serializeToString(doc.documentElement);
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
