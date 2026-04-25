import React, { useState, useEffect } from 'react';
import { Card, Tabs, Form, Input, Select, Button, message, Upload, Row, Col, Divider, Avatar, Spin } from 'antd';
import {
  RobotOutlined, SafetyOutlined, TeamOutlined,
  SafetyCertificateOutlined, UploadOutlined, GlobalOutlined, PictureOutlined,
  FileSearchOutlined, AppstoreOutlined, FireOutlined, CloudServerOutlined, VideoCameraOutlined, DatabaseOutlined
} from '@ant-design/icons';
import { UserManageTab } from './components/UserManageTab';
import { RoleManageTab } from './components/RoleManageTab';
import { AuditLogTab } from './components/AuditLogTab';
import CategoryTab from './components/CategoryTab';
import BbsManageTab from './components/BbsManageTab';
import BackupTab from './components/BackupTab';
import InfraTab from './components/InfraTab';
import { WebRtcManageTab } from './components/WebRtcManageTab';
import { StorageManageTab } from './components/StorageManageTab';
import { settingsAPI } from '../../services/api';

const AdminPage: React.FC = () => {
  const [aiForm] = Form.useForm();
  const [bizForm] = Form.useForm();
  const [securityForm] = Form.useForm();
  const [aiLoading, setAiLoading] = useState(false);
  const [bizLoading, setBizLoading] = useState(false);
  const [secLoading, setSecLoading] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string>('');
  const [logoUploading, setLogoUploading] = useState(false);
  const [initLoading, setInitLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 页面初始化：从后端加载现有配置
  useEffect(() => {
    const load = async () => {
      try {
        const res: any = await settingsAPI.getAll();
        if (res.code === 0) {
          const d = res.data || {};
          aiForm.setFieldsValue({
            visionModel: d['ai.visionModel'] || 'gemini-3.1-pro',
            visionApiKey: d['ai.visionApiKey'] || '',
            systemPrompt: d['ai.systemPrompt'] || '',
            imageModel: d['ai.imageModel'] || 'nano-banana-2',
            imageApiKey: d['ai.imageApiKey'] || '',
          });
          bizForm.setFieldsValue({
            companyName: d['biz.companyName'] || '',
            websiteUrl: d['biz.websiteUrl'] || '',
            companyEmail: d['biz.companyEmail'] || '',
            companyPhone: d['biz.companyPhone'] || '',
            sla: d['biz.sla'] || undefined,
          });
          securityForm.setFieldsValue({
            shareExpiration: d['security.shareExpiration'] || '7d',
          });
          if (d['biz.logoUrl']) setLogoUrl(d['biz.logoUrl']);
        }
      } catch {
        message.error('加载配置失败');
      } finally {
        setInitLoading(false);
      }
    };
    load();
  }, []);

  const handleAiSave = async (values: any) => {
    setAiLoading(true);
    try {
      const res: any = await settingsAPI.saveAi(values);
      if (res.code === 0) message.success('AI 模型配置保存成功');
      else message.error(res.message || '保存失败');
    } catch {
      message.error('保存失败，请检查网络连接');
    } finally {
      setAiLoading(false);
    }
  };

  const handleBizSave = async (values: any) => {
    setBizLoading(true);
    try {
      const res: any = await settingsAPI.saveBiz(values);
      if (res.code === 0) message.success('企业信息保存成功');
      else message.error(res.message || '保存失败');
    } catch {
      message.error('保存失败，请检查网络连接');
    } finally {
      setBizLoading(false);
    }
  };

  const handleSecSave = async (values: any) => {
    setSecLoading(true);
    try {
      const res: any = await settingsAPI.saveSecurity(values);
      if (res.code === 0) message.success('安全设置保存成功');
      else message.error(res.message || '保存失败');
    } catch {
      message.error('保存失败');
    } finally {
      setSecLoading(false);
    }
  };

  const handleLogoUpload = async (info: any) => {
    const file: File = info.file.originFileObj || info.file;
    if (!file) return;
    setLogoUploading(true);
    try {
      const res: any = await settingsAPI.uploadLogo(file);
      if (res.code === 0) {
        // 加 timestamp 防止浏览器缓存旧图
        setLogoUrl(`${res.data.logoUrl}?t=${Date.now()}`);
        message.success('Logo 上传成功');
      } else {
        message.error(res.message || 'Logo 上传失败');
      }
    } catch {
      message.error('Logo 上传失败');
    } finally {
      setLogoUploading(false);
    }
  };

  if (initLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 300 }}>
        <Spin size="large" tip="加载配置中..." />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', paddingBottom: 40 }} className="fade-in">
      <h2 style={{ fontSize: 22, fontWeight: 600, marginBottom: 20 }}>系统设置中心</h2>
      <Card bordered={false} bodyStyle={{ padding: 0 }} style={{ borderRadius: 12, overflow: 'hidden' }}>
        <Tabs
          defaultActiveKey="users"
          tabPosition={isMobile ? 'top' : 'left'}
          tabBarStyle={isMobile ? { paddingTop: 12, paddingLeft: 12, paddingRight: 12, marginBottom: 0 } : { minWidth: 160, paddingTop: 12 }}
          items={[
            {
              key: 'users',
              label: <span><TeamOutlined /> 用户管理</span>,
              children: <UserManageTab />
            },
            {
              key: 'roles',
              label: <span><SafetyCertificateOutlined /> 角色与权限</span>,
              children: <RoleManageTab />
            },
            {
              key: 'ai',
              label: <span><RobotOutlined /> AI 模型配置</span>,
              children: (
                <div style={{ padding: isMobile ? 12 : 24, minHeight: 400 }}>
                  <Form form={aiForm} layout="vertical" onFinish={handleAiSave}>
                    {/* 多模态理解模型 */}
                    <Card
                      size="small"
                      title={<span style={{ fontWeight: 600 }}>🧠 多模态理解模型（文字 + 图片阅读）</span>}
                      style={{ marginBottom: 20, borderRadius: 10, border: '1px solid var(--border)' }}
                    >
                      <Row gutter={16}>
                        <Col xs={24} sm={12}>
                          <Form.Item label="模型" name="visionModel">
                            <Select>
                              <Select.Option value="gemini-3.1-pro">Gemini 3.1 Pro</Select.Option>
                            </Select>
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={12}>
                          <Form.Item label="API Key" name="visionApiKey" extra="用于文字理解、图片阅读、知识总结">
                            <Input.Password placeholder="输入 Gemini API Key" />
                          </Form.Item>
                        </Col>
                      </Row>
                      <Form.Item label="系统预设 Prompt" name="systemPrompt">
                        <Input.TextArea rows={3} placeholder="例如：你是一个专业的技术知识库撰写引擎..." />
                      </Form.Item>
                    </Card>

                    {/* 生图模型 */}
                    <Card
                      size="small"
                      title={<span style={{ fontWeight: 600 }}>🎨 生图模型（AI 生成图片）</span>}
                      style={{ marginBottom: 20, borderRadius: 10, border: '1px solid var(--border)' }}
                    >
                      <Row gutter={16}>
                        <Col xs={24} sm={12}>
                          <Form.Item label="模型" name="imageModel">
                            <Select>
                              <Select.Option value="nano-banana-2">Nano Banana 2</Select.Option>
                            </Select>
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={12}>
                          <Form.Item label="API Key" name="imageApiKey" extra="用于 AI 知识库中的图文生成">
                            <Input.Password placeholder="输入 Nano Banana API Key" />
                          </Form.Item>
                        </Col>
                      </Row>
                    </Card>

                    <div style={{ background: 'var(--bg-primary)', borderRadius: 8, padding: '12px 16px', marginBottom: 20, fontSize: 13, color: 'var(--text-secondary)' }}>
                      💡 两个模型将在「AI 生成知识库」功能中协同工作：Gemini 3.1 Pro 负责阅读聊天记录和图片、生成文字; Nano Banana 2 负责生成配图和流程图。
                    </div>

                    <Form.Item>
                      <Button type="primary" htmlType="submit" loading={aiLoading}>保存模型配置</Button>
                    </Form.Item>
                  </Form>
                </div>
              )
            },
            {
              key: 'basic',
              label: <span><GlobalOutlined /> 企业信息设定</span>,
              children: (
                <div style={{ padding: isMobile ? 12 : 24, minHeight: 400 }}>
                  <Form form={bizForm} layout="vertical" onFinish={handleBizSave}>
                    {/* Logo 区域 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 24 }}>
                      <div style={{ position: 'relative' }}>
                        {logoUploading && (
                          <div style={{
                            position: 'absolute', inset: 0, display: 'flex',
                            alignItems: 'center', justifyContent: 'center',
                            background: 'rgba(0,0,0,0.4)', borderRadius: '50%', zIndex: 1
                          }}>
                            <Spin size="small" />
                          </div>
                        )}
                        <Avatar
                          size={80}
                          src={logoUrl || undefined}
                          icon={!logoUrl && <PictureOutlined />}
                          style={{ background: logoUrl ? 'transparent' : 'linear-gradient(135deg, #4f46e5, #818cf8)', flexShrink: 0 }}
                        />
                      </div>
                      <div>
                        <Upload
                          accept="image/*"
                          showUploadList={false}
                          beforeUpload={() => false}
                          onChange={handleLogoUpload}
                        >
                          <Button icon={<UploadOutlined />} loading={logoUploading}>上传公司 Logo</Button>
                        </Upload>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>建议 200×200 像素，PNG 或 SVG 格式，最大 5MB</div>
                      </div>
                    </div>

                    <Row gutter={16}>
                      <Col xs={24} sm={12}>
                        <Form.Item label="公司名称" name="companyName">
                          <Input placeholder="输入公司全称" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} sm={12}>
                        <Form.Item label="网站地址" name="websiteUrl">
                          <Input placeholder="https://www.example.com" />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Row gutter={16}>
                      <Col xs={24} sm={12}>
                        <Form.Item label="公司邮箱" name="companyEmail">
                          <Input placeholder="contact@example.com" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} sm={12}>
                        <Form.Item label="联系电话" name="companyPhone">
                          <Input placeholder="400-XXX-XXXX" />
                        </Form.Item>
                      </Col>
                    </Row>

                    <Divider />

                    <Form.Item label="服务等级协议 (SLA) 默认时效" name="sla">
                      <Select placeholder="选择 SLA 时效">
                        <Select.Option value="2h">2小时内响应</Select.Option>
                        <Select.Option value="4h">4小时内响应</Select.Option>
                        <Select.Option value="24h">24小时内解决</Select.Option>
                      </Select>
                    </Form.Item>

                    <Form.Item>
                      <Button type="primary" htmlType="submit" loading={bizLoading}>保存企业设定</Button>
                    </Form.Item>
                  </Form>
                </div>
              )
            },
            {
              key: 'security',
              label: <span><SafetyOutlined /> 安全限制</span>,
              children: (
                <div style={{ padding: isMobile ? 12 : 24, minHeight: 400 }}>
                  <p style={{ color: 'var(--text-secondary)', marginBottom: 20 }}>控制外部共享链接的安全属性：</p>
                  <Form form={securityForm} layout="vertical" onFinish={handleSecSave}>
                    <Form.Item label="外部分享链接默认存活天数" name="shareExpiration">
                      <Select>
                        <Select.Option value="1d">1 天</Select.Option>
                        <Select.Option value="7d">7 天</Select.Option>
                        <Select.Option value="30d">30 天</Select.Option>
                        <Select.Option value="never">永久有效</Select.Option>
                      </Select>
                    </Form.Item>
                    <Form.Item>
                      <Button type="primary" htmlType="submit" loading={secLoading}>保存安全设置</Button>
                    </Form.Item>
                  </Form>
                </div>
              )
            },
            {
              key: 'audit',
              label: <span><FileSearchOutlined /> 日志审计</span>,
              children: <AuditLogTab />
            },
            {
              key: 'category',
              label: <span><AppstoreOutlined /> 工单分类</span>,
              children: <CategoryTab />
            },
            {
              key: 'bbs',
              label: <span><FireOutlined /> 论坛管理</span>,
              children: <BbsManageTab />
            },
            {
              key: 'backup',
              label: <span><CloudServerOutlined /> 备份恢复</span>,
              children: <BackupTab />
            },
            {
              key: 'infra',
              label: <span><AppstoreOutlined /> 基础设施</span>,
              children: <InfraTab />
            },
            {
              key: 'webrtc',
              label: <span><VideoCameraOutlined /> WebRTC (共享/语音)</span>,
              children: <WebRtcManageTab />
            },
            {
              key: 'storage',
              label: <span><DatabaseOutlined /> 存储与迁移设定</span>,
              children: <StorageManageTab />
            }
          ]}
        />
      </Card>
    </div>
  );
};

export default AdminPage;
