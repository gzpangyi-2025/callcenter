import { useState, useEffect, useCallback, useRef } from 'react';
import { Input, Tag, Spin, message, Dropdown, Pagination, Modal, Checkbox, Drawer } from 'antd';
import {
  PlusOutlined, EyeOutlined, MessageOutlined,
  SearchOutlined, AppstoreOutlined, BarsOutlined,
  MoreOutlined, EditOutlined, DeleteOutlined,
  PushpinOutlined, InboxOutlined, MessageFilled,
} from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api, { bbsAPI } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import './bbs.css';

// 权限检查 helper
function useHasPermission(code: string): boolean {
  const { user } = useAuthStore();
  if (!user || !user.role) return false;
  const roleObj: any = user.role;
  if (roleObj.name === 'admin' || user.username === 'admin') return true;
  const perms = roleObj.permissions || [];
  return perms.some((p: any) => {
    const pCode = p.code || `${p.resource}:${p.action}`;
    return pCode === code;
  });
}

// 安全解析 tags
function safeTags(tags: any): string[] {
  if (Array.isArray(tags)) return tags;
  if (typeof tags === 'string') return tags.split(',').filter(Boolean);
  return [];
}

export default function BbsList() {
  const [posts, setPosts] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'card'>('list');
  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState<string>('');
  const [statusTab, setStatusTab] = useState<string>('active');
  const [sortBy, setSortBy] = useState<string>('latestReply');
  const [page, setPage] = useState(1);
  const { user } = useAuthStore();

  const [isMobile, setIsMobile] = useState(false);
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const [isManageMode, setIsManageMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const searchTimeoutRef = useRef<any>(null);

  // 板块与标签数据
  const [sections, setSections] = useState<any[]>([]);
  const [presetTags, setPresetTags] = useState<any[]>([]);

  // 当前板块 (通过 URL query 参数)
  const [searchParams, setSearchParams] = useSearchParams();
  const currentSectionId = searchParams.get('section') ? Number(searchParams.get('section')) : undefined;

  const canCreate = useHasPermission('bbs:create');
  const canEdit = useHasPermission('bbs:edit');
  const canDelete = useHasPermission('bbs:delete');

  const navigate = useNavigate();

  // 加载板块和标签
  useEffect(() => {
    bbsAPI.getSections().then((res: any) => {
      setSections(Array.isArray(res) ? res : []);
    }).catch(() => {});
    bbsAPI.getTags().then((res: any) => {
      setPresetTags(Array.isArray(res) ? res : []);
    }).catch(() => {});
  }, []);

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    try {
      const res: any = await api.get('/bbs/posts', {
        params: { search, tag: activeTag, page, pageSize: 20, sortBy, status: statusTab, sectionId: currentSectionId }
      });
      if (res && res.items) {
        setPosts(res.items);
        setTotal(res.total || 0);
      }
    } catch {
      message.error('拉取帖子失败');
    } finally {
      setLoading(false);
    }
  }, [search, activeTag, page, sortBy, statusTab, currentSectionId]);

  useEffect(() => { fetchPosts(); }, [fetchPosts]);

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/bbs/posts/${id}`);
      message.success('帖子已删除');
      fetchPosts();
    } catch {
      message.error('删除失败');
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.length === 0) return;
    try {
      await api.delete('/bbs/posts/batch', { data: { ids: selectedIds } });
      message.success(`成功删除 ${selectedIds.length} 篇帖子`);
      setSelectedIds([]);
      setIsManageMode(false);
      fetchPosts();
    } catch {
      message.error('批量删除失败');
    }
  };

  const handlePin = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res: any = await api.put(`/bbs/posts/${id}/pin`);
      message.success(res.isPinned ? '已置顶' : '已取消置顶');
      fetchPosts();
    } catch {
      message.error('操作失败');
    }
  };

  const handleArchive = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.put(`/bbs/posts/${id}/archive`);
      message.success('已归档');
      fetchPosts();
    } catch {
      message.error('归档失败');
    }
  };

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [postToDelete, setPostToDelete] = useState<any>(null);

  const getMenuItems = (item: any) => {
    const items: any[] = [];
    const isOwner = user?.id === item.authorId;

    if (isOwner || canEdit) {
      items.push({ key: 'edit', icon: <EditOutlined />, label: '编辑' });
    }
    if (canEdit) {
      items.push({
        key: 'pin', icon: <PushpinOutlined />,
        label: item.isPinned ? '取消置顶' : '置顶',
      });
      items.push({ key: 'archive', icon: <InboxOutlined />, label: '归档' });
    }
    if (isOwner || canDelete) {
      items.push({ key: 'remove', icon: <DeleteOutlined />, label: '删除', danger: true });
    }
    return items;
  };

  const handleMenuClick = (info: any, item: any) => {
    if (info.domEvent) {
      info.domEvent.stopPropagation();
      info.domEvent.preventDefault();
    }
    
    const key = info.key;
    switch (key) {
      case 'edit':
        navigate(`/bbs/${item.id}/edit`);
        break;
      case 'pin':
        handlePin(item.id, info.domEvent || new MouseEvent('click'));
        break;
      case 'archive':
        handleArchive(item.id, info.domEvent || new MouseEvent('click'));
        break;
      case 'remove':
        setPostToDelete(item);
        setDeleteModalOpen(true);
        break;
    }
  };

  const statusTabs = [
    { key: 'active', label: '全部' },
    { key: 'archived', label: '已归档' },
  ];

  const sortOptions = [
    { key: 'latestReply', label: '最新回复排序' },
    { key: 'latestPost', label: '最新发布排序' },
    { key: 'viewCount', label: '按阅读量排序' },
  ];

  // 切换板块
  const handleSectionChange = (sectionId?: number) => {
    if (sectionId) {
      setSearchParams({ section: String(sectionId) });
    } else {
      setSearchParams({});
    }
    setPage(1);
    setActiveTag('');
  };

  // (The header title displaying currentSection has been removed to compress space)

  return (
    <div className="bbs-page">
      {/* 顶部粘性容纳区 */}
      <div className="bbs-top-sticky">
        {/* Tab 栏 + 操作栏 */}
        <div className="bbs-toolbar">
        <div className="bbs-tabs">
          {statusTabs.map(tab => (
            <span
              key={tab.key}
              className={`bbs-tab ${statusTab === tab.key ? 'active' : ''}`}
              onClick={() => { setStatusTab(tab.key); setPage(1); }}
            >
              {tab.label}
            </span>
          ))}
        </div>

        {/* 搜索框 - 紧贴tabs */}
        <Input
          placeholder="搜索帖子..."
          allowClear
          value={searchInput}
          onChange={e => {
            const val = e.target.value;
            setSearchInput(val);
            if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
            searchTimeoutRef.current = setTimeout(() => {
              setSearch(val);
              setPage(1);
            }, 300);
          }}
          style={{ width: isMobile ? 120 : 200 }}
          prefix={<SearchOutlined style={{ color: 'var(--text-muted)' }} />}
        />

        <div className="bbs-toolbar-right">
          {/* 移动端筛选按钮 */}
          {isMobile && (
            <span className="vt-btn" onClick={() => setFilterDrawerOpen(true)}>
              <BarsOutlined /> 筛选
            </span>
          )}

          {/* 视图切换 */}
          <div className="bbs-view-toggle">
            <span className={`vt-btn ${viewMode === 'list' ? 'active' : ''}`} onClick={() => setViewMode('list')}>
              <BarsOutlined />
            </span>
            <span className={`vt-btn ${viewMode === 'card' ? 'active' : ''}`} onClick={() => setViewMode('card')}>
              <AppstoreOutlined />
            </span>
          </div>

          {/* 排序 */}
          <Dropdown menu={{
            items: sortOptions.map(o => ({ key: o.key, label: o.label })),
            onClick: ({ key }) => setSortBy(key),
          }}>
            <span className="bbs-sort-btn">
              {sortOptions.find(o => o.key === sortBy)?.label} ▾
            </span>
          </Dropdown>

          {/* 管理模式/发布按钮 */}
          {isManageMode && selectedIds.length > 0 && (
            <button className="bbs-publish-btn" onClick={handleBatchDelete} style={{ marginRight: 8, background: 'var(--danger)', color: 'white', border: 'none' }}>
              <DeleteOutlined style={{ marginRight: 4 }} /> 删除 ({selectedIds.length})
            </button>
          )}
          {canDelete && (
            <button className={`bbs-publish-btn ${isManageMode ? 'manage-active' : ''}`} onClick={() => {
              setIsManageMode(!isManageMode);
              setSelectedIds([]);
            }} style={{ marginRight: 8, background: isManageMode ? 'var(--bg-secondary)' : 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
              {isManageMode ? '退出管理' : '批量管理'}
            </button>
          )}

          {canCreate && !isMobile && (
            <button className="bbs-publish-btn" onClick={() => navigate(currentSectionId ? `/bbs/new?section=${currentSectionId}` : '/bbs/new')}>
              <PlusOutlined style={{ marginRight: 4 }} /> 发布新帖
            </button>
          )}
        </div>
      </div>
      </div>

      {/* 移动端悬浮发帖按钮 */}
      {canCreate && isMobile && (
        <button
          onClick={() => navigate(currentSectionId ? `/bbs/new?section=${currentSectionId}` : '/bbs/new')}
          style={{
            position: 'fixed',
            bottom: 32,
            right: 24,
            width: 56,
            height: 56,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #6366f1, #818cf8)',
            color: 'white',
            border: 'none',
            boxShadow: '0 4px 16px rgba(99, 102, 241, 0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 24,
            zIndex: 100,
            cursor: 'pointer'
          }}
        >
          <PlusOutlined />
        </button>
      )}

      {/* 三栏布局：左侧边栏 + 右侧帖子列表 */}
      {/* 三栏布局：左侧边栏 + 右侧帖子列表 */}
      <div className="bbs-layout">
        {/* ===== 左侧边栏 (桌面端) / 抽屉 (移动端) ===== */}
        {isMobile ? (
          <Drawer
            title="分类与筛选"
            placement="right"
            onClose={() => setFilterDrawerOpen(false)}
            open={filterDrawerOpen}
            width={280}
            bodyStyle={{ padding: 16 }}
          >
            {/* 板块导航 */}
            <div className="bbs-sidebar-box" style={{ marginBottom: 16 }}>
              <div className="bbs-sidebar-box-title">📋 板块导航</div>
              <div
                className={`bbs-section-item ${!currentSectionId ? 'active' : ''}`}
                onClick={() => { handleSectionChange(); setFilterDrawerOpen(false); }}
              >
                <span className="bbs-section-icon">🏠</span>
                <span>全部</span>
              </div>
              {sections.map(sec => (
                <div
                  key={sec.id}
                  className={`bbs-section-item ${currentSectionId === sec.id ? 'active' : ''}`}
                  onClick={() => { handleSectionChange(sec.id); setFilterDrawerOpen(false); }}
                >
                  <span className="bbs-section-icon">{sec.icon || '📁'}</span>
                  <span>{sec.name}</span>
                </div>
              ))}
            </div>

            {/* 标签筛选 */}
            {presetTags.length > 0 && (
              <div className="bbs-sidebar-box">
                <div className="bbs-sidebar-box-title">🏷️ 标签筛选</div>
                <div className="bbs-sidebar-tags">
                  {presetTags.map(tag => (
                    <span
                      key={tag.id}
                      className={`bbs-sidebar-tag ${activeTag === tag.name ? 'active' : ''}`}
                      onClick={() => { setActiveTag(activeTag === tag.name ? '' : tag.name); setPage(1); setFilterDrawerOpen(false); }}
                      style={tag.color && activeTag !== tag.name ? { borderColor: tag.color, color: tag.color } : {}}
                    >
                      {tag.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </Drawer>
        ) : (
          <div className="bbs-sidebar">
            {/* 板块导航 */}
            <div className="bbs-sidebar-box">
              <div className="bbs-sidebar-box-title">📋 板块导航</div>
              <div
                className={`bbs-section-item ${!currentSectionId ? 'active' : ''}`}
                onClick={() => handleSectionChange()}
              >
                <span className="bbs-section-icon">🏠</span>
                <span>全部</span>
              </div>
              {sections.map(sec => (
                <div
                  key={sec.id}
                  className={`bbs-section-item ${currentSectionId === sec.id ? 'active' : ''}`}
                  onClick={() => handleSectionChange(sec.id)}
                >
                  <span className="bbs-section-icon">{sec.icon || '📁'}</span>
                  <span>{sec.name}</span>
                </div>
              ))}
            </div>

            {/* 标签筛选 */}
            {presetTags.length > 0 && (
              <div className="bbs-sidebar-box">
                <div className="bbs-sidebar-box-title">🏷️ 标签筛选</div>
                <div className="bbs-sidebar-tags">
                  {presetTags.map(tag => (
                    <span
                      key={tag.id}
                      className={`bbs-sidebar-tag ${activeTag === tag.name ? 'active' : ''}`}
                      onClick={() => { setActiveTag(activeTag === tag.name ? '' : tag.name); setPage(1); }}
                      style={tag.color && activeTag !== tag.name ? { borderColor: tag.color, color: tag.color } : {}}
                    >
                      {tag.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ===== 右侧主体 ===== */}
        <div className="bbs-main">
          <div className="bbs-list-area">
            {loading ? (
              <div style={{ textAlign: 'center', padding: '80px 0' }}><Spin size="large" /></div>
            ) : posts.length === 0 ? (
              <div className="bbs-empty">暂无话题，快来发布第一篇吧！</div>
            ) : viewMode === 'list' ? (
              /* ========== 紧凑行模式 ========== */
              <div className="bbs-compact-list">
                {posts.map(item => {
                  const rowClass = `bbs-row ${item.isPinned ? 'pinned' : ''} ${selectedIds.includes(item.id) ? 'selected' : ''}`;
                  const handleRowClick = () => {
                    if (isManageMode) {
                      setSelectedIds(prev => prev.includes(item.id) ? prev.filter(id => id !== item.id) : [...prev, item.id]);
                    } else {
                      navigate(`/bbs/${item.id}`);
                    }
                  };
                  const checkboxEl = isManageMode && (
                    <div className="bbs-row-checkbox" onClick={e => e.stopPropagation()}>
                      <Checkbox checked={selectedIds.includes(item.id)} onChange={e => {
                        if (e.target.checked) setSelectedIds(p => [...p, item.id]);
                        else setSelectedIds(p => p.filter(id => id !== item.id));
                      }} />
                    </div>
                  );
                  const actionEl = !isManageMode && (canEdit || canDelete || user?.id === item.authorId) && (
                    <Dropdown
                      menu={{
                        items: getMenuItems(item),
                        onClick: (info) => handleMenuClick(info, item),
                      }}
                      trigger={['click']}
                    >
                      <span className="bbs-row-action" onClick={e => e.stopPropagation()}>
                        <MoreOutlined />
                      </span>
                    </Dropdown>
                  );

                  if (isMobile) {
                    // ========== 手机端：垂直紧凑布局 ==========
                    return (
                      <div key={item.id} className={rowClass} onClick={handleRowClick}>
                        {checkboxEl}
                        <div className="bbs-row-m-title">
                          {item.isPinned && <span className="bbs-pin-badge">置顶</span>}
                          {item.section && <span className="bbs-section-badge">{item.section.name}</span>}
                          {item.title}
                        </div>
                        <div className="bbs-row-m-footer">
                          <div className="bbs-row-m-left">
                            <span className="bbs-row-m-author">{item.author?.realName || item.author?.username}</span>
                            <span className="bbs-row-m-date">{new Date(item.createdAt).toLocaleDateString('zh-CN')}</span>
                            {safeTags(item.tags).map((t: string) => (
                              <Tag key={t} style={{ fontSize: 11, lineHeight: '18px', padding: '0 6px', borderRadius: 4, margin: 0 }}>{t}</Tag>
                            ))}
                          </div>
                          <div className="bbs-row-m-right">
                            <span className="bbs-stat"><EyeOutlined /><span className="bbs-stat-num">{item.viewCount || 0}</span></span>
                            <span className="bbs-stat"><MessageOutlined /><span className="bbs-stat-num">{item.commentCount || 0}</span></span>
                            {actionEl}
                          </div>
                        </div>
                      </div>
                    );
                  }

                  // ========== 桌面端：原始水平行布局 ==========
                  return (
                    <div key={item.id} className={rowClass} onClick={handleRowClick}>
                      {checkboxEl}
                      <div className="bbs-row-icon">
                        <MessageFilled style={{ fontSize: 20, color: item.isPinned ? '#f59e0b' : 'var(--text-muted)' }} />
                      </div>
                      <div className="bbs-row-main">
                        <div className="bbs-row-title">
                          {item.isPinned && <span className="bbs-pin-badge">置顶</span>}
                          {item.section && <span className="bbs-section-badge">{item.section.name}</span>}
                          {item.title}
                        </div>
                        <div className="bbs-row-meta">
                          <span>{item.author?.realName || item.author?.username}</span>
                          <span>{new Date(item.createdAt).toLocaleString()}</span>
                          {safeTags(item.tags).map((t: string) => (
                            <Tag key={t} style={{ fontSize: 11, lineHeight: '18px', padding: '0 6px', borderRadius: 4 }}>{t}</Tag>
                          ))}
                        </div>
                      </div>
                      <div className="bbs-row-stats">
                        <span className="bbs-stat"><EyeOutlined /> {item.viewCount || 0}</span>
                        <span className="bbs-stat"><MessageOutlined /> {item.commentCount || 0}</span>
                      </div>
                      {actionEl}
                    </div>
                  );
                })}
              </div>
            ) : (
              /* ========== 卡片模式 ========== */
              <div className="bbs-card-grid">
                {posts.map(item => (
                  <div
                    key={item.id}
                    className={`bbs-card ${selectedIds.includes(item.id) ? 'selected' : ''}`}
                    onClick={() => {
                      if (isManageMode) {
                        setSelectedIds(prev => prev.includes(item.id) ? prev.filter(id => id !== item.id) : [...prev, item.id]);
                      } else {
                        navigate(`/bbs/${item.id}`);
                      }
                    }}
                  >
                    {isManageMode && (
                      <div className="bbs-card-checkbox" style={{ position: 'absolute', top: 12, right: 12, zIndex: 2 }} onClick={e => e.stopPropagation()}>
                        <Checkbox checked={selectedIds.includes(item.id)} onChange={e => {
                          if (e.target.checked) setSelectedIds(p => [...p, item.id]);
                          else setSelectedIds(p => p.filter(id => id !== item.id));
                        }} />
                      </div>
                    )}
                    {item.isPinned && <div className="bbs-card-pin">📌 置顶</div>}
                    {item.section && <div style={{ marginBottom: 6 }}><span className="bbs-section-badge">{item.section.name}</span></div>}
                    <div className="bbs-card-title">{item.title}</div>
                    <div className="bbs-card-summary">{(item.content || '').replace(/[#*`>[\]!()]/g, '').slice(0, 80)}...</div>
                    <div className="bbs-card-tags">
                      {safeTags(item.tags).slice(0, 3).map((t: string) => (
                        <Tag key={t} style={{ fontSize: 11 }}>{t}</Tag>
                      ))}
                    </div>
                    <div className="bbs-card-footer">
                      <span className="bbs-card-author">{item.author?.realName || '匿名'}</span>
                      <span className="bbs-card-stats">
                        <EyeOutlined /> {item.viewCount || 0}
                        <MessageOutlined style={{ marginLeft: 12 }} /> {item.commentCount || 0}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 分页 */}
            {total > 20 && (
              <div className="bbs-pagination">
                <Pagination
                  current={page}
                  total={total}
                  pageSize={20}
                  onChange={p => setPage(p)}
                  showSizeChanger={false}
                  size="small"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 删除确认弹窗 */}
      <Modal
        title="确认删除"
        open={deleteModalOpen}
        onOk={() => {
          if (postToDelete) handleDelete(postToDelete.id);
          setDeleteModalOpen(false);
        }}
        onCancel={() => setDeleteModalOpen(false)}
        okText="删除"
        okButtonProps={{ danger: true }}
        cancelText="取消"
      >
        <p>确定要删除帖子「{postToDelete?.title}」吗？此操作不可恢复。</p>
      </Modal>

    </div>
  );
}
