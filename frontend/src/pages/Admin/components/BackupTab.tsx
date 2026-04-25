import React, { useState, useEffect, useCallback } from 'react';
import { Card, Button, Checkbox, message, Table, Space, Modal, Upload, Progress, Spin, Typography, Popconfirm, Input, Tag, Divider, Alert } from 'antd';
import {
  CloudDownloadOutlined, DeleteOutlined, UploadOutlined,
  SaveOutlined, ReloadOutlined, ExclamationCircleFilled,
  DatabaseOutlined, PictureOutlined, FileOutlined, AuditOutlined,
  CheckCircleOutlined, ClearOutlined,
} from '@ant-design/icons';
import { backupAPI } from '../../../services/api';

const { Text, Title } = Typography;

function formatBytes(bytes: number) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDate(dateStr: string) {
  try {
    return new Date(dateStr).toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch { return dateStr; }
}

const BackupTab: React.FC = () => {
  const [stats, setStats] = useState<any>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [backups, setBackups] = useState<any[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  // Backup options
  const [includeImages, setIncludeImages] = useState(true);
  const [includeFiles, setIncludeFiles] = useState(true);
  const [includeAuditLogs, setIncludeAuditLogs] = useState(false);

  // Restore state
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreConfirmText, setRestoreConfirmText] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [restoreResult, setRestoreResult] = useState<any>(null);
  const [cleaning, setCleaning] = useState(false);

  // COS orphan state
  const [cosOrphanCount, setCosOrphanCount] = useState<number | null>(null);
  const [cosOrphanFiles, setCosOrphanFiles] = useState<string[]>([]);
  const [cosOrphanLoading, setCosOrphanLoading] = useState(false);
  const [cleaningCosOrphans, setCleaningCosOrphans] = useState(false);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const res: any = await backupAPI.getStats();
      if (res.code === 0) setStats(res.data);
    } catch { /* ignore */ }
    setStatsLoading(false);
  }, []);

  const loadBackups = useCallback(async () => {
    setListLoading(true);
    try {
      const res: any = await backupAPI.list();
      if (res.code === 0) setBackups(res.data || []);
    } catch { /* ignore */ }
    setListLoading(false);
  }, []);

  useEffect(() => {
    loadStats();
    loadBackups();
  }, [loadStats, loadBackups]);

  const handleCreateBackup = async () => {
    setCreating(true);
    const hide = message.loading('正在创建备份，请稍候...（大量文件可能需要数分钟）', 0);
    try {
      const res: any = await backupAPI.create({ includeImages, includeFiles, includeAuditLogs });
      if (res.code === 0) {
        message.success(`备份创建成功！文件大小：${formatBytes(res.data.size)}`);
        loadBackups();
      } else {
        message.error('备份创建失败');
      }
    } catch (err: any) {
      message.error('备份创建失败：' + (err.message || '网络异常'));
    } finally {
      hide();
      setCreating(false);
    }
  };

  const handleDelete = async (filename: string) => {
    try {
      const res: any = await backupAPI.delete(filename);
      if (res.code === 0) {
        message.success('备份已删除');
        loadBackups();
      } else {
        message.error(res.message || '删除失败');
      }
    } catch {
      message.error('删除失败');
    }
  };

  const handleCleanOrphans = async () => {
    setCleaning(true);
    try {
      const res: any = await backupAPI.cleanOrphans();
      if (res.code === 0) {
        message.success(res.message || '清理完成');
        loadStats(); // 实时刷新数据概况
      } else {
        message.error(res.message || '清理失败');
      }
    } catch {
      message.error('清理失败');
    } finally {
      setCleaning(false);
    }
  };

  const handleScanCosOrphans = async () => {
    setCosOrphanLoading(true);
    try {
      const res: any = await backupAPI.getCosOrphans();
      if (res.code === 0) {
        setCosOrphanCount(res.data.orphanCount);
        setCosOrphanFiles(res.data.orphanFiles || []);
        if (res.data.orphanCount === 0) {
          message.success('扫描完成，COS 中无孤儿文件');
        } else {
          message.warning(`发现 ${res.data.orphanCount} 个云端孤儿文件`);
        }
      } else {
        message.error('扫描失败：' + res.message);
      }
    } catch {
      message.error('扫描失败');
    } finally {
      setCosOrphanLoading(false);
    }
  };

  const handleCleanCosOrphans = async () => {
    setCleaningCosOrphans(true);
    try {
      const res: any = await backupAPI.cleanCosOrphans();
      if (res.code === 0) {
        message.success(res.message);
        // 清理后重置状态并重新扫描
        setCosOrphanCount(null);
        setCosOrphanFiles([]);
        loadStats();
      } else {
        message.error(res.message || '清理失败');
      }
    } catch {
      message.error('清理失败');
    } finally {
      setCleaningCosOrphans(false);
    }
  };

  const handleRestore = async () => {
    if (!restoreFile) return;
    setRestoring(true);
    setUploadProgress(0);
    setRestoreResult(null);
    try {
      const res: any = await backupAPI.restore(restoreFile, (percent) => {
        setUploadProgress(percent);
      });
      if (res.code === 0) {
        setRestoreResult(res.details);
        message.success('系统恢复成功！3 秒后将跳转到登录页...');
        setTimeout(() => {
          localStorage.removeItem('accessToken');
          window.location.href = '/login';
        }, 3000);
      } else {
        message.error(res.message || '恢复失败');
      }
    } catch (err: any) {
//       message.error('恢复失败：' + (err.response?.data?.message || err.message || '网络异常')); // Removed by global interceptor refactor
    } finally {
      setRestoring(false);
    }
  };

  const columns = [
    {
      title: '文件名',
      dataIndex: 'filename',
      key: 'filename',
      render: (text: string) => (
        <Text strong style={{ fontSize: 13 }}>📦 {text}</Text>
      ),
    },
    {
      title: '大小',
      dataIndex: 'size',
      key: 'size',
      width: 100,
      render: (size: number) => formatBytes(size),
    },
    {
      title: '备份时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (d: string) => formatDate(d),
    },
    {
      title: '备份内容',
      key: 'content',
      width: 240,
      render: (_: any, record: any) => {
        const opts = record.options || {};
        const st = record.statistics || {};
        return (
          <Space size={4} wrap>
            <Tag color="blue">{st.tables?.length || '?'} 张表</Tag>
            {opts.includeImages && <Tag color="green">图片 ×{st.imageCount || 0}</Tag>}
            {opts.includeFiles && <Tag color="orange">附件 ×{st.fileCount || 0}</Tag>}
            {opts.includeAuditLogs && <Tag>含审计日志</Tag>}
          </Space>
        );
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 150,
      render: (_: any, record: any) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<CloudDownloadOutlined />}
            onClick={() => backupAPI.download(record.filename)}
          >
            下载
          </Button>
          <Popconfirm title="确定删除此备份？" onConfirm={() => handleDelete(record.filename)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24, minHeight: 400 }}>
      {/* Section 1: Create Backup */}
      <Card
        size="small"
        title={<span style={{ fontWeight: 600 }}>🔒 创建备份</span>}
        style={{ marginBottom: 20, borderRadius: 10, border: '1px solid var(--border)' }}
      >
        {/* Current data overview */}
        {statsLoading ? (
          <Spin size="small" />
        ) : stats ? (
          <div style={{ marginBottom: 16, background: 'var(--bg-primary)', borderRadius: 8, padding: '12px 16px' }}>
            <Text type="secondary" style={{ fontSize: 13 }}>当前数据概况：</Text>
            <div style={{ display: 'flex', gap: 24, marginTop: 8, flexWrap: 'wrap' }}>
              <span><DatabaseOutlined style={{ color: '#1677ff' }} /> 数据库：{stats.tableCount} 张表，共 {stats.totalRecords.toLocaleString()} 条记录</span>
              <span><PictureOutlined style={{ color: '#52c41a' }} /> 图片：{stats.imageCount} 个 ({formatBytes(stats.imageSize)})</span>
              <span><FileOutlined style={{ color: '#fa8c16' }} /> 附件：{stats.fileCount} 个 ({formatBytes(stats.fileSize)})</span>
              {stats.orphanCount > 0 && (
                <span style={{ color: '#ff4d4f' }}><ClearOutlined style={{ color: '#ff4d4f' }} /> 孤儿文件：{stats.orphanCount} 个 ({formatBytes(stats.orphanSize)})</span>
              )}
              {stats.orphanCount === 0 && (
                <span style={{ color: '#52c41a' }}><CheckCircleOutlined style={{ color: '#52c41a' }} /> 无孤儿文件</span>
              )}
            </div>
          </div>
        ) : null}

        {/* Backup options */}
        <div style={{ marginBottom: 16 }}>
          <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>备份选项：</Text>
          <Space direction="vertical" size={6}>
            <Checkbox checked disabled>
              <DatabaseOutlined /> 数据库（所有业务表，自动适配新增表）
              <Tag color="red" style={{ marginLeft: 8 }}>必选</Tag>
            </Checkbox>
            <Checkbox checked={includeImages} onChange={e => setIncludeImages(e.target.checked)}>
              <PictureOutlined /> 图片文件
              {stats && <Text type="secondary" style={{ marginLeft: 4 }}>({stats.imageCount} 个, {formatBytes(stats.imageSize)})</Text>}
            </Checkbox>
            <Checkbox checked={includeFiles} onChange={e => setIncludeFiles(e.target.checked)}>
              <FileOutlined /> 文档附件
              {stats && <Text type="secondary" style={{ marginLeft: 4 }}>({stats.fileCount} 个, {formatBytes(stats.fileSize)})</Text>}
            </Checkbox>
            <Checkbox checked={includeAuditLogs} onChange={e => setIncludeAuditLogs(e.target.checked)}>
              <AuditOutlined /> 审计日志
              <Text type="secondary" style={{ marginLeft: 4 }}>(可选，可能较大)</Text>
            </Checkbox>
          </Space>
        </div>

        <Button
          type="primary"
          icon={<SaveOutlined />}
          onClick={handleCreateBackup}
          loading={creating}
          size="large"
        >
          立即备份
        </Button>
      </Card>

      {/* Section 2: Backup History */}
      <Card
        size="small"
        title={
          <span style={{ fontWeight: 600 }}>
            📋 历史备份
            <Button
              type="link"
              size="small"
              icon={<ReloadOutlined />}
              onClick={loadBackups}
              style={{ marginLeft: 8 }}
            >
              刷新
            </Button>
          </span>
        }
        style={{ marginBottom: 20, borderRadius: 10, border: '1px solid var(--border)' }}
      >
        <Table
          dataSource={backups}
          columns={columns}
          rowKey="filename"
          loading={listLoading}
          pagination={false}
          size="small"
          locale={{ emptyText: '暂无备份记录' }}
        />
      </Card>

      {/* Section 3: Clean OSS Space */}
      <Card
        size="small"
        title={<span style={{ fontWeight: 600 }}>🗑️ 清理 OSS 空间</span>}
        style={{ marginBottom: 20, borderRadius: 10, border: '1px solid var(--border)' }}
      >
        <Alert
          type="info"
          showIcon
          message="扫描并删除没有被任何帖子、工单聊天记录、知识库文档引用的孤儿文件，释放磁盘空间。"
          style={{ marginBottom: 16 }}
        />
        {stats && stats.orphanCount > 0 ? (
          <div style={{ marginBottom: 16, background: '#fff2e8', borderRadius: 8, padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>
              <ClearOutlined style={{ color: '#fa541c', marginRight: 8 }} />
              发现 <Text strong style={{ color: '#fa541c' }}>{stats.orphanCount}</Text> 个孤儿文件，
              占用 <Text strong style={{ color: '#fa541c' }}>{formatBytes(stats.orphanSize)}</Text>
            </span>
          </div>
        ) : stats ? (
          <div style={{ marginBottom: 16, background: '#f6ffed', borderRadius: 8, padding: '10px 16px' }}>
            <CheckCircleOutlined style={{ color: '#52c41a', marginRight: 8 }} />
            OSS 空间干净，没有孤儿文件。
          </div>
        ) : null}
        <Popconfirm
          title="确定清理孤儿文件？"
          description="此操作将永久删除未被引用的文件，不可恢复。建议先创建备份。"
          onConfirm={handleCleanOrphans}
          okText="确认清理"
          cancelText="取消"
          okButtonProps={{ danger: true }}
        >
          <Button
            icon={<ClearOutlined />}
            loading={cleaning}
            disabled={!stats || stats.orphanCount === 0}
          >
            {cleaning ? '清理中...' : '清理孤儿文件'}
          </Button>
        </Popconfirm>
      </Card>

      {/* Section 4: COS Cloud Orphan Cleanup */}
      {stats?.provider === 'cos' && (
        <Card
          size="small"
          title={<span style={{ fontWeight: 600 }}>☁️ 清理对象存储 (COS) 孤儿文件</span>}
          style={{ marginBottom: 20, borderRadius: 10, border: '1px solid var(--border)' }}
        >
          <Alert
            type="info"
            showIcon
            message="对比数据库引用与 COS 存储桶中的实际对象，找出未被任何帖子、工单、聊天记录引用的孤儿文件并彻底删除，节省云存储费用。"
            style={{ marginBottom: 16 }}
          />
          {cosOrphanCount !== null && (
            <div style={{ marginBottom: 16, background: cosOrphanCount > 0 ? '#fff2e8' : '#f6ffed', borderRadius: 8, padding: '10px 16px' }}>
              {cosOrphanCount > 0 ? (
                <>
                  <ClearOutlined style={{ color: '#fa541c', marginRight: 8 }} />
                  发现 <Text strong style={{ color: '#fa541c' }}>{cosOrphanCount}</Text> 个云端孤儿文件
                  {cosOrphanFiles.length > 0 && (
                    <details style={{ marginTop: 8 }}>
                      <summary style={{ cursor: 'pointer', color: '#888', fontSize: 12 }}>查看文件列表</summary>
                      <div style={{ maxHeight: 120, overflowY: 'auto', fontSize: 11, marginTop: 4 }}>
                        {cosOrphanFiles.map(f => <div key={f} style={{ color: '#999' }}>{f}</div>)}
                      </div>
                    </details>
                  )}
                </>
              ) : (
                <>
                  <CheckCircleOutlined style={{ color: '#52c41a', marginRight: 8 }} />
                  COS 存储桶干净，没有孤儿文件。
                </>
              )}
            </div>
          )}
          <Space>
            <Button icon={<ReloadOutlined />} loading={cosOrphanLoading} onClick={handleScanCosOrphans}>
              扫描云端孤儿文件
            </Button>
            <Popconfirm
              title="确定删除所有云端孤儿文件？"
              description="此操作将永久从腾讯云 COS 中删除这些文件，不可恢复。"
              onConfirm={handleCleanCosOrphans}
              okText="确认删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              disabled={!cosOrphanCount || cosOrphanCount === 0}
            >
              <Button
                danger
                icon={<ClearOutlined />}
                loading={cleaningCosOrphans}
                disabled={!cosOrphanCount || cosOrphanCount === 0}
              >
                {cleaningCosOrphans ? '清理中...' : '删除云端孤儿文件'}
              </Button>
            </Popconfirm>
          </Space>
        </Card>
      )}

      {/* Section 5: Restore */}
      <Card
        size="small"
        title={<span style={{ fontWeight: 600 }}>⚠️ 恢复系统</span>}
        style={{ borderRadius: 10, border: '1px solid var(--border)' }}
      >
        <Alert
          type="warning"
          showIcon
          message="恢复操作将清空当前所有数据并替换为备份中的数据，此操作不可逆！"
          style={{ marginBottom: 16 }}
        />
        <Button
          icon={<UploadOutlined />}
          danger
          onClick={() => {
            setRestoreModalOpen(true);
            setRestoreFile(null);
            setRestoreConfirmText('');
            setUploadProgress(0);
            setRestoreResult(null);
          }}
        >
          选择备份文件并恢复...
        </Button>
      </Card>

      {/* Restore Modal */}
      <Modal
        title={<span><ExclamationCircleFilled style={{ color: '#faad14', marginRight: 8 }} />恢复系统确认</span>}
        open={restoreModalOpen}
        onCancel={() => !restoring && setRestoreModalOpen(false)}
        closable={!restoring}
        maskClosable={false}
        footer={
          restoreResult ? (
            <Button type="primary" onClick={() => {
              localStorage.removeItem('accessToken');
              window.location.href = '/login';
            }}>立即跳转登录页</Button>
          ) : (
            <Space>
              <Button onClick={() => setRestoreModalOpen(false)} disabled={restoring}>取消</Button>
              <Button
                type="primary"
                danger
                loading={restoring}
                disabled={!restoreFile || restoreConfirmText !== 'RESTORE'}
                onClick={handleRestore}
              >
                确认恢复
              </Button>
            </Space>
          )
        }
        width={520}
      >
        {restoreResult ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <CheckCircleOutlined style={{ fontSize: 48, color: '#52c41a', marginBottom: 16 }} />
            <Title level={4} style={{ color: '#52c41a' }}>恢复成功！</Title>
            <div style={{ textAlign: 'left', background: '#f6ffed', borderRadius: 8, padding: 16, marginTop: 16 }}>
              <p>📊 已导入 {restoreResult.importedTables} 张表，共 {restoreResult.importedRecords?.toLocaleString()} 条记录</p>
              <p>🖼️ 已恢复 {restoreResult.restoredImages} 张图片</p>
              <p>📎 已恢复 {restoreResult.restoredFiles} 个附件</p>
              <p>📅 备份时间：{formatDate(restoreResult.backupDate)}</p>
            </div>
            <Text type="secondary" style={{ marginTop: 12, display: 'block' }}>
              系统将在 3 秒后自动跳转到登录页，请重新登录。
            </Text>
          </div>
        ) : (
          <>
            <Alert
              type="error"
              message="此操作将永久覆盖当前所有数据！"
              description="包括所有用户、工单、聊天记录、BBS 帖子、系统设置等。请确保你了解这个操作的后果。"
              showIcon
              style={{ marginBottom: 16 }}
            />

            <div style={{ marginBottom: 16 }}>
              <Text strong>步骤 1：选择备份 ZIP 文件</Text>
              <div style={{ marginTop: 8 }}>
                <Upload
                  accept=".zip"
                  showUploadList={false}
                  beforeUpload={(file) => {
                    setRestoreFile(file);
                    return false;
                  }}
                  disabled={restoring}
                >
                  <Button icon={<UploadOutlined />}>{restoreFile ? restoreFile.name : '点击选择文件'}</Button>
                </Upload>
                {restoreFile && (
                  <Text type="secondary" style={{ marginLeft: 8 }}>
                    {formatBytes(restoreFile.size)}
                  </Text>
                )}
              </div>
            </div>

            <Divider />

            <div style={{ marginBottom: 16 }}>
              <Text strong>步骤 2：输入 <Text code>RESTORE</Text> 确认操作</Text>
              <Input
                style={{ marginTop: 8 }}
                placeholder="请输入 RESTORE"
                value={restoreConfirmText}
                onChange={e => setRestoreConfirmText(e.target.value)}
                disabled={restoring}
              />
            </div>

            {restoring && (
              <div style={{ marginTop: 16 }}>
                <Text>上传进度：</Text>
                <Progress percent={uploadProgress} size="small" />
                {uploadProgress >= 100 && <Text type="secondary">正在恢复数据，请勿关闭页面...</Text>}
              </div>
            )}
          </>
        )}
      </Modal>
    </div>
  );
};

export default BackupTab;
