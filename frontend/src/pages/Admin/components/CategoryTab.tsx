import React, { useState, useEffect } from 'react';
import { Card, Button, Upload, Table, Tag, message, Space, Empty, Alert, Tree } from 'antd';
import { UploadOutlined, ReloadOutlined, FileExcelOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { categoryAPI } from '../../../services/api';

const CategoryTab: React.FC = () => {
  const [categories, setCategories] = useState<any[]>([]);
  const [treeData, setTreeData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [viewMode, setViewMode] = useState<'tree' | 'table'>('tree');

  const loadData = async () => {
    setLoading(true);
    try {
      const [allRes, treeRes] = await Promise.all([
        categoryAPI.getAll(),
        categoryAPI.getTree(),
      ]);
      if ((allRes as any).code === 0) setCategories((allRes as any).data || []);
      if ((treeRes as any).code === 0) setTreeData((treeRes as any).data || []);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { loadData(); }, []);

  const handleUpload = async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    setUploading(true);
    try {
      const res: any = await categoryAPI.importExcel(formData);
      if (res.code === 0) {
        message.success(res.message || `成功导入 ${res.data?.imported} 条分类`);
        loadData();
      } else {
        message.error(res.message || '导入失败');
      }
    } catch (err: any) {
//       message.error(err.response?.data?.message || '导入失败'); // Removed by global interceptor refactor
    } finally { setUploading(false); }
    return false; // prevent default upload
  };

  // Convert tree data for Ant Design Tree component
  const convertToAntTree = (nodes: any[]): any[] => {
    return nodes.map((node, i) => ({
      title: (
        <span style={{ fontSize: 13 }}>
          {!node.children || node.children.length === 0
            ? <Tag color="blue" style={{ margin: 0 }}>{node.label}</Tag>
            : <span style={{ fontWeight: 500 }}>{node.label}</span>
          }
          {node.children && <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 6 }}>({node.children.length})</span>}
        </span>
      ),
      key: `${i}-${node.value}`,
      children: node.children ? convertToAntTree(node.children.map((c: any, j: number) => ({ ...c, _parentIdx: i, _idx: j }))) : undefined,
    }));
  };

  const columns = [
    { title: '支持类型', dataIndex: 'level1', width: 150, render: (v: string) => <Tag color="purple">{v}</Tag> },
    { title: '技术方向', dataIndex: 'level2', width: 200, render: (v: string) => <Tag color="blue">{v}</Tag> },
    { title: '品牌', dataIndex: 'level3', render: (v: string) => <Tag color="cyan">{v}</Tag> },
  ];

  // Stats
  const l1Count = new Set(categories.map(c => c.level1)).size;
  const l2Count = new Set(categories.map(c => `${c.level1}/${c.level2}`)).size;

  return (
    <div>
      <Alert
        type="info"
        showIcon
        icon={<FileExcelOutlined />}
        message="工单分类管理"
        description="上传 Excel 文件定义三级工单分类（支持类型 → 技术方向 → 品牌）。重新导入将覆盖现有分类定义。Excel 格式：第一行为表头，后续行依次为三列分类数据。"
        style={{ marginBottom: 16, borderRadius: 8 }}
      />

      <Card size="small" style={{ borderRadius: 12, border: '1px solid var(--border)', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <Space>
            <Upload
              accept=".xlsx,.xls"
              showUploadList={false}
              beforeUpload={handleUpload}
            >
              <Button type="primary" icon={<UploadOutlined />} loading={uploading}>
                {categories.length > 0 ? '重新导入 Excel' : '导入 Excel'}
              </Button>
            </Upload>
            <Button icon={<ReloadOutlined />} onClick={loadData} loading={loading}>刷新</Button>
          </Space>

          {categories.length > 0 && (
            <Space size={16}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                <CheckCircleOutlined style={{ color: '#059669', marginRight: 4 }} />
                共 <b>{categories.length}</b> 条 | {l1Count} 个支持类型 | {l2Count} 个技术方向
              </span>
              <Button.Group size="small">
                <Button type={viewMode === 'tree' ? 'primary' : 'default'} onClick={() => setViewMode('tree')}>树视图</Button>
                <Button type={viewMode === 'table' ? 'primary' : 'default'} onClick={() => setViewMode('table')}>表格视图</Button>
              </Button.Group>
            </Space>
          )}
        </div>
      </Card>

      {categories.length === 0 ? (
        <Card style={{ borderRadius: 12, border: '1px solid var(--border)' }}>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="尚未导入工单分类数据"
          >
            <Upload accept=".xlsx,.xls" showUploadList={false} beforeUpload={handleUpload}>
              <Button type="primary" icon={<UploadOutlined />} loading={uploading}>立即导入</Button>
            </Upload>
          </Empty>
        </Card>
      ) : viewMode === 'tree' ? (
        <Card size="small" style={{ borderRadius: 12, border: '1px solid var(--border)' }} bodyStyle={{ padding: '8px 16px' }}>
          <Tree
            treeData={convertToAntTree(treeData)}
            defaultExpandedKeys={treeData.map((_, i) => `${i}-${treeData[i]?.value}`)}
            selectable={false}
            showLine
            style={{ background: 'transparent' }}
          />
        </Card>
      ) : (
        <Card size="small" style={{ borderRadius: 12, border: '1px solid var(--border)' }} bodyStyle={{ padding: 0 }}>
          <Table
            dataSource={categories}
            columns={columns}
            rowKey="id"
            size="small"
            pagination={{ pageSize: 20, showTotal: t => `共 ${t} 条` }}
            scroll={{ x: 500 }}
          />
        </Card>
      )}
    </div>
  );
};

export default CategoryTab;
