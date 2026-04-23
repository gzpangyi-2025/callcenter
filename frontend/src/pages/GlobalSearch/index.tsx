import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Input, Tag, Spin, List, Tabs, Typography, Space } from 'antd';
import { FileTextOutlined, FireOutlined, BookOutlined, MessageOutlined, SearchOutlined } from '@ant-design/icons';
import { searchAPI } from '../../services/api';

const { Title } = Typography;

export default function GlobalSearch() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const q = searchParams.get('q') || '';
  const type = searchParams.get('type') || 'all';

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>({ total: 0, items: [], aggregations: {} });

  useEffect(() => {
    if (!q) return;
    const fetchSearch = async () => {
      setLoading(true);
      try {
        const res: any = await searchAPI.search({ q, type, page: 1, pageSize: 50 });
        setData(res);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchSearch();
  }, [q, type]);

  const onSearch = (value: string) => {
    if (value) setSearchParams({ q: value, type });
  };

  const onChangeTab = (key: string) => {
    setSearchParams({ q, type: key });
  };

  const getIconAndColor = (itemType: string) => {
    switch (itemType) {
      case 'post': return { icon: <FireOutlined />, color: '#ff4d4f', label: 'BBS帖子' };
      case 'ticket': return { icon: <FileTextOutlined />, color: '#1677ff', label: '工单' };
      case 'knowledge': return { icon: <BookOutlined />, color: '#52c41a', label: '知识库' };
      case 'message': return { icon: <MessageOutlined />, color: '#faad14', label: '聊天记录' };
      default: return { icon: <SearchOutlined />, color: '#888', label: '其他' };
    }
  };

  const renderHighlight = (highlight: any, field: string, fallback: string) => {
    if (highlight && highlight[field] && highlight[field].length > 0) {
      return <span className="search-highlight" dangerouslySetInnerHTML={{ __html: highlight[field].join(' ... ') }} />;
    }
    return fallback;
  };

  return (
    <div style={{ padding: 24, maxWidth: 1000, margin: '0 auto' }}>
      <Title level={2}>全站搜索</Title>
      
      <Input.Search
        size="large"
        placeholder="搜索工单、帖子、知识库、聊天记录..."
        defaultValue={q}
        onSearch={onSearch}
        style={{ marginBottom: 24 }}
        allowClear
      />

      <Tabs
        activeKey={type}
        onChange={onChangeTab}
        items={[
          { key: 'all', label: `全部结果 (${type === 'all' ? data.total : '-'})` },
          { key: 'post', label: 'BBS论坛' },
          { key: 'ticket', label: '工单广场' },
          { key: 'knowledge', label: '知识库' },
          { key: 'message', label: '聊天记录' },
        ]}
      />

      {loading ? (
        <div style={{ textAlign: 'center', padding: 50 }}><Spin size="large" /></div>
      ) : (
        <List
          itemLayout="vertical"
          size="large"
          dataSource={data.items}
          locale={{ emptyText: q ? '没有找到相关内容' : '请输入关键词搜索' }}
          renderItem={(item: any) => {
            const { icon, color, label } = getIconAndColor(item.type);
            return (
              <List.Item
                style={{ cursor: 'pointer', background: 'var(--bg-secondary)', marginBottom: 16, borderRadius: 8, padding: 20 }}
                onClick={() => {
                  if (item.type === 'post') navigate(`/bbs/${item.id}`);
                  else if (item.type === 'ticket') navigate(`/tickets/${item.id}`);
                  else if (item.type === 'knowledge') navigate(`/knowledge?viewId=${item.id}`);
                  // message type => go to ticket
                  else if (item.type === 'message') navigate(`/tickets/${item.ticketId}`);
                }}
              >
                <List.Item.Meta
                  title={
                    <Space>
                      <Tag color={color} icon={icon}>{label}</Tag>
                      <a style={{ fontSize: 18, fontWeight: 600 }}>
                        {renderHighlight(item.highlight, 'title', item.title || '无标题')}
                      </a>
                    </Space>
                  }
                  description={
                    <Space size="middle" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                      <span>发布人/客户: {item.authorName || item.customerName || item.senderName || '系统'}</span>
                      <span>时间: {new Date(item.createdAt).toLocaleString()}</span>
                      {item.sectionName && <span>板块: {item.sectionName}</span>}
                    </Space>
                  }
                />
                <div className="bbs-highlight-content" style={{ color: 'var(--text-primary)', marginTop: 8 }}>
                  {renderHighlight(item.highlight, 'content', (item.content || '').substring(0, 200) + '...')}
                </div>
              </List.Item>
            );
          }}
        />
      )}
    </div>
  );
}
