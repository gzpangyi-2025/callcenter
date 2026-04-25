import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Card, Table, Button, Tag, Space, Input, Select, Segmented, Spin,
  Row, Col, Modal, Form, message, Empty, Popconfirm, Cascader, Tooltip
} from 'antd';
import {
  PlusOutlined, SearchOutlined, AppstoreOutlined,
  UnorderedListOutlined, CheckOutlined,
  FilterOutlined, DeleteOutlined, LockOutlined, DesktopOutlined
} from '@ant-design/icons';
import { RequirePermission } from '../../components/RequirePermission';
import { ticketsAPI, usersAPI, categoryAPI } from '../../services/api';
import type { Ticket } from '../../types/ticket';
import { useSocketStore } from '../../stores/socketStore';
import { useAuthStore } from '../../stores/authStore';
import { useNavigate } from 'react-router-dom';
import { Resizable } from 'react-resizable';
import 'react-resizable/css/styles.css';


const ResizableTitle = (props: any) => {
  const { onResize, width, ...restProps } = props;
  if (!width) return <th {...restProps} />;
  return (
    <Resizable
      width={width}
      height={0}
      handle={
        <span
          className="react-resizable-handle"
          onClick={(e) => e.stopPropagation()}
          style={{ position: 'absolute', right: -5, bottom: 0, zIndex: 1, width: 10, height: '100%', cursor: 'col-resize' }}
        />
      }
      onResize={onResize}
      draggableOpts={{ enableUserSelectHack: false }}
    >
      <th {...restProps} />
    </Resizable>
  );
};

const { Option } = Select;

const statusMap: Record<string, { color: string; text: string }> = {
  pending: { color: 'orange', text: '待接单' },
  in_progress: { color: 'blue', text: '服务中' },
  closing: { color: 'volcano', text: '待确认' },
  closed: { color: 'green', text: '已关闭' },
};

const typeMap: Record<string, string> = {
  software: '软件问题',
  hardware: '硬件问题',
  network: '网络问题',
  security: '安全问题',
  database: '数据库',
  other: '其他',
};

const PAGE_SIZE = 20; // 虚拟列表每次加载20条

