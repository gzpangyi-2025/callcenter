import React, { useState } from 'react';
import { Select, Input, Button, Form, message, Alert, Row, Col } from 'antd';

const { TextArea } = Input;
const { Option } = Select;

const userSyncTemplate = `[
  {
    "employeeId": "TEST_001",
    "realName": "测试员工A",
    "email": "test_a@company.com",
    "phone": "13800138000",
    "department": "技术部",
    "position": "前端工程师"
  }
]`;

const ticketPushTemplate = `{
  "title": "测试工单：办公网异常",
  "description": "无法连接内部网络",
  "serviceNo": "OMM_TEST_1001",
  "customerName": "财务部",
  "creatorEmployeeId": "TEST_001",
  "assigneeEmployeeId": "TEST_001",
  "type": "network"
}`;

export const ExtSyncTestTab: React.FC = () => {
  const [token, setToken] = useState('');
  const [apiType, setApiType] = useState('users');
  const [payload, setPayload] = useState(userSyncTemplate);
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);

  const handleApiChange = (value: string) => {
    setApiType(value);
    setPayload(value === 'users' ? userSyncTemplate : ticketPushTemplate);
    setResponse('');
  };

  const handleSend = async () => {
    if (!token) {
      message.error('请提供 SERVICE_TOKEN');
      return;
    }
    
    let parsedData;
    try {
      parsedData = JSON.parse(payload);
    } catch (e) {
      message.error('请求体 JSON 格式不正确');
      return;
    }

    setLoading(true);
    setResponse('发送中...');

    try {
      const endpoint = apiType === 'users' ? '/api/ext/users/sync' : '/api/ext/tickets';
      
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(parsedData)
      });

      const data = await res.json();
      setResponse(JSON.stringify(data, null, 2));

      if (res.ok) {
        message.success('请求成功！');
      } else {
        message.error(`请求失败: ${res.status} ${res.statusText}`);
      }
    } catch (err: any) {
      setResponse(`网络错误: ${err.message}`);
      message.error('网络请求失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 24, minHeight: 400 }}>
      <Alert
        message="中台对接沙盒测试"
        description="此模块将绕过当前用户的登录态，使用输入的 SERVICE_TOKEN 直接模拟外部系统向底层核心接口发起的请求。仅供调试与验收使用。"
        type="info"
        showIcon
        style={{ marginBottom: 20 }}
      />
      
      <Form layout="vertical">
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item label="SERVICE_TOKEN 鉴权密钥" required>
              <Input.Password
                placeholder="输入管理员提供的环境专属 Token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item label="选择测试接口" required>
              <Select value={apiType} onChange={handleApiChange}>
                <Option value="users">人员组织架构同步 (POST /api/ext/users/sync)</Option>
                <Option value="tickets">业务工单推送 (POST /api/ext/tickets)</Option>
              </Select>
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item label="请求报文 (Request JSON)">
              <TextArea
                rows={12}
                value={payload}
                onChange={(e) => setPayload(e.target.value)}
                style={{ fontFamily: 'monospace' }}
              />
            </Form.Item>
            <Button type="primary" onClick={handleSend} loading={loading} block>
              发送模拟请求
            </Button>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item label="响应结果 (Response JSON)">
              <TextArea
                rows={13}
                value={response}
                readOnly
                style={{ fontFamily: 'monospace', backgroundColor: '#f5f5f5', color: '#d32f2f' }}
              />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </div>
  );
};
