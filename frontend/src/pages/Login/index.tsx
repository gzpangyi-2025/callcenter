import React, { useState } from 'react';
import { Form, Input, Button, message, Tabs } from 'antd';
import { UserOutlined, LockOutlined, MailOutlined } from '@ant-design/icons';
import { authAPI } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import { useNavigate, useLocation } from 'react-router-dom';


const LoginPage: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const setAuth = useAuthStore((s) => s.setAuth);
  const navigate = useNavigate();
  const location = useLocation();

  const handleSuccessRedirect = () => {
    const params = new URLSearchParams(location.search);
    const redirect = params.get('redirect');
    navigate(redirect || '/');
  };

  const onLogin = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      const res: any = await authAPI.login(values);
      if (res.code === 0) {
        setAuth(res.data.user, res.data.accessToken);
        message.success('登录成功');
        handleSuccessRedirect();
      }
    } catch (err: any) {
//       message.error(err.response?.data?.message || '登录失败'); // Removed by global interceptor refactor
    } finally {
      setLoading(false);
    }
  };

  const onRegister = async (values: any) => {
    setLoading(true);
    try {
      const { confirm, ...registerData } = values;
      const res: any = await authAPI.register(registerData);
      if (res.code === 0) {
        setAuth(res.data.user, res.data.accessToken);
        message.success('注册成功');
        handleSuccessRedirect();
      }
    } catch (err: any) {
//       message.error(err.response?.data?.message || '注册失败'); // Removed by global interceptor refactor
    } finally {
      setLoading(false);
    }
  };

  const loginItems = [
    {
      key: 'login',
      label: '登录',
      children: (
        <Form onFinish={onLogin} size="large" autoComplete="off">
          <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input prefix={<UserOutlined />} placeholder="用户名" />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="密码" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" block loading={loading}
              style={{ height: 44, borderRadius: 10, fontWeight: 600, background: 'linear-gradient(135deg, var(--primary), var(--primary-light, #818cf8))', border: 'none' }}>
              登 录
            </Button>
          </Form.Item>
        </Form>
      ),
    },
    {
      key: 'register',
      label: '注册',
      children: (
        <Form onFinish={onRegister} size="large" autoComplete="off">
          <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }, { min: 3, message: '至少3个字符' }]}>
            <Input prefix={<UserOutlined />} placeholder="用户名（登录账号）" />
          </Form.Item>
          <Form.Item name="realName" rules={[{ required: true, message: '请输入中文姓名' }]}>
            <Input placeholder="中文姓名（真实姓名）" />
          </Form.Item>
          <Form.Item name="email">
            <Input prefix={<MailOutlined />} placeholder="邮箱 (选填)" />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }, { min: 6, message: '至少6个字符' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="密码" />
          </Form.Item>
          <Form.Item name="confirm" dependencies={['password']}
            rules={[{ required: true, message: '请确认密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('password') === value) return Promise.resolve();
                  return Promise.reject(new Error('两次密码不一致'));
                },
              }),
            ]}>
            <Input.Password prefix={<LockOutlined />} placeholder="确认密码" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" block loading={loading}
              style={{ height: 44, borderRadius: 10, fontWeight: 600, background: 'linear-gradient(135deg, var(--primary), var(--primary-light, #818cf8))', border: 'none' }}>
              注 册
            </Button>
          </Form.Item>
        </Form>
      ),
    },
  ];

  return (
    <div className="login-container">
      <div className="login-card fade-in">
        <h1>📞 CallCenter</h1>
        <p className="subtitle">二线技术支持即时通讯系统</p>
        <Tabs items={loginItems} centered
          style={{ color: 'var(--text-primary)' }} />
      </div>
    </div>
  );
};

export default LoginPage;
