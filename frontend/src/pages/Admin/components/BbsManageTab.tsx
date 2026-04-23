import React, { useState, useEffect } from 'react';
import { Card, Table, Button, Input, Space, message, Popconfirm, Tag, Select, ColorPicker } from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined, SwapOutlined } from '@ant-design/icons';
import { bbsAPI } from '../../../services/api';
import api from '../../../services/api';

const BbsManageTab: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'sections' | 'tags' | 'migrate' | 'search'>('sections');

  return (
    <div style={{ padding: 24, minHeight: 400 }}>
      <Space style={{ marginBottom: 20 }}>
        {(['sections', 'tags', 'migrate', 'search'] as const).map(tab => (
          <Button
            key={tab}
            type={activeTab === tab ? 'primary' : 'default'}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'sections' ? '📋 板块管理' : tab === 'tags' ? '🏷️ 标签管理' : tab === 'migrate' ? '🔀 帖子迁移' : '🔍 搜索引擎'}
          </Button>
        ))}
      </Space>

      {activeTab === 'sections' && <SectionManager />}
      {activeTab === 'tags' && <TagManager />}
      {activeTab === 'migrate' && <PostMigrator />}
      {activeTab === 'search' && <SearchEngineManager />}
    </div>
  );
};

// ───────── 板块管理 ─────────
function SectionManager() {
  const [sections, setSections] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [description, setDescription] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editIcon, setEditIcon] = useState('');
  const [editDesc, setEditDesc] = useState('');

  const fetchSections = async () => {
    setLoading(true);
    try {
      const res: any = await bbsAPI.getSections();
      setSections(Array.isArray(res) ? res : []);
    } catch {
      message.error('加载板块失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSections(); }, []);

  const handleAdd = async () => {
    if (!name.trim()) return message.warning('请输入板块名称');
    try {
      await bbsAPI.createSection({ name: name.trim(), icon: icon.trim() || '📁', description: description.trim() });
      message.success('板块创建成功');
      setName(''); setIcon(''); setDescription('');
      fetchSections();
    } catch (e: any) {
//       message.error(e.response?.data?.message || '创建失败'); // Removed by global interceptor refactor
    }
  };

  const handleUpdate = async (id: number) => {
    try {
      await bbsAPI.updateSection(id, { name: editName, icon: editIcon, description: editDesc });
      message.success('修改成功');
      setEditingId(null);
      fetchSections();
    } catch (e: any) {
//       message.error(e.response?.data?.message || '修改失败'); // Removed by global interceptor refactor
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await bbsAPI.deleteSection(id);
      message.success('已删除，该板块下的帖子已变为"未分类"');
      fetchSections();
    } catch {
      message.error('删除失败');
    }
  };

  return (
    <Card size="small" title="板块列表" style={{ borderRadius: 10 }}>
      {/* 新增表单 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <Input placeholder="板块名称" value={name} onChange={e => setName(e.target.value)} style={{ width: 150 }} />
        <Input placeholder="图标 (emoji)" value={icon} onChange={e => setIcon(e.target.value)} style={{ width: 100 }} />
        <Input placeholder="描述 (可选)" value={description} onChange={e => setDescription(e.target.value)} style={{ width: 200 }} />
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>新增板块</Button>
      </div>

      <Table
        dataSource={sections}
        rowKey="id"
        loading={loading}
        size="small"
        pagination={false}
        columns={[
          { title: '排序', dataIndex: 'sortOrder', width: 60 },
          {
            title: '图标', dataIndex: 'icon', width: 60,
            render: (v: string) => <span style={{ fontSize: 18 }}>{v || '📁'}</span>
          },
          {
            title: '名称', dataIndex: 'name',
            render: (v: string, record: any) => editingId === record.id
              ? <Input size="small" value={editName} onChange={e => setEditName(e.target.value)} style={{ width: 120 }} />
              : <strong>{v}</strong>
          },
          {
            title: '描述', dataIndex: 'description',
            render: (v: string, record: any) => editingId === record.id
              ? <Input size="small" value={editDesc} onChange={e => setEditDesc(e.target.value)} style={{ width: 180 }} />
              : <span style={{ color: 'var(--text-secondary)' }}>{v || '-'}</span>
          },
          {
            title: '操作', width: 160,
            render: (_: any, record: any) => editingId === record.id ? (
              <Space size="small">
                <Button size="small" type="primary" onClick={() => handleUpdate(record.id)}>保存</Button>
                <Button size="small" onClick={() => setEditingId(null)}>取消</Button>
              </Space>
            ) : (
              <Space size="small">
                <Button size="small" icon={<EditOutlined />} onClick={() => {
                  setEditingId(record.id);
                  setEditName(record.name);
                  setEditIcon(record.icon || '');
                  setEditDesc(record.description || '');
                }} />
                <Popconfirm title="确定删除该板块？板块下帖子将变为未分类。" onConfirm={() => handleDelete(record.id)}>
                  <Button size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </Space>
            )
          }
        ]}
      />
    </Card>
  );
}

// ───────── 标签管理 ─────────
function TagManager() {
  const [tags, setTags] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#4f46e5');

  const fetchTags = async () => {
    setLoading(true);
    try {
      const res: any = await bbsAPI.getTags();
      setTags(Array.isArray(res) ? res : []);
    } catch {
      message.error('加载标签失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchTags(); }, []);

  const handleAdd = async () => {
    if (!name.trim()) return message.warning('请输入标签名称');
    try {
      await bbsAPI.createTag({ name: name.trim(), color });
      message.success('标签创建成功');
      setName('');
      fetchTags();
    } catch (e: any) {
//       message.error(e.response?.data?.message || '创建失败'); // Removed by global interceptor refactor
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await bbsAPI.deleteTag(id);
      message.success('标签已删除');
      fetchTags();
    } catch {
      message.error('删除失败');
    }
  };

  return (
    <Card size="small" title="预设标签列表" style={{ borderRadius: 10 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <Input placeholder="标签名称" value={name} onChange={e => setName(e.target.value)} style={{ width: 160 }} />
        <ColorPicker value={color} onChange={(_, hex) => setColor(hex)} size="small" />
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>新增标签</Button>
      </div>

      <Table
        dataSource={tags}
        rowKey="id"
        loading={loading}
        size="small"
        pagination={false}
        columns={[
          {
            title: '标签', dataIndex: 'name',
            render: (v: string, record: any) => <Tag color={record.color || undefined}>{v}</Tag>
          },
          {
            title: '颜色', dataIndex: 'color', width: 100,
            render: (v: string) => v ? <span style={{ display: 'inline-block', width: 16, height: 16, borderRadius: 4, background: v, verticalAlign: 'middle' }} /> : '-'
          },
          {
            title: '创建时间', dataIndex: 'createdAt', width: 180,
            render: (v: string) => new Date(v).toLocaleString()
          },
          {
            title: '操作', width: 80,
            render: (_: any, record: any) => (
              <Popconfirm title="确定删除该标签？" onConfirm={() => handleDelete(record.id)}>
                <Button size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            )
          }
        ]}
      />
    </Card>
  );
}

// ───────── 帖子迁移 ─────────
function PostMigrator() {
  const [sections, setSections] = useState<any[]>([]);
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterSectionId, setFilterSectionId] = useState<number | undefined>(undefined);
  const [selectedPostIds, setSelectedPostIds] = useState<number[]>([]);
  const [targetSectionId, setTargetSectionId] = useState<number | undefined>(undefined);
  const [migrating, setMigrating] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    bbsAPI.getSections().then((res: any) => setSections(Array.isArray(res) ? res : [])).catch(() => {});
  }, []);

  const fetchPosts = async () => {
    setLoading(true);
    try {
      const res: any = await api.get('/bbs/posts', {
        params: { page, pageSize: 20, sectionId: filterSectionId, status: 'all' }
      });
      if (res && res.items) {
        setPosts(res.items);
        setTotal(res.total || 0);
      }
    } catch {
      message.error('加载帖子失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchPosts(); }, [filterSectionId, page]);

  const handleMigrate = async () => {
    if (selectedPostIds.length === 0) return message.warning('请选择要迁移的帖子');
    if (!targetSectionId) return message.warning('请选择目标板块');
    setMigrating(true);
    try {
      const res: any = await bbsAPI.migratePosts(selectedPostIds, targetSectionId);
      message.success(`成功迁移 ${res.migratedCount || selectedPostIds.length} 篇帖子到「${res.targetSection || '目标板块'}」`);
      setSelectedPostIds([]);
      fetchPosts();
    } catch {
      message.error('迁移失败');
    } finally {
      setMigrating(false);
    }
  };

  return (
    <Card size="small" title="帖子板块迁移" style={{ borderRadius: 10 }}>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>筛选板块：</span>
        <Select
          placeholder="全部板块"
          value={filterSectionId}
          onChange={v => { setFilterSectionId(v); setPage(1); setSelectedPostIds([]); }}
          allowClear
          style={{ width: 160 }}
          options={[
            { label: '未分类', value: -1 },
            ...sections.map(s => ({ label: `${s.icon || '📁'} ${s.name}`, value: s.id })),
          ]}
        />
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>迁移到：</span>
        <Select
          placeholder="选择目标板块"
          value={targetSectionId}
          onChange={setTargetSectionId}
          style={{ width: 180 }}
          options={sections.map(s => ({ label: `${s.icon || '📁'} ${s.name}`, value: s.id }))}
        />
        <Button type="primary" icon={<SwapOutlined />} onClick={handleMigrate} loading={migrating} disabled={selectedPostIds.length === 0}>
          迁移选中 ({selectedPostIds.length})
        </Button>
      </div>

      <Table
        dataSource={posts}
        rowKey="id"
        loading={loading}
        size="small"
        rowSelection={{
          selectedRowKeys: selectedPostIds,
          onChange: (keys) => setSelectedPostIds(keys as number[]),
        }}
        pagination={{
          current: page,
          total,
          pageSize: 20,
          onChange: p => setPage(p),
          showSizeChanger: false,
          size: 'small',
        }}
        columns={[
          { title: '标题', dataIndex: 'title', ellipsis: true },
          {
            title: '当前板块', dataIndex: 'section', width: 120,
            render: (s: any) => s ? <Tag color="blue">{s.icon} {s.name}</Tag> : <Tag>未分类</Tag>
          },
          {
            title: '作者', width: 100,
            render: (_: any, record: any) => record.author?.realName || record.author?.username || '-'
          },
          {
            title: '发布时间', dataIndex: 'createdAt', width: 160,
            render: (v: string) => new Date(v).toLocaleString()
          },
        ]}
      />
    </Card>
  );
}

// ───────── 搜索引擎管理 ─────────
function SearchEngineManager() {
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<any>(null);

  const handleSync = async () => {
    setSyncing(true);
    setResult(null);
    try {
      const res: any = await api.post('/search/sync');
      message.success('全量同步成功');
      setResult(res);
    } catch {
      message.error('全量同步失败');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Card size="small" title="Elasticsearch 搜索引擎管理" style={{ borderRadius: 10 }}>
      <div style={{ padding: 20 }}>
        <h3 style={{ marginBottom: 16 }}>数据全量同步</h3>
        <p style={{ color: 'var(--text-secondary)' }}>
          当数据库和搜索引擎数据不一致时（如修改了数据库直接内容，或者初期引入ES），
          点击此按钮将数据库中的所有数据（工单、帖子、知识库、聊天片段）全量提取并覆盖更新到 Elasticsearch 引擎中。
        </p>
        <Button type="primary" loading={syncing} onClick={handleSync} style={{ marginTop: 10 }}>
          {syncing ? '正在同步中，请稍后...' : '开始全量同步'}
        </Button>
        
        {result && (
          <div style={{ marginTop: 24, padding: 16, background: 'var(--bg-secondary)', borderRadius: 8 }}>
            <h4>同步结果：</h4>
            <span style={{ color: '#52c41a', fontSize: 16 }}>成功同步 {result.count} 条数据</span>
          </div>
        )}
      </div>
    </Card>
  );
}

export default BbsManageTab;
