import React, { useState, useEffect } from 'react';
import { Card, Form, Input, Button, message, Alert, Typography, Spin, Switch, Popconfirm, Tag } from 'antd';
import { DatabaseOutlined, SearchOutlined, SafetyCertificateOutlined, ReloadOutlined, ThunderboltOutlined, WarningOutlined } from '@ant-design/icons';
import { infraAPI } from '../../../services/api';

const { Text, Paragraph } = Typography;

const InfraTab: React.FC = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [envPath, setEnvPath] = useState('');

  const [testingEs, setTestingEs] = useState(false);
  const [testingRedis, setTestingRedis] = useState(false);
  const [testingMysql, setTestingMysql] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);

  const [mysqlResult, setMysqlResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [esResult, setEsResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [redisResult, setRedisResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => { loadEnv(); }, []);

  const loadEnv = async () => {
    setLoading(true);
    try {
      const res: any = await infraAPI.getEnv();
      if (res.code === 0) {
        setEnvPath(res.data.path);
        const c = res.data.config || {};
        form.setFieldsValue({
          DB_HOST: c.DB_HOST || 'localhost', DB_PORT: c.DB_PORT || '3306',
          DB_USERNAME: c.DB_USERNAME || 'root', DB_PASSWORD: c.DB_PASSWORD || '',
          DB_DATABASE: c.DB_DATABASE || 'callcenter',
          REDIS_HOST: c.REDIS_HOST || 'localhost', REDIS_PORT: c.REDIS_PORT || '6379',
          ES_NODE_PROD: c.ES_NODE_PROD || '', ES_USERNAME_PROD: c.ES_USERNAME_PROD || '',
          ES_PASSWORD_PROD: c.ES_PASSWORD_PROD || '',
          ES_TLS_REJECT_UNAUTHORIZED_PROD: c.ES_TLS_REJECT_UNAUTHORIZED_PROD === 'false' ? false : true,
        });
      }
    } catch { /* ignore */ } finally { setLoading(false); }
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const payload = { ...values, DB_PASSWORD: values.DB_PASSWORD || '', ES_TLS_REJECT_UNAUTHORIZED_PROD: values.ES_TLS_REJECT_UNAUTHORIZED_PROD ? 'true' : 'false' };
      const res: any = await infraAPI.saveEnv(payload);
      if (res.code === 0) {
        message.success('配置已保存');
        await infraAPI.restart();
        message.success('服务正在热重启，新配置将在几秒后生效');
      }
    } catch (err: any) { if (err?.errorFields) message.warning('请先填写必填项'); }
    finally { setSaving(false); }
  };

  const handleTestMysql = async () => {
    const v = form.getFieldsValue(['DB_HOST','DB_PORT','DB_USERNAME','DB_PASSWORD','DB_DATABASE']);
    setMysqlResult(null); setTestingMysql(true);
    try {
      const res: any = await infraAPI.testMysql({ host: v.DB_HOST||'localhost', port: parseInt(v.DB_PORT)||3306, username: v.DB_USERNAME||'root', password: v.DB_PASSWORD||'', database: v.DB_DATABASE||'callcenter' });
      setMysqlResult({ ok: res?.code===0, msg: res?.message||JSON.stringify(res) });
    } catch (err: any) { setMysqlResult({ ok: false, msg: err?.response?.data?.message||err?.message||'请求失败' }); }
    finally { setTestingMysql(false); }
  };

  const handleTestEs = async () => {
    const v = form.getFieldsValue(['ES_NODE_PROD','ES_USERNAME_PROD','ES_PASSWORD_PROD','ES_TLS_REJECT_UNAUTHORIZED_PROD']);
    if (!v.ES_NODE_PROD) { setEsResult({ ok: false, msg: '请输入 ES 地址' }); return; }
    setEsResult(null); setTestingEs(true);
    try {
      const res: any = await infraAPI.testEs({ node: v.ES_NODE_PROD, username: v.ES_USERNAME_PROD||'', password: v.ES_PASSWORD_PROD||'', rejectUnauthorized: v.ES_TLS_REJECT_UNAUTHORIZED_PROD ? 'true' : 'false' });
      setEsResult({ ok: res?.code===0, msg: res?.message||JSON.stringify(res) });
    } catch (err: any) { setEsResult({ ok: false, msg: err?.response?.data?.message||err?.message||'请求失败' }); }
    finally { setTestingEs(false); }
  };

  const handleTestRedis = async () => {
    const v = form.getFieldsValue(['REDIS_HOST','REDIS_PORT']);
    setRedisResult(null); setTestingRedis(true);
    try {
      const res: any = await infraAPI.testRedis({ host: v.REDIS_HOST||'localhost', port: parseInt(v.REDIS_PORT)||6379 });
      setRedisResult({ ok: res?.code===0, msg: res?.message||JSON.stringify(res) });
    } catch (err: any) { setRedisResult({ ok: false, msg: err?.response?.data?.message||err?.message||'请求失败' }); }
    finally { setTestingRedis(false); }
  };

  const handleRebuildIndex = async () => {
    setRebuilding(true);
    try {
      const res: any = await infraAPI.rebuildIndex();
      setEsResult({ ok: res?.code===0, msg: res?.code===0 ? `索引重建成功，共 ${res.data?.count||0} 条` : '重建失败' });
    } catch { setEsResult({ ok: false, msg: '重建超时或异常' }); }
    finally { setRebuilding(false); }
  };

  const ResultTag = ({ result }: { result: { ok: boolean; msg: string } | null }) => {
    if (!result) return null;
    return <Tag color={result.ok ? 'success' : 'error'} style={{ marginLeft: 8, fontSize: 13, padding: '2px 10px' }}>{result.ok ? '✅' : '❌'} {result.msg}</Tag>;
  };

  // Responsive row style
  const row = (gap = 16): React.CSSProperties => ({ display: 'flex', gap, flexWrap: 'wrap' as const });

  if (loading) return <div style={{ padding: 50, textAlign: 'center' }}><Spin /></div>;

  return (
    <div style={{ padding: 24, maxWidth: 900 }}>
      <Alert
        message="基础设施底层配置"
        description={<>
          <p style={{ margin: '4px 0' }}>配置文件：<Text keyboard>{envPath}</Text>，保存后将自动热重启生效。</p>
          <p style={{ margin: '4px 0', color: '#cf1322' }}><b>⚠️ 错误的 MySQL 配置会导致系统崩溃，需手动登录服务器修复。</b></p>
        </>}
        type="warning" showIcon icon={<WarningOutlined />} style={{ marginBottom: 20 }}
      />

      <Form form={form} layout="vertical">
        {/* ── MySQL ── */}
        <Card title={<><DatabaseOutlined /> MySQL 数据库 (核心)</>} size="small" style={{ marginBottom: 16, borderRadius: 10, border: '1px solid var(--border)' }}>
          {/* 第一行：地址 + 端口 + 数据库名 */}
          <div style={row()}>
            <Form.Item name="DB_HOST" label="地址" rules={[{ required: true }]} style={{ flex: 3, minWidth: 140 }}>
              <Input placeholder="localhost" />
            </Form.Item>
            <Form.Item name="DB_PORT" label="端口" rules={[{ required: true }]} style={{ flex: 1, minWidth: 70, maxWidth: 90 }}>
              <Input placeholder="3306" />
            </Form.Item>
            <Form.Item name="DB_DATABASE" label="数据库名" rules={[{ required: true }]} style={{ flex: 2, minWidth: 120 }}>
              <Input placeholder="callcenter" />
            </Form.Item>
          </div>
          {/* 第二行：用户名 + 密码 */}
          <div style={row()}>
            <Form.Item name="DB_USERNAME" label="用户名" rules={[{ required: true }]} style={{ flex: 1, minWidth: 120 }}>
              <Input placeholder="root" />
            </Form.Item>
            <Form.Item name="DB_PASSWORD" label="密码" style={{ flex: 1, minWidth: 120 }}>
              <Input.Password placeholder="留空 = 无密码" />
            </Form.Item>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <Button size="small" htmlType="button" onClick={handleTestMysql} loading={testingMysql}>测试连接</Button>
            <ResultTag result={mysqlResult} />
          </div>
        </Card>

        {/* ── Elasticsearch ── */}
        <Card title={<><SearchOutlined /> Elasticsearch 搜索引擎 (辅助)</>} size="small" style={{ marginBottom: 16, borderRadius: 10, border: '1px solid var(--border)' }}>
          <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 12 }}>
            清空 ES 地址即可禁用搜索，系统照常运行。部署新 ES 后请点击"全量重建索引"。
          </Paragraph>
          {/* 第一行：节点地址 */}
          <div style={row()}>
            <Form.Item name="ES_NODE_PROD" label="节点地址" style={{ flex: 1, minWidth: 200 }}>
              <Input placeholder="https://192.168.x.x:9200" />
            </Form.Item>
          </div>
          {/* 第二行：用户名 + 密码 + SSL开关 */}
          <div style={row()}>
            <Form.Item name="ES_USERNAME_PROD" label="用户名" style={{ flex: 1, minWidth: 120 }}>
              <Input placeholder="elastic" />
            </Form.Item>
            <Form.Item name="ES_PASSWORD_PROD" label="密码" style={{ flex: 1, minWidth: 140 }}>
              <Input.Password />
            </Form.Item>
            <Form.Item name="ES_TLS_REJECT_UNAUTHORIZED_PROD" valuePropName="checked" label="SSL 证书" style={{ minWidth: 100 }}>
              <Switch checkedChildren="验证" unCheckedChildren="忽略" />
            </Form.Item>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <Button size="small" htmlType="button" onClick={handleTestEs} loading={testingEs}>测试连接</Button>
            <Popconfirm title="确认重建索引？" description="将从 MySQL 重新导入所有数据" onConfirm={handleRebuildIndex}>
              <Button size="small" htmlType="button" icon={<ReloadOutlined />} loading={rebuilding}>全量重建索引</Button>
            </Popconfirm>
            <ResultTag result={esResult} />
          </div>
        </Card>

        {/* ── Redis ── */}
        <Card title={<><ThunderboltOutlined /> Redis 缓存 (预留)</>} size="small" style={{ marginBottom: 16, borderRadius: 10, border: '1px solid var(--border)' }}>
          <div style={row()}>
            <Form.Item name="REDIS_HOST" label="地址" rules={[{ required: true }]} style={{ flex: 3, minWidth: 140 }}>
              <Input placeholder="localhost" />
            </Form.Item>
            <Form.Item name="REDIS_PORT" label="端口" rules={[{ required: true }]} style={{ flex: 1, minWidth: 70, maxWidth: 90 }}>
              <Input placeholder="6379" />
            </Form.Item>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <Button size="small" htmlType="button" onClick={handleTestRedis} loading={testingRedis}>测试连接</Button>
            <ResultTag result={redisResult} />
          </div>
        </Card>

        <Button type="primary" size="large" icon={<SafetyCertificateOutlined />} loading={saving} htmlType="button" onClick={handleSave}>
          保存配置并应用重启
        </Button>
      </Form>
    </div>
  );
};

export default InfraTab;
