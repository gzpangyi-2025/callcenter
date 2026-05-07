import React, { useState, useEffect, useRef } from 'react';
import { Card, Form, Input, Button, message, Radio, Alert, Space, Typography, Row, Col, Statistic, Popconfirm } from 'antd';
import { CloudUploadOutlined, SaveOutlined, SyncOutlined, DatabaseOutlined, CloudServerOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { settingsAPI } from '../../../services/api';

const { Text, Paragraph } = Typography;

export const StorageManageTab: React.FC = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [provider, setProvider] = useState<'local' | 'cos' | 's3'>('local');
  const [migrationStats, setMigrationStats] = useState<{ localFiles: number, migrationState?: any } | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [migrating, setMigrating] = useState(false);

  // useRef 解决闭包里读到的 migrating 是旧值的问题
  const migratingRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetchSettings();
    checkSyncStatus();
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

  const fetchSettings = async () => {
    try {
      const res: any = await settingsAPI.getAll();
      if (res.code === 0) {
        const d = res.data || {};
        const currentProvider = d['storage.provider'] || 'local';
        setProvider(currentProvider);
        form.setFieldsValue({
          provider: currentProvider,
          cosSecretId: d['storage.cos.secretId'] || '',
          cosSecretKey: d['storage.cos.secretKey'] || '',
          cosBucket: d['storage.cos.bucket'] || '',
          cosRegion: d['storage.cos.region'] || '',
          s3Endpoint: d['storage.s3.endpoint'] || '',
          s3AccessKey: d['storage.s3.accessKey'] || '',
          s3SecretKey: d['storage.s3.secretKey'] || '',
          s3Bucket: d['storage.s3.bucket'] || '',
          s3Region: d['storage.s3.region'] || '',
        });
      }
    } catch (err) {
      message.error('加载存储配置失败');
    }
  };

  const handleSave = async (values: any) => {
    setLoading(true);
    setSaveSuccess(false);
    try {
      const res: any = await settingsAPI.saveStorage(values);
      if (res.code === 0) {
        setSaveSuccess(true);
        message.success('✅ 存储配置保存成功');
        setTimeout(() => setSaveSuccess(false), 4000);
      } else {
        message.error(res.message || '保存失败');
      }
    } catch (err) {
      message.error('保存失败，请检查网络');
    } finally {
      setLoading(false);
    }
  };

  const checkSyncStatus = async () => {
    setStatsLoading(true);
    try {
      const res: any = await settingsAPI.getMigrationStats();
      if (res.code === 0) {
        setMigrationStats(res.data);
        const isMigrating = res.data.migrationState?.isMigrating === true;

        if (isMigrating) {
          // 后端仍在迁移，继续轮询
          migratingRef.current = true;
          setMigrating(true);
          pollTimerRef.current = setTimeout(checkSyncStatus, 1500);
        } else {
          // 后端已结束
          if (migratingRef.current) {
            // 刚完成，通知用户
            const msg = res.data.migrationState?.message || '迁移完成';
            message.success(`✅ ${msg}`);
          }
          migratingRef.current = false;
          setMigrating(false);
        }
      }
    } catch (err) {
      // 轮询失败静默处理，停止轮询
      migratingRef.current = false;
      setMigrating(false);
    } finally {
      setStatsLoading(false);
    }
  };

  const startMigration = async () => {
    if (provider !== 'cos') {
      message.warning('请先将存储引擎切换并保存为「腾讯云对象存储(COS)」，再执行迁移');
      return;
    }

    migratingRef.current = true;
    setMigrating(true);
    try {
      const res: any = await settingsAPI.migrateStorage();
      if (res.code === 0) {
        message.info(res.message);
        pollTimerRef.current = setTimeout(checkSyncStatus, 1000);
      } else {
        message.error(res.message || '启动迁移失败');
        migratingRef.current = false;
        setMigrating(false);
      }
    } catch (err) {
      message.error('迁移启动失败');
      migratingRef.current = false;
      setMigrating(false);
    }
  };

  const migState = migrationStats?.migrationState;

  return (
    <div style={{ padding: '24px', minHeight: 400 }}>
      <Alert
        message="存储机制说明"
        description={
          <Paragraph style={{ margin: 0 }}>
            切换存储引擎<Text strong>不会</Text>改变数据库中的记录。当您切换引擎后，系统会动态使用新的存储通道读取或写入文件。
            如果您之前一直在使用本地存储，现在想切到腾讯云，请先填好密钥保存，然后点击底部的【一键迁移本地文件至 COS】，即可将旧图片同步到云端。
          </Paragraph>
        }
        type="info"
        showIcon
        style={{ marginBottom: 24 }}
      />

      <Form
        form={form}
        layout="vertical"
        onFinish={handleSave}
        onValuesChange={(changed) => {
          if (changed.provider) setProvider(changed.provider);
        }}
      >
        <Card
          size="small"
          title={<span style={{ fontWeight: 600 }}><DatabaseOutlined /> 基础存储引擎</span>}
          style={{ marginBottom: 24, borderRadius: 10, border: '1px solid var(--border)' }}
        >
          <Form.Item name="provider" style={{ marginBottom: 0 }}>
            <Radio.Group>
              <Radio.Button value="local" style={{ padding: '0 32px' }}>💻 本地存储 (OSS)</Radio.Button>
              <Radio.Button value="cos" style={{ padding: '0 32px' }}>☁️ 腾讯云对象存储 (COS)</Radio.Button>
              <Radio.Button value="s3" style={{ padding: '0 32px' }}>🌐 首云 (S3 兼容)</Radio.Button>
            </Radio.Group>
          </Form.Item>
        </Card>

        {provider === 'cos' && (
          <Card
            size="small"
            title={<span style={{ fontWeight: 600 }}><CloudServerOutlined /> 腾讯云 COS 配置</span>}
            style={{ marginBottom: 24, borderRadius: 10, border: '1px solid var(--border)' }}
          >
            <Row gutter={16}>
              <Col xs={24} sm={12}>
                <Form.Item
                  label="SecretId"
                  name="cosSecretId"
                  rules={[{ required: provider === 'cos', message: '请输入 SecretId' }]}
                >
                  <Input placeholder="请输入以 AKID 开头的标识" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item
                  label="SecretKey"
                  name="cosSecretKey"
                  rules={[{ required: provider === 'cos', message: '请输入 SecretKey' }]}
                >
                  <Input.Password placeholder="请输入您的 API 密钥" />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col xs={24} sm={12}>
                <Form.Item
                  label="Bucket (存储桶名称)"
                  name="cosBucket"
                  rules={[{ required: provider === 'cos', message: '请输入存储桶名称' }]}
                >
                  <Input placeholder="callcenter-1234567890" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item
                  label="Region (所属地域)"
                  name="cosRegion"
                  rules={[{ required: provider === 'cos', message: '请输入地域简称' }]}
                >
                  <Input placeholder="ap-guangzhou" />
                </Form.Item>
              </Col>
            </Row>
          </Card>
        )}

        {provider === 's3' && (
          <Card
            size="small"
            title={<span style={{ fontWeight: 600 }}><CloudServerOutlined /> 首云 (S3 兼容) 配置</span>}
            style={{ marginBottom: 24, borderRadius: 10, border: '1px solid var(--border)' }}
          >
            <Row gutter={16}>
              <Col xs={24} sm={24}>
                <Form.Item
                  label="Endpoint (访问域名)"
                  name="s3Endpoint"
                  rules={[{ required: provider === 's3', message: '请输入 Endpoint' }]}
                >
                  <Input placeholder="例如: https://s3-cn-beijing.capitalonline.net" />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col xs={24} sm={12}>
                <Form.Item
                  label="Access Key (AK)"
                  name="s3AccessKey"
                  rules={[{ required: provider === 's3', message: '请输入 Access Key' }]}
                >
                  <Input placeholder="请输入 Access Key" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item
                  label="Secret Key (SK)"
                  name="s3SecretKey"
                  rules={[{ required: provider === 's3', message: '请输入 Secret Key' }]}
                >
                  <Input.Password placeholder="请输入 Secret Key" />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col xs={24} sm={12}>
                <Form.Item
                  label="Bucket (存储桶名称)"
                  name="s3Bucket"
                  rules={[{ required: provider === 's3', message: '请输入存储桶名称' }]}
                >
                  <Input placeholder="my-s3-bucket" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item
                  label="Region (所属地域)"
                  name="s3Region"
                  rules={[{ required: provider === 's3', message: '请输入地域简称' }]}
                >
                  <Input placeholder="cn-beijing" />
                </Form.Item>
              </Col>
            </Row>
          </Card>
        )}

        <Form.Item>
          <Space align="center">
            <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={loading} size="large">
              保存存储配置
            </Button>
            {saveSuccess && (
              <Text type="success" style={{ fontSize: 14 }}>
                <CheckCircleOutlined style={{ marginRight: 4 }} />
                配置已保存
              </Text>
            )}
          </Space>
        </Form.Item>
      </Form>

      <Card
        size="small"
        title={<span style={{ fontWeight: 600 }}><SyncOutlined /> 数据迁移与同步状态</span>}
        style={{ marginTop: 32, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-secondary)' }}
      >
        <Row align="middle" gutter={24}>
          <Col>
            <Statistic
              title="本地存在的文件数量"
              value={migrationStats ? migrationStats.localFiles : '-'}
              prefix={<DatabaseOutlined />}
              suffix="个"
            />
          </Col>
          <Col>
            <Space size="middle" direction="vertical">
              <Button onClick={checkSyncStatus} loading={statsLoading} disabled={migrating}>
                刷新状态
              </Button>
              <Popconfirm
                title="确定要将本地的所有文件全部推送至腾讯云吗？"
                description="请确保您已经在上方保存了正确的腾讯云配置。这可能需要一些时间。"
                onConfirm={startMigration}
                okText="开始迁移"
                cancelText="取消"
                disabled={migrating}
              >
                <Button type="primary" danger icon={<CloudUploadOutlined />} loading={migrating}>
                  {migrating ? '迁移进行中...' : '一键迁移本地文件至 COS'}
                </Button>
              </Popconfirm>
            </Space>
          </Col>
        </Row>

        {migState && (migState.isMigrating || migState.total > 0) && (
          <div style={{ marginTop: 24, padding: 16, background: 'var(--bg-primary)', borderRadius: 8 }}>
            <div style={{ marginBottom: 8, fontWeight: 600, color: migState.isMigrating ? 'inherit' : '#52c41a' }}>
              {migState.isMigrating ? '🔄' : '✅'} 任务进度: {migState.message}
            </div>
            <div style={{ display: 'flex', gap: 16 }}>
              <div>总文件: <Text strong>{migState.total}</Text></div>
              <div>已完成: <Text type="success" strong>{migState.current}</Text></div>
              <div>失败: <Text type="danger" strong>{migState.failed}</Text></div>
            </div>
          </div>
        )}

        <div style={{ marginTop: 16, color: 'var(--text-secondary)', fontSize: 13 }}>
          说明：由于系统设计的无缝特性，您在腾讯云控制台中自行进行的存储桶间跨区迁移不需要点击此按钮。此功能专门用于帮助初次从"本地硬盘"上云的用户推送遗留数据。
        </div>
      </Card>
    </div>
  );
};