const TicketList: React.FC = () => {
  const [viewMode, setViewMode] = useState<string>('list');
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [tableHeight, setTableHeight] = useState(window.innerHeight - 265);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const { user } = useAuthStore();
  const sentinelRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  
  // 自定义列宽
  const [colWidths, setColWidths] = useState<Record<string, number>>({
    ticketNo: 185,
    title: 200,
    type: 165,
    status: 90,
    customerName: 120,
    creator: 120,
    assignee: 120,
    createdAt: 170,
    action: 100,
  });
  const [createForm] = Form.useForm();
  const navigate = useNavigate();
  const [assigneeOptions, setAssigneeOptions] = useState<any[]>([]);
  const [assigneeSearching, setAssigneeSearching] = useState(false);
  const [categoryTree, setCategoryTree] = useState<any[]>([]);
  const [tableFilters, setTableFilters] = useState<Record<string, any>>({});
  const [aggregates, setAggregates] = useState<{
    categories: any[], customers: any[], creators: any[], assignees: any[]
  }>({ categories: [], customers: [], creators: [], assignees: [] });
  const [filterSearchText, setFilterSearchText] = useState<Record<string, string>>({});

  let searchTimer: any = null;

  const handleAssigneeSearch = (value: string) => {
    if (searchTimer) clearTimeout(searchTimer);
    if (!value || value.length < 1) { setAssigneeOptions([]); return; }
    searchTimer = setTimeout(async () => {
      setAssigneeSearching(true);
      try {
        const res: any = await usersAPI.search(value);
        if (res.code === 0) {
          setAssigneeOptions(res.data.map((u: any) => ({
            value: u.id,
            label: `${u.realName || u.displayName || u.username} (${u.username})`,
          })));
        }
      } catch {} finally { setAssigneeSearching(false); }
    }, 300);
  };

  const getFilterDropdown = (field: string, placeholder: string) => ({ setSelectedKeys, selectedKeys, confirm, clearFilters }: any) => {
    const list = aggregates[field as keyof typeof aggregates] || [];
    const searchText = filterSearchText[field] || '';
    const filteredList = list
      .filter((item: any) => item.label?.toString().toLowerCase().includes(searchText.toLowerCase()))
      .sort((a: any, b: any) => (b.count || 0) - (a.count || 0));

    return (
      <div style={{ padding: 8, width: 240 }} onKeyDown={(e) => e.stopPropagation()}>
        <Input
          placeholder={placeholder}
          value={searchText}
          onChange={(e) => setFilterSearchText({ ...filterSearchText, [field]: e.target.value })}
          style={{ marginBottom: 8 }}
          prefix={<SearchOutlined />}
          allowClear
          autoFocus
        />
        <div style={{ maxHeight: 200, overflowY: 'auto', marginBottom: 8, display: 'flex', flexDirection: 'column' }}>
          {filteredList.map((item: any) => {
            const isSelected = selectedKeys.includes(item.value);
            return (
              <div 
                key={item.value} 
                style={{ padding: '6px 8px', display: 'flex', alignItems: 'center', cursor: 'pointer', borderRadius: 4, background: isSelected ? 'var(--bg-hover)' : 'transparent' }}
                onClick={() => {
                  const newKeys = isSelected ? selectedKeys.filter((k: any) => k !== item.value) : [...selectedKeys, item.value];
                  setSelectedKeys(newKeys);
                }}
              >
                <input type="checkbox" checked={isSelected} readOnly style={{ marginRight: 8, cursor: 'pointer' }} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.label}
                </span>
                <span style={{ color: 'var(--text-color-secondary)', fontSize: 12, marginLeft: 8 }}>({item.count})</span>
              </div>
            );
          })}
          {filteredList.length === 0 && <div style={{ padding: 8, color: 'var(--text-color-secondary)', textAlign: 'center' }}>无匹配数据</div>}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          <Button onClick={() => { clearFilters(); confirm(); }} size="small" style={{ width: 90 }}>清除筛选</Button>
          <Button type="primary" onClick={() => confirm()} size="small" style={{ width: 90 }}>确定</Button>
        </div>
      </div>
    );
  };

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth <= 768;
      setIsMobile(mobile);
      setTableHeight(window.innerHeight - 265);
      // 手机端默认使用卡片视图
      if (mobile) setViewMode('card');
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const { socket } = useSocketStore();

  // 加载第一页（重置）
  const loadTickets = useCallback(async () => {
    setLoading(true);
    setPage(1);
    try {
      const params = {
        page: 1,
        pageSize: PAGE_SIZE,
        status: statusFilter as any,
        keyword: keyword || undefined,
        category1: categoryFilter?.[0] || tableFilters.type?.[0] || undefined,
        category2: categoryFilter?.[1] || undefined,
        category3: categoryFilter?.[2] || undefined,
        customerName: tableFilters.customerName?.[0] || undefined,
        creatorId: tableFilters.creator?.[0] || undefined,
        assigneeId: tableFilters.assignee?.[0] || undefined,
      };
      
      const [res, aggRes]: any = await Promise.all([
        ticketsAPI.getAll(params),
        ticketsAPI.getAggregates(params)
      ]);
      
      if (aggRes.code === 0) {
        setAggregates(aggRes.data);
      }
      if (res.code === 0) {
        setTickets(res.data.items);
        setTotal(res.data.total || 0);
        setHasMore((res.data.items?.length || 0) >= PAGE_SIZE);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [statusFilter, keyword, categoryFilter, tableFilters]);

  // 加载更多（追加）
  const loadMore = useCallback(async (nextPage: number) => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const res: any = await ticketsAPI.getAll({
        page: nextPage,
        pageSize: PAGE_SIZE,
        status: statusFilter as any,
        keyword: keyword || undefined,
        category1: categoryFilter?.[0] || tableFilters.type?.[0] || undefined,
        category2: categoryFilter?.[1] || undefined,
        category3: categoryFilter?.[2] || undefined,
        customerName: tableFilters.customerName?.[0] || undefined,
        creatorId: tableFilters.creator?.[0] || undefined,
        assigneeId: tableFilters.assignee?.[0] || undefined,
      });
      if (res.code === 0) {
        const newItems = res.data.items || [];
        setTickets(prev => [...prev, ...newItems]);
        setTotal(res.data.total || 0);
        setHasMore(newItems.length >= PAGE_SIZE);
        setPage(nextPage);
      }
    } catch {} finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, statusFilter, keyword, categoryFilter, tableFilters]);

  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  // IntersectionObserver: 卡片视图自动无限滚动
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore && !loading) {
          loadMore(page + 1);
        }
      },
      { rootMargin: '100px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [viewMode, hasMore, loadingMore, loading, page, loadMore]);

  // 监听全局工单事件，实时刷新列表
  useEffect(() => {
    if (!socket) return;
    const handleTicketEvent = () => {
      loadTickets();
    };
    socket.on('ticketEvent', handleTicketEvent);
    return () => {
      socket.off('ticketEvent', handleTicketEvent);
    };
  }, [socket, loadTickets]);

  // 加载工单分类树
  useEffect(() => {
    categoryAPI.getTree().then((res: any) => {
      if (res.code === 0 && res.data?.length > 0) {
        setCategoryTree(res.data);
      }
    }).catch(() => {});
  }, []);

  const handleSearch = () => {
    setPage(1);
    loadTickets();
  };

  const handleCreate = async (values: any) => {
    try {
      // 将 Cascader 的 categoryPath 转为 category1/2/3
      const submitData = { ...values };
      if (values.categoryPath && values.categoryPath.length > 0) {
        submitData.category1 = values.categoryPath[0] || '';
        submitData.category2 = values.categoryPath[1] || '';
        submitData.category3 = values.categoryPath[2] || '';
        submitData.type = 'other'; // 保持旧字段兼容
      }
      delete submitData.categoryPath;
      const res: any = await ticketsAPI.create(submitData);
      if (res.code === 0) {
        message.success('工单创建成功');
        setCreateModalOpen(false);
        createForm.resetFields();
        loadTickets();
      }
    } catch (err: any) {
//       message.error(err.response?.data?.message || '创建失败'); // Removed by global interceptor refactor
    }
  };

  const handleAssign = async (id: number) => {
    try {
      const res: any = await ticketsAPI.assign(id);
      if (res.code === 0) {
        message.success('接单成功');
        loadTickets();
      }
    } catch (err: any) {
//       message.error(err.response?.data?.message || '接单失败'); // Removed by global interceptor refactor
    }
  };

  const handleBatchDelete = async () => {
    if (selectedRowKeys.length === 0) return;
    setBatchDeleting(true);
    try {
      const res: any = await ticketsAPI.batchDelete(selectedRowKeys as number[]);
      if (res.code === 0) {
        message.success(res.message || '批量删除成功');
        setSelectedRowKeys([]);
        loadTickets();
      }
    } catch (err: any) {
//       message.error(err.response?.data?.message || '批量删除发生错误'); // Removed by global interceptor refactor
    } finally {
      setBatchDeleting(false);
    }
  };

  const columns = [
    {
      title: '工单号', dataIndex: 'ticketNo', width: colWidths.ticketNo,
      render: (text: string, record: any) => (
        <div>
          <span style={{ color: 'var(--primary-light)', fontWeight: 500 }}>{text}</span>
          {record.serviceNo && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{record.serviceNo}</div>}
        </div>
      ),
    },
    { 
      title: '标题', dataIndex: 'title', width: colWidths.title, ellipsis: { showTitle: false },
      render: (text: string, record: any) => (
        <Tooltip placement="topLeft" title={text}>
          <span>
            {record.isRoomLocked && <LockOutlined style={{ color: '#ef4444', marginRight: 6, fontSize: 12 }} />}
            {record.hasActiveScreenShare && <DesktopOutlined style={{ color: '#10b981', marginRight: 6, fontSize: 12 }} />}
            {text}
          </span>
        </Tooltip>
      )
    },
    {
      title: '分类', dataIndex: 'type', width: colWidths.type,
      filterDropdown: getFilterDropdown('categories', '搜索分类'),
      render: (_type: string, record: any) => {
        if (record.category1) {
          const color = record.category1 === '硬件设备' ? 'volcano' : 'geekblue';
          const label = record.category2 ? `${record.category1} · ${record.category2}` : record.category1;
          return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
              <Tag color={color} style={{ margin: 0 }}>{label}</Tag>
              {record.category3 && <Tag style={{ margin: 0, fontSize: 12 }}>{record.category3}</Tag>}
            </div>
          );
        }
        return <Tag>{typeMap[_type] || _type}</Tag>;
      },
    },
    {
      title: '状态', dataIndex: 'status', width: colWidths.status,
      render: (status: string) => (
        <Tag color={statusMap[status]?.color}>{statusMap[status]?.text}</Tag>
      ),
    },
    { 
      title: '客户', dataIndex: 'customerName', width: colWidths.customerName, ellipsis: true,
      filterDropdown: getFilterDropdown('customers', '搜索客户'),
    },
    {
      title: '创建人', dataIndex: 'creator', width: colWidths.creator,
      filterDropdown: getFilterDropdown('creators', '搜索创建人'),
      render: (c: any) => c ? <span>{c.realName || '未知'} <span style={{fontSize: 12, color: 'var(--text-color-secondary)'}}>({c.username})</span></span> : '-',
    },
    {
      title: '当前接单人', dataIndex: 'assignee', width: colWidths.assignee,
      filterDropdown: getFilterDropdown('assignees', '搜索接单人'),
      render: (a: any) => a ? <span>{a.realName || '未知'} <span style={{fontSize: 12, color: 'var(--text-color-secondary)'}}>({a.username})</span></span> : '-',
    },
    {
      title: '创建时间', dataIndex: 'createdAt', width: colWidths.createdAt,
      render: (d: string) => new Date(d).toLocaleString('zh-CN'),
    },
    {
      title: '操作', key: 'action', width: colWidths.action, fixed: 'right' as const,
      render: (_: any, record: any) => (
        <Space onClick={(e) => e.stopPropagation()}>
          {record.status === 'pending' && (
            <Button type="link" size="small" icon={<CheckOutlined />}
              onClick={() => handleAssign(record.id)} style={{ color: 'var(--success)' }}>
              接单
            </Button>
          )}
        </Space>
      ),
    },
  ];

  const resizableColumns = columns.map((col: any) => ({
    ...col,
    onHeaderCell: (column: any) => ({
      width: column.width,
      onResize: (_: any, { size }: any) => {
        setColWidths(prev => ({ ...prev, [column.dataIndex || column.key]: size.width }));
      },
    }),
  }));

  const scrollToTop = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    // 列表视图（虚拟滚动）：直接设置 scrollTop，smooth 会被虚拟渲染打断
    const virtualHolder = container.querySelector('.ant-table-tbody-virtual-holder');
    if (virtualHolder) {
      virtualHolder.scrollTop = 0;
      return;
    }
    // 列表视图（非虚拟）
    const tableBody = container.querySelector('.ant-table-body');
    if (tableBody) {
      tableBody.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    // 卡片视图：滚动外层的 .content-area
    const contentArea = document.querySelector('.content-area');
    if (contentArea) {
      contentArea.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, []);

  const handleScrollCapture = useCallback((e: React.UIEvent) => {
    const target = e.target as HTMLElement;
    
    // 检测滚动位置以显示/隐藏回到顶部按钮
    if (target && target.scrollHeight > target.clientHeight) {
      setShowScrollTop(target.scrollTop > 300);

      // 取消类名限制，只要是当前容器内存在有效滚动的节点，且距离底部小于100px即加载
      const { scrollHeight, scrollTop, clientHeight } = target;
      if (Math.ceil(scrollHeight - scrollTop) <= clientHeight + 100) {
        if (hasMore && !loadingMore && !loading) {
          loadMore(page + 1);
        }
      }
    }
  }, [hasMore, loadingMore, loading, page, loadMore]);

  // 卡片视图：监听 .content-area 滚动以显示/隐藏「回到首条」
  useEffect(() => {
    const contentArea = document.querySelector('.content-area');
    if (!contentArea) return;
    const handleContentScroll = () => {
      if (viewMode === 'card' || isMobile) {
        setShowScrollTop(contentArea.scrollTop > 300);
      }
    };
    contentArea.addEventListener('scroll', handleContentScroll, { passive: true });
    return () => contentArea.removeEventListener('scroll', handleContentScroll);
  }, [viewMode, isMobile]);

  return (
    <div className={`fade-in ${!isMobile ? 'page-flex-layout' : ''}`} ref={containerRef} onScrollCapture={handleScrollCapture}>
      {/* 固定吸顶容器 */}
      <div className={!isMobile ? 'page-sticky-header' : ''} style={isMobile ? {
        position: 'sticky',
        top: -12,
        zIndex: 10,
        background: 'var(--bg-primary)',
        margin: '-12px -12px 0 -12px',
        padding: '12px 12px 0 12px',
      } : { background: 'var(--bg-primary)' }}>
        {/* 顶部标题栏 */}
        <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
        flexWrap: 'wrap',
        gap: 8,
      }}>
        <h2 style={{ fontSize: isMobile ? 18 : 22, fontWeight: 600, margin: 0 }}>工单广场</h2>
        <Space>
          {isMobile && (
            <Button icon={<FilterOutlined />}
              onClick={() => setShowFilters(!showFilters)}
              type={showFilters ? 'primary' : 'default'}
              style={showFilters ? { background: 'var(--primary)', border: 'none' } : {}} />
          )}
          {selectedRowKeys.length > 0 && !isMobile && viewMode === 'list' && (
            <RequirePermission permissions={['tickets:delete']}>
              <Popconfirm 
                title="确认批量删除工单?"
                description={`您已选中 ${selectedRowKeys.length} 条工单。对于越权记录服务端将中止删除。`}
                onConfirm={handleBatchDelete}
                okText="彻底删除" cancelText="取消"
                okButtonProps={{ danger: true, loading: batchDeleting }}
                placement="bottomRight"
              >
                <Button danger icon={<DeleteOutlined />}>
                  批量删除 ({selectedRowKeys.length})
                </Button>
              </Popconfirm>
            </RequirePermission>
          )}
          <RequirePermission permissions={['tickets:create']}>
            <Button type="primary" icon={<PlusOutlined />}
              onClick={() => setCreateModalOpen(true)}
              style={{ background: 'linear-gradient(135deg, #4f46e5, #818cf8)', border: 'none', borderRadius: 8 }}>
              {isMobile ? '创建' : '创建工单'}
            </Button>
          </RequirePermission>
        </Space>
      </div>

      {/* 筛选工具栏 */}
      {(!isMobile || showFilters) && (
        <Card style={{ marginBottom: 12, borderRadius: 12 }} bodyStyle={{ padding: '8px 16px' }}>
          {isMobile ? (
            /* 手机端筛选：垂直堆叠 */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Input placeholder="搜索工单号/服务单号/标题/描述" prefix={<SearchOutlined />}
                allowClear
                value={keyword} onChange={(e) => setKeyword(e.target.value)}
                onPressEnter={handleSearch}
                onFocus={(e) => e.target.select()}
                style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)' }} />
              <div style={{ display: 'flex', gap: 8 }}>
                <Cascader
                  options={categoryTree}
                  placeholder="三级分类筛选"
                  changeOnSelect
                  allowClear
                  value={categoryFilter}
                  onChange={(v) => { setCategoryFilter((v as string[]) || []); setPage(1); }}
                  style={{ flex: 1.5 }}
                  showSearch={{ filter: (input: string, path: any[]) => path.some((opt: any) => opt.label.toLowerCase().includes(input.toLowerCase())) }}
                />
                <Select placeholder="状态筛选" allowClear style={{ flex: 1 }}
                  value={statusFilter} onChange={(v) => { setStatusFilter(v); setPage(1); }}>
                  <Option value="pending">待接单</Option>
                  <Option value="in_progress">服务中</Option>
                  <Option value="closing">待确认</Option>
                  <Option value="closed">已关闭</Option>
                </Select>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button onClick={handleSearch} type="primary" block
                  style={{ background: 'var(--primary)', border: 'none' }}>搜索</Button>
                {showScrollTop && (
                  <Button
                    type="link"
                    size="small"
                    onClick={scrollToTop}
                    style={{ padding: '0 4px', fontSize: 13 }}
                  >回到首条</Button>
                )}
              </div>
            </div>
          ) : (
            /* 桌面端筛选 */
            <Row gutter={12} align="middle">
              <Col flex="auto">
                <Space>
                  <Input placeholder="搜索工单号/服务单号/标题/描述" prefix={<SearchOutlined />}
                    allowClear
                    value={keyword} onChange={(e) => setKeyword(e.target.value)}
                    onPressEnter={handleSearch}
                    onFocus={(e) => e.target.select()}
                    style={{ width: 280, background: 'var(--bg-primary)', border: '1px solid var(--border)' }} />
                  <Cascader
                    options={categoryTree}
                    placeholder="三级分类筛选"
                    changeOnSelect
                    allowClear
                    value={categoryFilter}
                    onChange={(v) => { setCategoryFilter((v as string[]) || []); setPage(1); }}
                    style={{ width: 180 }}
                    showSearch={{ filter: (input: string, path: any[]) => path.some((opt: any) => opt.label.toLowerCase().includes(input.toLowerCase())) }}
                  />
                  <Select placeholder="状态筛选" allowClear style={{ width: 110 }}
                    value={statusFilter} onChange={(v) => { setStatusFilter(v); setPage(1); }}>
                    <Option value="pending">待接单</Option>
                    <Option value="in_progress">服务中</Option>
                    <Option value="closing">待确认</Option>
                    <Option value="closed">已关闭</Option>
                  </Select>
                  <Button onClick={handleSearch}>搜索</Button>
                </Space>
              </Col>
              <Col>
                <Space size={8}>
                  <Segmented value={viewMode} onChange={(v) => setViewMode(v as string)}
                    options={[
                      { value: 'list', icon: <UnorderedListOutlined /> },
                      { value: 'card', icon: <AppstoreOutlined /> },
                    ]} />
                  {showScrollTop && (
                    <Button
                      type="link"
                      size="small"
                      onClick={scrollToTop}
                      style={{ padding: '0 4px', fontSize: 13 }}
                    >回到首条</Button>
                  )}
                </Space>
              </Col>
            </Row>
          )}
        </Card>
      )}
      </div>

      <div className={!isMobile ? 'page-scroll-content' : ''} style={!isMobile && viewMode === 'list' ? { overflowY: 'hidden', position: 'relative' } : {}}>
      {/* 列表/卡片视图 */}
      {viewMode === 'list' && !isMobile ? (
        <>
          <Card style={{ borderRadius: 12 }}>
            <Table 
              components={{ header: { cell: ResizableTitle } }}
              size="small"
              columns={resizableColumns as any} 
              dataSource={tickets} 
              rowKey="id"
              loading={loading}
              scroll={{ x: 1260, y: tableHeight }}
              virtual
              rowSelection={{
                columnWidth: 56,
                selectedRowKeys,
                onChange: (newSelectedRowKeys) => setSelectedRowKeys(newSelectedRowKeys),
              }}
              onRow={(record) => {
                const isLocked = record.isRoomLocked;
                const userId = Number(user?.id);
                const isAuthorized = !isLocked
                  || Number(record.creatorId) === userId
                  || Number(record.assigneeId) === userId
                  || (record.participants || []).some((p: any) => Number(p.id) === userId)
                  || (user?.role as any)?.name === 'admin';
                return {
                  onClick: () => {
                    if (!isAuthorized) {
                      message.warning('该工单房间已锁定，您无权进入');
                      return;
                    }
                    navigate(`/tickets/${record.id}`);
                  },
                  style: { cursor: isAuthorized ? 'pointer' : 'not-allowed', opacity: isLocked && !isAuthorized ? 0.6 : 1 },
                };
              }}
              onChange={(_pagination, filters) => {
                setTableFilters(filters);
              }}
              pagination={false}
            />
          </Card>
          {/* 悬浮加载状态指示器 */}
          {(loadingMore || (!hasMore && tickets.length > 0)) && (
            <div style={{
              position: 'absolute',
              bottom: 30,
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(255,255,255,0.9)',
              backdropFilter: 'blur(4px)',
              boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
              padding: '4px 16px',
              borderRadius: 20,
              fontSize: 12,
              color: 'var(--text-muted)',
              zIndex: 10,
              pointerEvents: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}>
              {loadingMore ? <><Spin size="small" /> <span>加载中...</span></> : <span>已加载全部 {total} 条工单</span>}
            </div>
          )}
        </>
      ) : (
        <>
          <Row gutter={[isMobile ? 12 : 16, isMobile ? 12 : 16]}>
            {tickets.length === 0 && !loading ? (
              <Col span={24}><Card style={{ borderRadius: 12 }}><Empty description="暂无工单" /></Card></Col>
            ) : (
              tickets.map((ticket) => (
              <Col xs={24} sm={12} lg={8} xl={6} key={ticket.id}>
                  {(() => {
                    const isLocked = ticket.isRoomLocked;
                    const userId = Number(user?.id);
                    const isAuthorized = !isLocked
                      || Number(ticket.creatorId) === userId
                      || Number(ticket.assigneeId) === userId
                      || (ticket.participants || []).some((p: any) => Number(p.id) === userId)
                      || (user?.role as any)?.name === 'admin';
                    return (
                  <div className="ticket-card" style={{ opacity: isLocked && !isAuthorized ? 0.6 : 1, cursor: isAuthorized ? 'pointer' : 'not-allowed', position: 'relative' }}
                    onClick={() => {
                      if (!isAuthorized) { message.warning('该工单房间已锁定，您无权进入'); return; }
                      navigate(`/tickets/${ticket.id}`);
                    }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, alignItems: 'center' }}>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {ticket.ticketNo}{ticket.serviceNo && <span style={{ marginLeft: 8, opacity: 0.7 }}>{ticket.serviceNo}</span>}
                      </span>
                      <Space size={6} style={{ flexShrink: 0 }}>
                        {isLocked && (
                          <Tooltip title="房间已锁定">
                            <LockOutlined style={{ color: '#ef4444', fontSize: 14 }} />
                          </Tooltip>
                        )}
                        {ticket.hasActiveScreenShare && (
                          <Tooltip title="正在屏幕共享">
                            <DesktopOutlined style={{ color: '#10b981', fontSize: 14 }} />
                          </Tooltip>
                        )}
                        <Tag color={statusMap[ticket.status]?.color} style={{ margin: 0 }}>
                          {statusMap[ticket.status]?.text}
                        </Tag>
                      </Space>
                    </div>
                    <h4 style={{ marginBottom: 8, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ticket.title}</h4>
                    {ticket.category1 ? (
                      <div style={{ marginBottom: 8, display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                        <Tag color={ticket.category1 === '硬件设备' ? 'volcano' : 'geekblue'} style={{ margin: 0, fontSize: 11 }}>
                          {ticket.category2 ? `${ticket.category1} · ${ticket.category2}` : ticket.category1}
                        </Tag>
                        {ticket.category3 && <Tag style={{ margin: 0, fontSize: 11 }}>{ticket.category3}</Tag>}
                      </div>
                    ) : (
                      <div style={{ marginBottom: 8 }}><Tag style={{ fontSize: 11 }}>{typeMap[ticket.type] || ticket.type}</Tag></div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)' }}>
                      <span>{ticket.creator?.realName || ticket.creator?.displayName || '-'}</span>
                      <span>{new Date(ticket.createdAt).toLocaleDateString('zh-CN')}</span>
                    </div>
                    {ticket.status === 'pending' && (
                      <Button size="small" type="primary" block
                        icon={<CheckOutlined />}
                        onClick={(e) => { e.stopPropagation(); handleAssign(ticket.id); }}
                        style={{ marginTop: 10, background: 'var(--info)', border: 'none', borderRadius: 6, fontSize: 12 }}>
                        接单
                      </Button>
                    )}
                  </div>
                    );
                  })()}
                </Col>
              ))
            )}
          </Row>
          {/* 无限滚动哨兵 */}
          <div ref={sentinelRef} style={{ textAlign: 'center', padding: 16 }}>
            {loadingMore && <Spin size="small" />}
            {!hasMore && tickets.length > 0 && <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>已加载全部 {total} 条工单</span>}
          </div>
        </>
      )}
      </div>

      {/* 创建工单弹窗 */}
      <Modal title="创建技术支持工单" open={createModalOpen}
        onCancel={() => { setCreateModalOpen(false); createForm.resetFields(); }}
        onOk={() => createForm.submit()}
        width={isMobile ? '95vw' : 600}
        okText="提交" cancelText="取消"
        centered={isMobile}>
        <Form form={createForm} layout="vertical" onFinish={handleCreate}
          style={{ marginTop: 16 }}>
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input placeholder="请简要描述问题" />
          </Form.Item>
          <Form.Item name="description" label="问题描述" rules={[{ required: true, message: '请描述问题' }]}>
            <Input.TextArea rows={4} placeholder="请详细描述遇到的问题、影响范围..." />
          </Form.Item>
          <Row gutter={16}>
            <Col xs={24} sm={12}>
              {categoryTree.length > 0 ? (
                <Form.Item name="categoryPath" label="工单分类" rules={[{ required: true, message: '请选择工单分类' }]}>
                  <Cascader
                    options={categoryTree}
                    placeholder="支持类型 / 技术方向 / 品牌"
                    showSearch={{ filter: (input: string, path: any[]) => path.some((opt: any) => opt.label.toLowerCase().includes(input.toLowerCase())) }}
                    changeOnSelect
                  />
                </Form.Item>
              ) : (
                <Form.Item name="type" label="问题类型" initialValue="other">
                  <Select>
                    <Option value="software">软件问题</Option>
                    <Option value="hardware">硬件问题</Option>
                    <Option value="network">网络问题</Option>
                    <Option value="security">安全问题</Option>
                    <Option value="database">数据库</Option>
                    <Option value="other">其他</Option>
                  </Select>
                </Form.Item>
              )}
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="customerName" label="客户名称">
                <Input placeholder="请输入客户名称" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="serviceNo" label="服务单号">
            <Input placeholder="关联的服务单号 (选填)" />
          </Form.Item>
          <Form.Item name="assigneeId" label="指定接单人">
            <Select
              showSearch
              allowClear
              placeholder="留空则发布到工单广场，输入姓名/用户名可定向派单"
              filterOption={false}
              onSearch={handleAssigneeSearch}
              loading={assigneeSearching}
              options={assigneeOptions}
              notFoundContent={assigneeSearching ? '搜索中...' : '输入用户名或姓名搜索'}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default TicketList;
