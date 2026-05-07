import React, { useEffect, useState } from 'react';
import {
  Form, InputNumber, Button, Card, Alert, Descriptions, Badge, Spin, message, Tooltip, Input
} from 'antd';
import {
  ThunderboltOutlined, ReloadOutlined, InfoCircleOutlined, WarningOutlined
} from '@ant-design/icons';
import { settingsAPI } from '../../../services/api';

interface WorkerConfig {
  concurrency: number;
  maxResumeAttempts?: number;
  cosSecretId?: string;
  cosSecretKey?: string;
  cosBucket?: string;
  cosRegion?: string;
}

const CodexConfigTab: React.FC = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [initLoading, setInitLoading] = useState(true);
  const [workerConfig, setWorkerConfig] = useState<WorkerConfig | null>(null);
  const [lastResult, setLastResult] = useState<any>(null);

  // 加载当前配置（直接从 Worker 读，两个前端显示一致）
  useEffect(() => {
    const load = async () => {
      try {
        const res: any = await settingsAPI.getCodexConfig();
        if (res.code === 0 && res.data) {
          const concurrency = res.data.concurrency ?? 2;
          const maxResumeAttempts = res.data.maxResumeAttempts ?? 3;
          const { cosSecretId, cosSecretKey, cosBucket, cosRegion, storageProvider, s3Endpoint, s3AccessKey, s3SecretKey, s3Bucket, s3Region } = res.data;
          const prov = storageProvider || 'tencent';
          setProvider(prov);
          form.setFieldsValue({ 
            concurrency, maxResumeAttempts, 
            cosSecretId, cosSecretKey, cosBucket, cosRegion,
            storageProvider: prov, s3Endpoint, s3AccessKey, s3SecretKey, s3Bucket, s3Region 
          });
          setWorkerConfig({ 
            concurrency, maxResumeAttempts, 
            cosSecretId, cosSecretKey, cosBucket, cosRegion,
            storageProvider: prov, s3Endpoint, s3AccessKey, s3SecretKey, s3Bucket, s3Region 
          });
        }
      } catch {
        form.setFieldsValue({ concurrency: 2, maxResumeAttempts: 3 });
        setWorkerConfig({ concurrency: 2, maxResumeAttempts: 3 });
      } finally {
        setInitLoading(false);
      }
    };
    load();
  }, []);

  const handleSave = async (values: any) => {
    setLoading(true);
    setLastResult(null);
    try {
      const res: any = await (settingsAPI as any).saveCodexConfig(values);
      if (res.code === 0) {
        setLastResult(res.data);
        setWorkerConfig({ ...workerConfig, ...values });
        if (res.data?.restartRequired) {
          message.warning('并发线程数已保存，请在东京服务器执行 pm2 restart codex-worker 后生效');
        } else {
          message.success('AI 协作配置已保存并即时生效');
        }
      } else {
        message.error(res.message || '保存失败');
      }
    } catch {
      message.error('保存失败，请检查网络连接');
    } finally {
      setLoading(false);
    }
  };

  if (initLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 60 }}>
        <Spin tip="加载配置中..." />
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 720 }}>
      <h3 style={{ fontWeight: 600, marginBottom: 4 }}>🤖 AI 协作引擎配置</h3>
      <p style={{ color: 'var(--text-secondary)', marginBottom: 24, fontSize: 13 }}>
        控制东京节点 Codex Worker 的并发和容错行为
      </p>

      {/* 当前生效状态 */}
      {workerConfig && (
        <Card
          size="small"
          style={{ marginBottom: 24, borderRadius: 10, border: '1px solid var(--border)' }}
          title={<span style={{ fontWeight: 600 }}>📊 Worker 当前运行状态</span>}
        >
          <Descriptions size="small" column={2}>
            <Descriptions.Item label="并发线程数">
              <Badge status="processing" text={`${workerConfig.concurrency} 个`} />
            </Descriptions.Item>
            <Descriptions.Item label="自动续跑次数">
              <Badge status="success" text={`${workerConfig.maxResumeAttempts ?? 3} 次`} />
            </Descriptions.Item>
          </Descriptions>
        </Card>
      )}

      <Form form={form} layout="vertical" onFinish={handleSave}>
        {/* 腾讯云 COS 存储配置 */}
        <Card
          size="small"
          style={{ marginBottom: 20, borderRadius: 10, border: '1px solid var(--border)' }}
          title={
            <span style={{ fontWeight: 600 }}>
              <ThunderboltOutlined style={{ color: '#0ea5e9', marginRight: 6 }} />
              腾讯云 COS 存储配置 (Worker 专属)
            </span>
          }
        >
          <Alert
            type="info"
            showIcon
            message="专属存储空间"
            description="这些配置专用于存放 AI 执行过程中的上下文、附件及生成产物，与主站隔离。修改后也会自动重启 Worker 生效。"
            style={{ marginBottom: 16 }}
          />
          {provider === "tencent" && (<>
          {provider === 'tencent' && (
            <>
              <Form.Item label="SecretId" name="cosSecretId" rules={[{ required: provider === 'tencent', message: '请输入 SecretId' }]}>
                <Input placeholder="输入腾讯云 API 密钥的 SecretId" />
              </Form.Item>
              <Form.Item label="SecretKey" name="cosSecretKey" rules={[{ required: provider === 'tencent', message: '请输入 SecretKey' }]}>
                <Input.Password placeholder="输入腾讯云 API 密钥的 SecretKey（留空保持不变）" />
              </Form.Item>
              <Form.Item label="存储桶名称 (Bucket)" name="cosBucket" rules={[{ required: provider === 'tencent', message: '请输入存储桶名称' }]}>
                <Input placeholder="如: codex-worker-1234567890" />
              </Form.Item>
              <Form.Item label="所属地域 (Region)" name="cosRegion" rules={[{ required: provider === 'tencent', message: '请输入所属地域' }]}>
                <Input placeholder="如: ap-guangzhou" />
              </Form.Item>
            </>
          )}
          {provider === 's3' && (
            <>
              <Form.Item label="Endpoint (访问域名)" name="s3Endpoint" rules={[{ required: provider === 's3', message: '请输入 Endpoint' }]}>
                <Input placeholder="例如: https://s3-cn-beijing.capitalonline.net" />
              </Form.Item>
              <Form.Item label="Access Key (AK)" name="s3AccessKey" rules={[{ required: provider === 's3', message: '请输入 Access Key' }]}>
                <Input placeholder="请输入 Access Key" />
              </Form.Item>
              <Form.Item label="Secret Key (SK)" name="s3SecretKey" rules={[{ required: provider === 's3', message: '请输入 Secret Key' }]}>
                <Input.Password placeholder="请输入 Secret Key（留空保持不变）" />
              </Form.Item>
              <Form.Item label="Bucket (存储桶名称)" name="s3Bucket" rules={[{ required: provider === 's3', message: '请输入存储桶名称' }]}>
                <Input placeholder="my-s3-bucket" />
              </Form.Item>
              <Form.Item label="Region (所属地域)" name="s3Region" rules={[{ required: provider === 's3', message: '请输入地域简称' }]}>
                <Input placeholder="cn-beijing" />
              </Form.Item>
            </>
          )}
        </Card>

        {/* 并发线程数 */}
        <Card
          size="small"
          style={{ marginBottom: 20, borderRadius: 10, border: '1px solid var(--border)' }}
          title={
            <span style={{ fontWeight: 600 }}>
              <ThunderboltOutlined style={{ color: '#f59e0b', marginRight: 6 }} />
              并发线程数
            </span>
          }
        >
          <Alert
            type="warning"
            showIcon
            icon={<WarningOutlined />}
            message="修改此项需重启 Worker"
            description={
              <span>
                并发数由 BullMQ 在进程启动时固定，修改后需在东京服务器执行：
                <code style={{ background: '#1e293b', color: '#e2e8f0', padding: '2px 6px', borderRadius: 4, marginLeft: 6 }}>
                  pm2 restart codex-worker
                </code>
              </span>
            }
            style={{ marginBottom: 16 }}
          />
          <Form.Item
            name="concurrency"
            label={
              <span>
                最大并发任务数
                <Tooltip title="同时执行的 Codex AI 任务数量。值越高吞吐越大，但占用内存也越多（推荐 2~4）">
                  <InfoCircleOutlined style={{ marginLeft: 6, color: 'var(--text-secondary)' }} />
                </Tooltip>
              </span>
            }
            rules={[{ required: true, type: 'number', min: 1, max: 16, message: '请输入 1~16 之间的整数' }]}
          >
            <InputNumber
              min={1}
              max={16}
              style={{ width: 160 }}
              addonAfter="个线程"
            />
          </Form.Item>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            💡 当前服务器（东京 4C8G）推荐并发数：2~3
          </div>
        </Card>


        {/* 自动断点续跑次数 */}
        <Card
          size="small"
          style={{ marginBottom: 20, borderRadius: 10, border: '1px solid var(--border)' }}
          title={
            <span style={{ fontWeight: 600 }}>
              <ReloadOutlined style={{ color: '#8b5cf6', marginRight: 6 }} />
              自动断点续跑次数
            </span>
          }
        >
          <Alert
            type="info"
            showIcon
            message="修改后需重启 Worker 生效"
            description="PPT 任务因断线/崩溃中断后，系统会自动从断点恢复执行。此项控制最大自动恢复尝试次数，达到上限后任务暂停等待人工介入。"
            style={{ marginBottom: 16 }}
          />
          <Form.Item
            name="maxResumeAttempts"
            label={
              <span>
                最大自动续跑次数
                <Tooltip title="PPT 任务因 WebSocket 断线、进程重启等原因中断后，系统自动从 manifest 断点恢复的最大次数。超过此次数后任务暂停，需手动决定是否继续。">
                  <InfoCircleOutlined style={{ marginLeft: 6, color: 'var(--text-secondary)' }} />
                </Tooltip>
              </span>
            }
            rules={[{ required: true, type: 'number', min: 1, max: 20, message: '请输入 1~20 之间的整数' }]}
          >
            <InputNumber
              min={1}
              max={20}
              style={{ width: 160 }}
              addonAfter="次"
            />
          </Form.Item>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            💡 推荐值：5~10。网络不稳定时建议适当调高，避免频繁暂停。
          </div>
        </Card>

        {/* 保存结果反馈 */}
        {lastResult && (
          <Alert
            type={lastResult.restartRequired ? 'warning' : 'success'}
            showIcon
            message={lastResult.note}
            style={{ marginBottom: 20 }}
            closable
            onClose={() => setLastResult(null)}
          />
        )}

        <Form.Item>
          <Button type="primary" htmlType="submit" loading={loading} size="middle">
            保存 AI 协作配置
          </Button>
        </Form.Item>
      </Form>
    </div>
  );
};

export default CodexConfigTab;
