import React, { useEffect, useState } from 'react';
import {
  Form, InputNumber, Button, Card, Alert, Descriptions, Badge, Spin, message, Tooltip
} from 'antd';
import {
  ThunderboltOutlined, ReloadOutlined, InfoCircleOutlined, CheckCircleOutlined, WarningOutlined
} from '@ant-design/icons';
import { settingsAPI } from '../../../services/api';

interface WorkerConfig {
  maxRetries: number;
  concurrency: number;
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
          const maxRetries = res.data.maxRetries ?? 3;
          const concurrency = res.data.concurrency ?? 2;
          form.setFieldsValue({ maxRetries, concurrency });
          setWorkerConfig({ maxRetries, concurrency });
        }
      } catch {
        form.setFieldsValue({ maxRetries: 3, concurrency: 2 });
        setWorkerConfig({ maxRetries: 3, concurrency: 2 });
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
        setWorkerConfig({ maxRetries: values.maxRetries, concurrency: values.concurrency });
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
            <Descriptions.Item label="断线重试次数">
              <Badge status="success" text={`${workerConfig.maxRetries} 次`} />
            </Descriptions.Item>
          </Descriptions>
        </Card>
      )}

      <Form form={form} layout="vertical" onFinish={handleSave}>
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

        {/* 断线重试次数 */}
        <Card
          size="small"
          style={{ marginBottom: 20, borderRadius: 10, border: '1px solid var(--border)' }}
          title={
            <span style={{ fontWeight: 600 }}>
              <ReloadOutlined style={{ color: '#10b981', marginRight: 6 }} />
              断线重试次数
            </span>
          }
        >
          <Alert
            type="success"
            showIcon
            icon={<CheckCircleOutlined />}
            message="修改后即时生效，无需重启"
            description="调整后立即推送到 Worker 运行内存，新提交的任务立即使用新值。进行中的任务不受影响。"
            style={{ marginBottom: 16 }}
          />
          <Form.Item
            name="maxRetries"
            label={
              <span>
                OpenAI 断线自动重试次数
                <Tooltip title="当 Codex SDK WebSocket 被 OpenAI 服务端断开时，自动重新连接并继续执行的最大次数（0 = 不重试）">
                  <InfoCircleOutlined style={{ marginLeft: 6, color: 'var(--text-secondary)' }} />
                </Tooltip>
              </span>
            }
            rules={[{ required: true, type: 'number', min: 0, max: 10, message: '请输入 0~10 之间的整数' }]}
          >
            <InputNumber
              min={0}
              max={10}
              style={{ width: 160 }}
              addonAfter="次"
            />
          </Form.Item>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            💡 推荐值：3。OpenAI 服务不稳定时可适当调高至 5。
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
