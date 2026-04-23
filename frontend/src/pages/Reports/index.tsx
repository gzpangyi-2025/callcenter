import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, Row, Col, Breadcrumb, Empty, Spin, Segmented, Drawer, Button, Typography, Table, Tag, Statistic } from 'antd';
import {
  BarChartOutlined, TeamOutlined, ArrowsAltOutlined, ArrowRightOutlined, SyncOutlined,
  FileTextOutlined, ClockCircleOutlined, CheckCircleOutlined, DownloadOutlined
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { reportAPI, ticketsAPI } from '../../services/api';
import { message } from 'antd';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

/** 读取 CSS 变量的实际计算值，供 ECharts 使用（ECharts 不支持 var(--xxx) 语法） */
function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}

const ReportsPage: React.FC = () => {
  // ================= Control State =================
  const [loading, setLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [viewLevel, setViewLevel] = useState<1 | 2 | 3>(1);
  const [ticketDrawerState, setTicketDrawerState] = useState({ open: false, title: '', category3: '', role: '', userId: 0 });

  // Drilldown Paths
  const [drillPath, setDrillPath] = useState<{ category1?: string, category2?: string }>({});

  // ================= Dashboard Data (Level 1) =================
  const [summary, setSummary] = useState<any>(null);
  const [trendDimension, setTrendDimension] = useState<'day' | 'month' | 'quarter' | 'year'>('day');
  const [timeSeries, setTimeSeries] = useState<any[]>([]);
  const [categoryStats, setCategoryStats] = useState<{ category1: any[], category2: any[] }>({ category1: [], category2: [] });

  // ================= Drilldown Data (Level 2 & 3) =================
  const [level2Data, setLevel2Data] = useState<any[]>([]);
  const [level2Matrices, setLevel2Matrices] = useState<Record<string, any[]>>({});
  const [level3Data, setLevel3Data] = useState<any[]>([]);
  const [level3Matrices, setLevel3Matrices] = useState<Record<string, any>>({});

  // ================= User Tickets Data (Level 4 Drawer) =================
  const [userTickets, setUserTickets] = useState<any[]>([]);
  const [userTicketsLoading, setUserTicketsLoading] = useState(false);

  // Theme key to force chart re-render on theme switch
  const [themeKey, setThemeKey] = useState(0);
  useEffect(() => {
    const obs = new MutationObserver(() => setThemeKey(k => k + 1));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    return () => obs.disconnect();
  }, []);

  // Pre-compute colors per render cycle for ECharts
  const themeColors = useMemo(() => ({
    textPrimary: cssVar('--text-primary'),
    textSecondary: cssVar('--text-secondary'),
    bgPrimary: cssVar('--bg-primary'),
    bgSecondary: cssVar('--bg-secondary'),
    bgCard: cssVar('--bg-card'),
    border: cssVar('--border'),
  }), [themeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ================= Initial Load =================
  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const [sumRes, catRes] = await Promise.all([
        reportAPI.getSummary(),
        reportAPI.getCategoryStats()
      ]) as any[];
      if (sumRes.code === 0) setSummary(sumRes.data);
      if (catRes.code === 0) setCategoryStats(catRes.data);
    } catch {}
    setLoading(false);
  }, []);

  const loadTimeSeries = useCallback(async () => {
    try {
      const res = await reportAPI.getTimeSeries(trendDimension) as any;
      if (res.code === 0) setTimeSeries(res.data);
    } catch {}
  }, [trendDimension]);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);
  useEffect(() => { loadTimeSeries(); }, [loadTimeSeries]);

  // ================= Event Handlers =================
  const handleCat1Click = async (cat1Name: string) => {
    setDrillPath({ category1: cat1Name });
    setViewLevel(2);
    setLoading(true);
    try {
      const res = await reportAPI.getCategory2Stats(cat1Name) as any;
      if (res.code === 0) {
        setLevel2Data(res.data);
        const matrixPromises = res.data.map((cat: any) => reportAPI.getCategory3Stats(cat.name).catch(() => ({code: 1})));
        const matrixRes = await Promise.all(matrixPromises);
        const mMap: Record<string, any[]> = {};
        res.data.forEach((cat: any, i: number) => {
           if ((matrixRes[i] as any).code === 0) mMap[cat.name] = (matrixRes[i] as any).data;
        });
        setLevel2Matrices(mMap);
      }
    } catch {}
    setLoading(false);
  };

  const handleCat2Click = async (cat2Name: string) => {
    setDrillPath({ ...drillPath, category2: cat2Name });
    setViewLevel(3);
    setLoading(true);
    try {
      const res = await reportAPI.getCategory3Stats(cat2Name) as any;
      if (res.code === 0) {
        setLevel3Data(res.data);
        // 传入 parentCategory=cat2Name，确保只统计当前 category2 下的品牌数据
        const matrixPromises = res.data.map((cat: any) => reportAPI.getCrossMatrix(cat.name, 'category3', 5, { parentCategory: cat2Name }).catch(() => ({code: 1})));
        const matrixRes = await Promise.all(matrixPromises);
        const mMap: Record<string, any> = {};
        res.data.forEach((cat: any, i: number) => {
           if ((matrixRes[i] as any).code === 0) mMap[cat.name] = (matrixRes[i] as any).data;
        });
        setLevel3Matrices(mMap);
      }
    } catch {}
    setLoading(false);
  };

  const handleUserClick = async (userId: number, userName: string, role: 'creator' | 'assignee', category3Name: string) => {
    setTicketDrawerState({ open: true, title: `${userName} 的 ${category3Name} [${role==='creator' ? '提单' : '接单'}] 列表`, category3: category3Name, role, userId });
    setUserTicketsLoading(true);
    try {
      const filter = { category3: category3Name, [role + 'Id']: userId, pageSize: 15 };
      const res = await ticketsAPI.getAll(filter) as any;
      if (res.code === 0) setUserTickets(res.data.items);
    } catch {}
    setUserTicketsLoading(false);
  };

  // ================= Theme-aware Chart Helpers =================
  const chartTextStyle = { color: themeColors.textSecondary };

  const getTrendOption = () => ({
    tooltip: { trigger: 'axis', axisPointer: { type: 'cross' }, backgroundColor: themeColors.bgSecondary, borderColor: themeColors.border, textStyle: { color: themeColors.textPrimary } },
    xAxis: { type: 'category', data: timeSeries.map((t: any) => t.date), axisLabel: chartTextStyle },
    yAxis: { type: 'value', splitLine: { lineStyle: { type: 'dashed', color: themeColors.border } }, axisLabel: chartTextStyle },
    series: [
      {
        name: '工单柱体',
        type: 'bar',
        barWidth: '30%',
        itemStyle: { color: 'rgba(56, 189, 248, 0.25)', borderRadius: [4, 4, 0, 0], borderColor: 'rgba(56, 189, 248, 0.5)', borderWidth: 1 },
        label: { show: true, position: 'top', color: '#0ea5e9' },
        data: timeSeries.map((t: any) => t.count),
      },
      {
        name: '工单趋势',
        type: 'line',
        itemStyle: { color: '#8b5cf6' },
        areaStyle: {
          color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(139, 92, 246, 0.5)' }, { offset: 1, color: 'rgba(139, 92, 246, 0.0)' }] }
        },
        smooth: true,
        data: timeSeries.map((t: any) => t.count),
      }
    ],
    grid: { left: 40, right: 20, bottom: 20, top: 20, containLabel: true }
  });

  const getCat1PieOption = () => ({
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)', backgroundColor: themeColors.bgSecondary, borderColor: themeColors.border, textStyle: { color: themeColors.textPrimary } },
    color: ['#6366f1', '#06b6d4', '#f59e0b', '#10b981'],
    series: [{
      type: 'pie', radius: ['45%', '65%'], center: ['50%', '50%'],
      itemStyle: { borderRadius: 4, borderColor: themeColors.bgCard, borderWidth: 2 },
      label: { show: true, position: 'outside', color: themeColors.textPrimary, formatter: '{b}' },
      labelLine: { length: 10, length2: 15 },
      data: categoryStats.category1.length > 0 ? categoryStats.category1 : [{ name: '暂无数据', value: 0 }]
    }]
  });

  const getCat2BarOption = () => ({
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: themeColors.bgSecondary, borderColor: themeColors.border, textStyle: { color: themeColors.textPrimary } },
    xAxis: { type: 'value', splitLine: { show: false }, axisLabel: { show: false } },
    yAxis: { type: 'category', inverse: true, data: categoryStats.category2.map((c: any) => c.name), axisLabel: { color: themeColors.textPrimary, width: 90, overflow: 'truncate' }, axisLine: { show: false }, axisTick: { show: false } },
    series: [{
      type: 'bar', barWidth: 12,
      itemStyle: { borderRadius: 6, color: { type: 'linear', x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: '#3b82f6' }, { offset: 1, color: '#06b6d4' }] } },
      label: { show: true, position: 'right', color: themeColors.textSecondary },
      data: categoryStats.category2.map((c: any) => c.value),
    }],
    grid: { left: 0, right: 30, bottom: 0, top: 0, containLabel: true }
  });

  const getBarOption = (data: any[], valKey: string, nameKey: string, colorStops: any[]) => ({
    tooltip: { trigger: 'item', backgroundColor: themeColors.bgSecondary, borderColor: themeColors.border, textStyle: { color: themeColors.textPrimary } },
    xAxis: { type: 'value', splitLine: { show: false }, axisLabel: { show: false } },
    yAxis: { type: 'category', inverse: true, data: data.map((c: any) => c[nameKey]), axisLabel: { color: themeColors.textPrimary }, axisLine: { show: false }, axisTick: { show: false } },
    series: [{
      type: 'bar', barWidth: 12,
      itemStyle: { borderRadius: 6, color: { type: 'linear', x: 0, y: 0, x2: 1, y2: 0, colorStops } },
      label: { show: true, position: 'right', color: themeColors.textSecondary },
      data: data.map((c: any) => c[valKey]),
    }],
    grid: { left: 10, right: 30, bottom: 0, top: 0, containLabel: true }
  });

  // ================= MAIN RENDER =================
  return (
    <div style={{ padding: '0 16px', maxWidth: 1600, margin: '0 auto' }}>
      
      {/* Dynamic Header Breadcrumb based on Level */}
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Breadcrumb separator=">" items={[
          { title: <a style={{ fontSize: 22, fontWeight: 600, color: viewLevel === 1 ? 'var(--text-primary)' : 'var(--text-secondary)' }} onClick={() => setViewLevel(1)}>报表总览</a> },
          ...(viewLevel >= 2 ? [{ title: <a style={{ fontSize: 18, fontWeight: 500, color: viewLevel === 2 ? 'var(--text-primary)' : 'var(--text-secondary)' }} onClick={() => setViewLevel(2)}>{drillPath.category1}领域</a> }] : []),
          ...(viewLevel >= 3 ? [{ title: <span style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-primary)' }}>{drillPath.category2}排行</span> }] : []),
        ]} />
        <div style={{ display: 'flex', gap: 8 }}>
          <Button 
            icon={<DownloadOutlined />} 
            loading={exportLoading}
            onClick={async () => {
              setExportLoading(true);
              try {
                const res = await reportAPI.exportXlsx() as any;
                const blob = new Blob([res], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `工单数据导出_${dayjs().format('YYYYMMDD_HHmmss')}.xlsx`;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);
                message.success('导出成功');
              } catch {
                message.error('导出失败，请重试');
              }
              setExportLoading(false);
            }}
          >
            {exportLoading ? '导出中...' : '导出工单 Excel'}
          </Button>
          <Button icon={<SyncOutlined />} onClick={() => loadDashboard()}>刷新数据</Button>
        </div>
      </div>

      <Spin spinning={loading}>

        {/* Level 1: Dashboard */}
        {viewLevel === 1 && (
          <div className="view-level-1">
            {/* Top Summary Widgets */}
            {summary && (
              <Row gutter={[24, 24]} style={{ marginBottom: 24 }}>
                <Col xs={12} sm={6}>
                  <Card style={{ borderRadius: 12 }}>
                    <Statistic title={<Text type="secondary"><FileTextOutlined /> 总工单数</Text>} value={summary.total || 0} valueStyle={{ fontWeight: 'bold' }} />
                  </Card>
                </Col>
                <Col xs={12} sm={6}>
                  <Card style={{ borderRadius: 12 }}>
                    <Statistic title={<Text type="secondary"><ClockCircleOutlined /> 待处理</Text>} value={summary.pending || 0} valueStyle={{ color: '#eab308', fontWeight: 'bold' }} />
                  </Card>
                </Col>
                <Col xs={12} sm={6}>
                  <Card style={{ borderRadius: 12 }}>
                    <Statistic title={<Text type="secondary"><CheckCircleOutlined /> 已关单</Text>} value={summary.closed || 0} valueStyle={{ color: '#10b981', fontWeight: 'bold' }} />
                  </Card>
                </Col>
                <Col xs={12} sm={6}>
                  <Card style={{ borderRadius: 12 }}>
                    <Statistic title={<Text type="secondary"><ClockCircleOutlined /> 平均处理时长</Text>} value={summary.avgHours || 0} precision={1} suffix="小时" valueStyle={{ color: '#0ea5e9', fontWeight: 'bold' }} />
                  </Card>
                </Col>
              </Row>
            )}

            <Row gutter={[24, 24]}>
              <Col span={24}>
                <Card style={{ borderRadius: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
                    <Title level={4} style={{ margin: 0 }}>工单趋势分析</Title>
                    <Segmented value={trendDimension} onChange={(v: any) => setTrendDimension(v)} options={[{label:'30天', value:'day'}, {label:'12个月', value:'month'}, {label:'6个季度', value:'quarter'}, {label:'3年', value:'year'}]} />
                  </div>
                  <ReactECharts key={`trend-${themeKey}`} option={getTrendOption()} style={{ height: 350 }} />
                </Card>
              </Col>
              
              <Col xs={24} lg={8}>
                <Card title={<span><BarChartOutlined /> 软硬大类分布</span>} style={{ borderRadius: 12, height: '100%' }}>
                  <Text type="secondary" style={{ display: 'block', marginBottom: 16, fontSize: 12 }}>提示：点击饼图区域可下钻至 Level 2 的详细技术方向报表。</Text>
                  <ReactECharts key={`pie-${themeKey}`} option={getCat1PieOption()} style={{ height: 300 }} onEvents={{ click: (param: any) => handleCat1Click(param.name) }} />
                </Card>
              </Col>

              <Col xs={24} lg={16}>
                <Card title={<span><BarChartOutlined /> 技术方向分布 (Top10)</span>} style={{ borderRadius: 12, height: '100%' }}>
                  <Text type="secondary" style={{ display: 'block', marginBottom: 16, fontSize: 12 }}>提示：点击柱状图任意选项可直接下钻至 Level 3 的人员绩效矩阵。</Text>
                  <ReactECharts key={`bar-${themeKey}`} option={getCat2BarOption()} style={{ height: 300 }} onEvents={{ click: (param: any) => handleCat2Click(param.name) }} />
                </Card>
              </Col>
            </Row>
          </div>
        )}

        {/* Level 2: Specific Category 1 -> All Category 2s Cards & Cat3 pies/bars */}
        {viewLevel === 2 && (
          <Row gutter={[24, 24]}>
            <Col span={24}>
              <Title level={4}><ArrowsAltOutlined /> [{drillPath.category1}] 下属技术架构分布</Title>
              <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>展示该领域下所有的技术分类及其子品牌的统计。点击技术分类卡片可下钻人员明细。</Text>
            </Col>
            {level2Data.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该分类下无历史数据" /> : null}
            {level2Data.map((cat2, idx) => (
              <Col xs={24} lg={12} xl={8} key={idx}>
                <Card hoverable onClick={() => handleCat2Click(cat2.name)} style={{ borderRadius: 12, height: '100%', cursor: 'pointer', transition: 'all 0.3s' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <Title level={5} style={{ margin: 0, color: '#0ea5e9' }}>{cat2.name}</Title>
                    <div style={{ fontSize: 24, fontWeight: 'bold' }}>{cat2.value} <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>单</span></div>
                  </div>
                  <div style={{ background: 'var(--bg-primary)', borderRadius: 8, padding: 12, height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                     {level2Matrices[cat2.name] && level2Matrices[cat2.name].length > 0 ? (
                       <ReactECharts key={`l2-${idx}-${themeKey}`} option={getBarOption(level2Matrices[cat2.name], 'value', 'name', [{offset:0, color:'#a855f7'}, {offset:1, color:'#d946ef'}])} style={{ height: '100%', width: '100%' }} />
                     ) : (
                       <Text type="secondary">暂无子品牌数据</Text>
                     )}
                  </div>
                  <div style={{ textAlign: 'right', marginTop: 12 }}><Text style={{ color: 'var(--primary)', fontSize: 12 }}>点击深入 Level 3 <ArrowRightOutlined/></Text></div>
                </Card>
              </Col>
            ))}
          </Row>
        )}

        {/* Level 3: Specific Category 2 -> All Category 3s Cards & Personnel Matrices */}
        {viewLevel === 3 && (
          <Row gutter={[24, 24]}>
            <Col span={24}>
              <Title level={4}><TeamOutlined /> [{drillPath.category2}] 品牌维保绩效矩阵</Title>
              <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>展示该技术方向下，各个具体产品品牌的人员接单与提单情况排行。支持点击柱体人员名称查阅工单明细列表。</Text>
            </Col>
            {level3Data.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无对应品牌历史数据" /> : null}
            {level3Data.map((cat3, idx) => (
              <Col xs={24} xl={12} key={idx}>
                <Card style={{ borderRadius: 12, height: '100%' }}>
                   <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                     <Title level={5} style={{ margin: 0, color: '#d97706' }}>{cat3.name}</Title>
                     <Tag color="purple">{cat3.value} 单总计</Tag>
                   </div>
                   <Row gutter={16}>
                     <Col span={12}>
                        <div style={{ padding: '8px 12px', background: 'var(--bg-primary)', borderRadius: '6px 6px 0 0', borderBottom: '2px solid #10b981', color: '#10b981', fontSize: 13, fontWeight: 'bold' }}>高效接单英雄榜 (Top 5)</div>
                        <div style={{ background: 'var(--bg-primary)', height: 260, padding: 8, borderRadius: '0 0 6px 6px' }}>
                           {level3Matrices[cat3.name]?.supporters?.length > 0 ? (
                             <ReactECharts key={`l3s-${idx}-${themeKey}`} onEvents={{ click: (p: any) => handleUserClick(level3Matrices[cat3.name].supporters[p.dataIndex].userId, p.name, 'assignee', cat3.name) }} option={getBarOption(level3Matrices[cat3.name].supporters, 'count', 'realName', [{offset:0, color:'#059669'}, {offset:1, color:'#34d399'}])} style={{ height: '100%', width: '100%' }} />
                           ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="" />}
                        </div>
                     </Col>
                     <Col span={12}>
                        <div style={{ padding: '8px 12px', background: 'var(--bg-primary)', borderRadius: '6px 6px 0 0', borderBottom: '2px solid #ef4444', color: '#ef4444', fontSize: 13, fontWeight: 'bold' }}>高频提单需求方 (Top 5)</div>
                        <div style={{ background: 'var(--bg-primary)', height: 260, padding: 8, borderRadius: '0 0 6px 6px' }}>
                           {level3Matrices[cat3.name]?.requesters?.length > 0 ? (
                             <ReactECharts key={`l3r-${idx}-${themeKey}`} onEvents={{ click: (p: any) => handleUserClick(level3Matrices[cat3.name].requesters[p.dataIndex].userId, p.name, 'creator', cat3.name) }} option={getBarOption(level3Matrices[cat3.name].requesters, 'count', 'realName', [{offset:0, color:'#b91c1c'}, {offset:1, color:'#f87171'}])} style={{ height: '100%', width: '100%' }} />
                           ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="" />}
                        </div>
                     </Col>
                   </Row>
                </Card>
              </Col>
            ))}
          </Row>
        )}

      </Spin>

      {/* Level 4: Drawer showing specific User Tickets */}
      <Drawer
        title={ticketDrawerState.title}
        placement="right"
        width={900}
        onClose={() => setTicketDrawerState({ ...ticketDrawerState, open: false })}
        open={ticketDrawerState.open}
      >
        <Table 
          loading={userTicketsLoading}
          dataSource={userTickets}
          rowKey="id"
          pagination={{ pageSize: 15 }}
          size="small"
          columns={[
            { title: '工单号', dataIndex: 'ticketNo', key: 'ticketNo', width: 150, render: t => <Text style={{ color: 'var(--primary)', fontFamily: 'monospace' }}>{t}</Text> },
            { title: '大类/中类', key: 'cats', width: 140, render: (_, r) => <Text type="secondary">{r.category1} / {r.category2}</Text> },
            { title: '标题', dataIndex: 'title', key: 'title', render: t => <Text>{t}</Text> },
            { title: '时间', dataIndex: 'createdAt', key: 'createdAt', width: 160, render: t => <Text type="secondary">{dayjs(t).format('YYYY-MM-DD HH:mm')}</Text> },
            { title: '状态', dataIndex: 'status', key: 'status', width: 100, render: s => <Tag color={s === 'closed' ? 'success' : 'processing'}>{s==='closed'?'已关单':'处理中'}</Tag> },
            { title: '操作', key: 'action', width: 100, render: (_, r) => (
               <Button type="primary" size="small" onClick={() => window.open(`/tickets/${r.id}`, '_blank')}>追踪详情</Button>
            )}
          ]}
        />
      </Drawer>
    </div>
  );
};
export default ReportsPage;
