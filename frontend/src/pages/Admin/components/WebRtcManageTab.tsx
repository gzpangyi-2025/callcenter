import React, { useEffect, useState } from 'react';
import { Card, Form, Radio, Input, InputNumber, Button, message, Typography, Divider, Modal, List, Tag, Spin } from 'antd';
import { VideoCameraOutlined, ApiOutlined, InfoCircleOutlined, ThunderboltOutlined, CheckCircleOutlined, CloseCircleOutlined, AudioOutlined, DesktopOutlined } from '@ant-design/icons';
import { settingsAPI } from '../../../services/api';

const { Title, Paragraph, Text } = Typography;

export const WebRtcManageTab: React.FC = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [initLoading, setInitLoading] = useState(true);
  
  // 测试功能状态
  const [testModalVisible, setTestModalVisible] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResults, setTestResults] = useState<any[]>([]);

  const mode = Form.useWatch('mode', form);

  useEffect(() => {
    const load = async () => {
      try {
        const res: any = await settingsAPI.getAll();
        if (res.code === 0) {
          const d = res.data || {};
          form.setFieldsValue({
            mode: d['webrtc.mode'] || 'auto',
            customStun: d['webrtc.customStun'] || '',
            customTurn: d['webrtc.customTurn'] || '',
            turnUsername: d['webrtc.turnUsername'] || '',
            turnPassword: d['webrtc.turnPassword'] || '',
            screenShareMaxViewers: d['screenShare_maxViewers'] ? parseInt(d['screenShare_maxViewers'], 10) : 6,
            voiceMaxParticipants: d['voice_maxParticipants'] ? parseInt(d['voice_maxParticipants'], 10) : 6,
          });
        }
      } catch {
        message.error('加载 WebRTC 配置失败');
      } finally {
        setInitLoading(false);
      }
    };
    load();
  }, [form]);

  const handleSave = async (values: any) => {
    setLoading(true);
    try {
      const res: any = await settingsAPI.saveWebRtc(values);
      if (res.code === 0) {
        message.success('WebRTC 配置保存成功！');
      } else {
        message.error(res.message || '保存失败');
      }
    } catch {
      message.error('保存失败，请检查网络连接');
    } finally {
      setLoading(false);
    }
  };

  const testStunServer = (url: string): Promise<{ success: boolean; ip?: string; timeMs?: number; error?: string }> => {
    return new Promise((resolve) => {
      const startTime = Date.now();
      try {
        const pc = new RTCPeerConnection({
          iceServers: [{ urls: url }],
          iceCandidatePoolSize: 0,
        });

        pc.createDataChannel('test');
        let resolved = false;

        const finish = (result: any) => {
          if (resolved) return;
          resolved = true;
          pc.close();
          resolve(result);
        };

        pc.onicecandidate = (e) => {
          if (e.candidate && e.candidate.candidate.includes('srflx')) {
            const ipMatch = e.candidate.candidate.match(/([0-9]{1,3}(\.[0-9]{1,3}){3})/);
            finish({ success: true, ip: ipMatch ? ipMatch[0] : 'Unknown', timeMs: Date.now() - startTime });
          }
        };

        pc.createOffer()
          .then(offer => pc.setLocalDescription(offer))
          .catch(err => finish({ success: false, error: err.message }));

        setTimeout(() => finish({ success: false, error: '连接超时 (5秒)' }), 5000);
      } catch (err: any) {
        resolve({ success: false, error: err.message });
      }
    });
  };

  const handleTestStun = async () => {
    const values = form.getFieldsValue();
    let urlsToTest: string[] = [];

    if (values.mode === 'auto') {
      urlsToTest = ['stun:stun.qq.com:3478', 'stun:stun.miwifi.com:3478', 'stun:stun.chat.bilibili.com:3478'];
    } else {
      if (!values.customStun) {
        message.warning('请先填写 STUN 服务器地址再测试');
        return;
      }
      urlsToTest = [`stun:${values.customStun}`];
    }

    setTestModalVisible(true);
    setTesting(true);
    setTestResults(urlsToTest.map(url => ({ url, status: 'testing' })));

    for (let i = 0; i < urlsToTest.length; i++) {
      const url = urlsToTest[i];
      const result = await testStunServer(url);
      
      setTestResults(prev => prev.map((item, idx) => 
        idx === i ? { url, status: result.success ? 'success' : 'error', ...result } : item
      ));
    }
    
    setTesting(false);
  };

  if (initLoading) return null;

  return (
    <div style={{ padding: '12px 24px', minHeight: 400 }}>
      {/* 技术原理解释区 */}
      <Card
        style={{ marginBottom: 24, borderRadius: 12, border: '1px solid var(--border)' }}
        bodyStyle={{ padding: '20px 24px' }}
      >
        <div style={{ display: 'flex', gap: 16 }}>
          <InfoCircleOutlined style={{ fontSize: 24, color: 'var(--primary)', marginTop: 4 }} />
          <div>
            <Title level={4} style={{ marginTop: 0, marginBottom: 8 }}>为什么屏幕共享会黑屏？</Title>
            <Paragraph style={{ color: 'var(--text-secondary)', marginBottom: 8 }}>
              屏幕共享底层使用 <strong>WebRTC (点对点直连)</strong> 技术。为了穿透您电脑的路由器和防火墙建立直连，系统必须借用 <Text code>STUN</Text> 服务器来获取您真实的公网 IP。
            </Paragraph>
            <ul style={{ color: 'var(--text-secondary)', paddingLeft: 20, margin: 0 }}>
              <li><strong>局域网正常</strong>：因为都在同一个内网，不需要公网 IP 即可互相发现。</li>
              <li><strong>互联网黑屏</strong>：如果配置的 STUN 服务器（如默认的 Google STUN）在当前网络环境被屏蔽，导致无法获取公网 IP，直连就会彻底失败。</li>
              <li><strong>TURN 服务器</strong>：如果在极端严格的企业防火墙下（对称型 NAT），连 STUN 都无法穿透，就需要部署 TURN 服务器进行全量数据中转。</li>
            </ul>
          </div>
        </div>
      </Card>

      <Form
        form={form}
        layout="vertical"
        onFinish={handleSave}
        initialValues={{ mode: 'auto' }}
        style={{ maxWidth: 800 }}
      >
        <Form.Item label={<span style={{ fontWeight: 600, fontSize: 16 }}>工作模式选择</span>} name="mode">
          <Radio.Group style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Radio value="auto" style={{ alignItems: 'flex-start' }}>
              <div style={{ display: 'inline-block', verticalAlign: 'top', marginTop: -2 }}>
                <div style={{ fontWeight: 500, fontSize: 15 }}>自动分配（推荐）</div>
                <div style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 4 }}>
                  系统将自动为您下发国内高可用的免费公共 STUN 服务器（如腾讯云、小米等）。无需任何配置，立刻解决绝大部分互联网黑屏问题。
                </div>
              </div>
            </Radio>
            <Radio value="custom" style={{ alignItems: 'flex-start' }}>
              <div style={{ display: 'inline-block', verticalAlign: 'top', marginTop: -2 }}>
                <div style={{ fontWeight: 500, fontSize: 15 }}>自建私有化模式</div>
                <div style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 4 }}>
                  适用于已自行搭建 Coturn 等中继服务器的企业客户，可提供 100% 的接通率保障。
                </div>
              </div>
            </Radio>
          </Radio.Group>
        </Form.Item>

        {mode === 'custom' && (
          <div style={{
            background: 'var(--bg-secondary)',
            padding: 20,
            borderRadius: 8,
            border: '1px solid var(--border)',
            marginBottom: 24,
            animation: 'fadeIn 0.3s ease-in-out'
          }}>
            <Title level={5} style={{ marginTop: 0, marginBottom: 16 }}><ApiOutlined /> 私有穿透节点配置</Title>
            <Form.Item
              label="STUN 服务器地址"
              name="customStun"
              rules={[{ required: true, message: '请输入 STUN 服务器地址' }]}
              extra="例如：stun.example.com:3478"
            >
              <Input placeholder="输入 STUN IP/域名:端口" />
            </Form.Item>
            
            <Divider style={{ margin: '20px 0' }} />
            
            <Form.Item
              label="TURN 服务器地址 (可选)"
              name="customTurn"
              extra="例如：turn.example.com:3478 (如果不填写则仅使用 STUN)"
            >
              <Input placeholder="输入 TURN IP/域名:端口" />
            </Form.Item>
            
            <Form.Item label="TURN 用户名" name="turnUsername">
              <Input placeholder="输入 TURN 用户名" />
            </Form.Item>
            
            <Form.Item label="TURN 密码" name="turnPassword">
              <Input.Password placeholder="输入 TURN 密码" />
            </Form.Item>
          </div>
        )}

        <Form.Item style={{ marginTop: 24 }}>
          <div style={{ display: 'flex', gap: 16 }}>
            <Button type="primary" htmlType="submit" loading={loading} icon={<VideoCameraOutlined />} size="large">
              保存配置
            </Button>
            <Button onClick={handleTestStun} icon={<ThunderboltOutlined />} size="large">
              测试连通性
            </Button>
          </div>
        </Form.Item>

        <Divider />

        {/* 人数限制配置 */}
        <div style={{
          background: 'var(--bg-secondary)',
          padding: 20,
          borderRadius: 8,
          border: '1px solid var(--border)',
          marginBottom: 24,
        }}>
          <Title level={5} style={{ marginTop: 0, marginBottom: 16 }}>
            <DesktopOutlined /> 屏幕共享与语音通话人数限制
          </Title>
          <Paragraph style={{ color: 'var(--text-secondary)', marginBottom: 16, fontSize: 13 }}>
            限制每个工单聊天室内同时参与屏幕共享观看和语音通话的最大人数。
            基于 WebRTC Mesh 架构，建议上限不超过 6 人（N 人需要 N×(N-1)/2 条双向连接）。
          </Paragraph>
          <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
            <Form.Item
              label={<span><DesktopOutlined style={{ marginRight: 6 }} />屏幕共享最大观看人数</span>}
              name="screenShareMaxViewers"
              style={{ marginBottom: 0 }}
            >
              <InputNumber min={1} max={10} style={{ width: 100 }} />
            </Form.Item>
            <Form.Item
              label={<span><AudioOutlined style={{ marginRight: 6 }} />语音通话最大参与人数</span>}
              name="voiceMaxParticipants"
              style={{ marginBottom: 0 }}
            >
              <InputNumber min={2} max={10} style={{ width: 100 }} />
            </Form.Item>
          </div>
        </div>
      </Form>

      <Modal
        title={<div><ThunderboltOutlined style={{ color: '#faad14', marginRight: 8 }} />STUN 穿透连通性测试</div>}
        open={testModalVisible}
        onCancel={() => !testing && setTestModalVisible(false)}
        footer={[
          <Button key="close" onClick={() => setTestModalVisible(false)} disabled={testing}>
            关闭
          </Button>
        ]}
      >
        <List
          dataSource={testResults}
          renderItem={(item) => (
            <List.Item
              actions={
                item.status === 'success' && !testing
                  ? [
                      <Button
                        type="link"
                        size="small"
                        onClick={() => {
                          const host = item.url.replace(/^stun:/, '');
                          form.setFieldsValue({ mode: 'custom', customStun: host });
                          setTestModalVisible(false);
                          message.info('已自动填入私有节点表单，请点击【保存穿透配置】生效');
                        }}
                      >
                        应用此节点
                      </Button>,
                    ]
                  : []
              }
            >
              <List.Item.Meta
                avatar={
                  item.status === 'testing' ? <Spin size="small" /> :
                  item.status === 'success' ? <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 18 }} /> :
                  <CloseCircleOutlined style={{ color: '#ff4d4f', fontSize: 18 }} />
                }
                title={<span style={{ fontFamily: 'monospace' }}>{item.url}</span>}
                description={
                  item.status === 'testing' ? <span style={{ color: 'var(--text-secondary)' }}>正在测试穿透响应...</span> :
                  item.status === 'success' ? (
                    <span>
                      <Tag color="success">穿透成功</Tag> 
                      公网 IP: <Text code>{item.ip}</Text> 
                      <span style={{ color: 'var(--text-muted)', fontSize: 12, marginLeft: 8 }}>延迟: {item.timeMs}ms</span>
                    </span>
                  ) : (
                    <span style={{ color: '#ff4d4f' }}>失败: {item.error}</span>
                  )
                }
              />
            </List.Item>
          )}
        />
        {testing && (
          <div style={{ marginTop: 16, color: 'var(--text-secondary)', textAlign: 'center', fontSize: 12 }}>
            提示：测试过程中会尝试建立真实的 WebRTC 数据通道连接。
          </div>
        )}
      </Modal>
    </div>
  );
};
