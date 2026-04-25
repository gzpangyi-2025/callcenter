import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Input, Card, List, Tag, Button, Empty, Typography, Modal, Popconfirm, message, Tabs } from 'antd';
import { SearchOutlined, BookOutlined, DeleteOutlined, DownloadOutlined, ClockCircleOutlined, RobotOutlined, FileWordOutlined } from '@ant-design/icons';
import { knowledgeAPI } from '../../services/api';
import { MarkdownViewer } from '../../components/MarkdownViewer';
import { RequirePermission } from '../../components/RequirePermission';

const { Title, Text } = Typography;

const severityColor: Record<string, string> = {
  '低': 'green', '中': 'blue', '高': 'orange', '紧急': 'red'
};

const KnowledgePage: React.FC = () => {
  const [searchText, setSearchText] = useState('');
  const [docs, setDocs] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [viewDoc, setViewDoc] = useState<any>(null);
  const [activeTab, setActiveTab] = useState('chat_history');
  const searchTimeoutRef = useRef<any>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const fetchDocs = async (q: string, p: number, typeStr: string) => {
    setLoading(true);
    try {
      const res: any = await knowledgeAPI.search(q, p, typeStr);
      if (res.code === 0) {
        setDocs(res.data.items || []);
        setTotal(res.data.total || 0);
      }
    } catch {
      message.error('加载知识库失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let initialTab = activeTab;
    const storedTab = localStorage.getItem('knowledgeActiveTab');
    if (storedTab) {
      initialTab = storedTab;
      setActiveTab(storedTab);
      localStorage.removeItem('knowledgeActiveTab');
    }
    fetchDocs('', 1, initialTab);

    // 处理全局搜索跳转的特定文档查看
    const viewId = searchParams.get('viewId');
    if (viewId) {
      knowledgeAPI.getOne(parseInt(viewId, 10)).then((res: any) => {
        if (res.code === 0 && res.data) {
          setViewDoc(res.data);
          setActiveTab(res.data.type || initialTab);
        }
      }).finally(() => {
        // 清除 query 参数
        searchParams.delete('viewId');
        setSearchParams(searchParams, { replace: true });
      });
    }
  }, []);

  // 300ms 防抖搜索
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchText(val);
    setPage(1);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      fetchDocs(val, 1, activeTab);
    }, 300);
  };

  const handlePageChange = (p: number) => {
    setPage(p);
    fetchDocs(searchText, p, activeTab);
  };

  const handleDelete = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res: any = await knowledgeAPI.deleteOne(id);
      if (res.code === 0) {
        message.success('删除成功');
        fetchDocs(searchText, page, activeTab);
        if (viewDoc?.id === id) setViewDoc(null);
      }
    } catch {
      message.error('删除失败');
    }
  };

  const downloadFile = (id: number, type: 'md' | 'docx' | 'zip') => {
    window.location.href = `/api/knowledge/${id}/export/${type}?token=${localStorage.getItem('accessToken')}`;
  };

  return (
    <div className="fade-in page-flex-layout" style={{ maxWidth: 1200, margin: '0 auto', width: '100%' }}>
      <div className="page-sticky-header">
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16, gap: 12 }}>
        <BookOutlined style={{ fontSize: 24, color: 'var(--primary)' }} />
        <Title level={2} style={{ margin: 0, fontSize: 24 }}>技术支持知识库</Title>
      </div>

      <Input
        size="large"
        placeholder="搜索知识文档标题或对应关联工单号..."
        prefix={<SearchOutlined style={{ color: 'var(--text-muted)' }} />}
        value={searchText}
        onChange={handleSearchChange}
        onFocus={(e) => e.target.select()}
        style={{ marginBottom: 16, borderRadius: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.05)', border: 'none' }}
        allowClear
      />

      <Tabs
        activeKey={activeTab}
        onChange={(key) => {
          setActiveTab(key);
          setPage(1);
          setSearchText('');
          fetchDocs('', 1, key);
        }}
        items={[
          { key: 'chat_history', label: '💬 聊天记录' },
          { key: 'ai_doc', label: '📖 知识文档' },
        ]}
        style={{ marginBottom: 8 }}
      />
      </div>

      <div className="page-scroll-content" style={{ paddingBottom: 40 }}>
      <List
        loading={loading}
        dataSource={docs}
        pagination={{
          current: page,
          pageSize: 20,
          total,
          onChange: handlePageChange,
          showSizeChanger: false,
          position: 'bottom',
          align: 'center'
        }}
        locale={{ emptyText: <Empty description={activeTab === 'ai_doc' ? "暂无相关知识文档，快用 AI 去生成吧" : "暂无已导出的聊天记录"} /> }}
        renderItem={item => {
          let tagList = [];
          if (item.tags) {
            tagList = item.tags.split(',').map((t: string) => t.trim()).filter((t: string) => t);
          }
          return (
            <Card
              key={item.id}
              hoverable
              onClick={() => setViewDoc(item)}
              style={{ marginBottom: 16, borderRadius: 12, border: '1px solid var(--border)' }}
              bodyStyle={{ padding: '16px 20px' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
                    <Text strong style={{ fontSize: 16 }}>{item.title}</Text>
                    {item.severity && <Tag color={severityColor[item.severity] || 'default'}>{item.severity}</Tag>}
                    {item.category && (() => {
                      const hwKeywords = ['硬件', 'hardware', '服务器', '磁盘', '交换机', 'UPS', '小型机', '空调', '视频', '负载'];
                      const isHw = hwKeywords.some(k => item.category.toLowerCase().includes(k.toLowerCase()));
                      return <Tag color={isHw ? 'volcano' : 'geekblue'}>{item.category}</Tag>;
                    })()}
                  </div>
                  <div style={{ display: 'flex', gap: 16, color: 'var(--text-secondary)', fontSize: 13, marginBottom: 8 }}>
                    <span><ClockCircleOutlined /> 生成于 {new Date(item.createdAt).toLocaleString('zh-CN')}</span>
                    <span><BookOutlined /> 关联工单: {item.ticketNo || item.ticketId}</span>
                    <span><RobotOutlined /> {activeTab === 'chat_history' ? '导出人' : '生成引擎'}: {item.generatedBy === 'admin' ? '系统管理员' : item.generatedBy}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {tagList.map((tag: string, i: number) => (
                      <Tag key={i} style={{ border: 'none', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>{tag}</Tag>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center' }}>
                  <Button size="small" type="link" onClick={(e) => {
                    e.stopPropagation();
                    window.location.href = `/tickets/${item.ticketId}`;
                  }}>视图详情</Button>
                  <RequirePermission permissions={['knowledge:manage']}>
                    <Popconfirm title={`确定要删除这篇${activeTab === 'chat_history' ? '聊天记录' : '知识文档'}吗？`} onConfirm={(e: any) => handleDelete(item.id, e)} onCancel={e => e?.stopPropagation()} okButtonProps={{ danger: true }}>
                      <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={e => e.stopPropagation()}>删除</Button>
                    </Popconfirm>
                  </RequirePermission>
                </div>
              </div>
            </Card>
          );
        }}
      />
      </div>

      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 40 }}>
            <BookOutlined style={{ color: 'var(--primary)' }} />
            <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{viewDoc?.title}</span>
          </div>
        }
        open={!!viewDoc}
        onCancel={() => setViewDoc(null)}
        width={900}
        footer={[
          <Button key="close" onClick={() => setViewDoc(null)}>关闭</Button>,
          <Button key="zip" icon={<BookOutlined />} onClick={() => downloadFile(viewDoc?.id, 'zip')} style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}>一键打包关联附件 (ZIP)</Button>,
          <Button key="docx" icon={<FileWordOutlined />} onClick={() => downloadFile(viewDoc?.id, 'docx')}>下载 DOCX</Button>,
          <Button key="md" type="primary" icon={<DownloadOutlined />} onClick={() => downloadFile(viewDoc?.id, 'md')}>下载 Markdown原文</Button>
        ]}
      >
        <div className="markdown-body" style={{ padding: 12, minHeight: 400, maxHeight: '70vh', overflowY: 'auto' }}>
          {viewDoc && (
            <MarkdownViewer content={viewDoc.content} />
          )}
        </div>
      </Modal>

    </div>
  );
};

export default KnowledgePage;
