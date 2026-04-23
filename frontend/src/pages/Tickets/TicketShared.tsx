import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { useSocketStore } from '../../stores/socketStore';
import { Result, Spin, Button, message, Modal, Input } from 'antd';
import TicketDetail from './TicketDetail';
import { authAPI } from '../../services/api';

const parseJwt = (token: string) => {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload);
  } catch (e) {
    return null;
  }
};

const TicketShared: React.FC = () => {
  const { token } = useParams<{ token: string }>(); // This is the invite token from URL
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();
  const { connect, disconnect } = useSocketStore();
  const [loading, setLoading] = useState(true);
  const [ticketId, setTicketId] = useState<string | null>(null);
  
  // 昵称输入弹窗状态
  const [showNameModal, setShowNameModal] = useState(false);
  const [nickname, setNickname] = useState(localStorage.getItem('guest-nickname') || '');
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (!token) {
      navigate('/login');
      return;
    }

    const checkState = async () => {
      const accessToken = localStorage.getItem('accessToken');
      let payload: any = null;
      if (accessToken) {
        payload = parseJwt(accessToken);
      }

      const { isAuthenticated, clearAuth } = useAuthStore.getState();
      
      if (isAuthenticated && payload) {
        if (payload.role !== 'external') {
          // 当前为内部员工登录状态，解析 token 获取 ticketId 直接重定向到内部工单页面
          try {
            const res: any = await authAPI.externalLogin(token as string, 'INTERNAL_PROXY');
            if (res.code === 0 && res.data?.user?.ticketId) {
               navigate(`/tickets/${res.data.user.ticketId}`);
               return;
            }
          } catch (err) {
            message.error('分享链接无效或已过期');
            navigate('/');
            return;
          }
        }
      }

      // 如果没有任何有效登录凭证，或是外部游客，肃清所有无效缓存并打开输入姓名框
      clearAuth();
      disconnect();
      setShowNameModal(true);
      setLoading(false);
    };

    checkState();
  }, [token]);

  const handleJoin = async () => {
    if (!nickname.trim()) {
      message.warning('请输入您的称呼');
      return;
    }
    setJoining(true);
    try {
      const res: any = await authAPI.externalLogin(token as string, nickname.trim());
      if (res.code === 0) {
        const { accessToken, user } = res.data;
        
        // 外部身份数据覆盖
        localStorage.setItem('accessToken', accessToken);
        localStorage.setItem('guest-nickname', nickname.trim());
        setAuth(user, accessToken);
        
        // 我们利用后端签发里的附属信息挂载 ticketId（这样就不需要在前端破译了）
        // 当然我们也可以直接相信后端此时的鉴权逻辑已经全部由 JWT 切面兜底了。
        // 现在连接独立 Socket 并进入
        setTicketId(String(user.ticketId || 1)); // 这只是为了让下面的组件加载，真正的安全拦截在后端。
        connect(accessToken);
        setShowNameModal(false);
      }
    } catch (err: any) {
//       message.error(err.response?.data?.message || '无法接入该会话'); // Removed by global interceptor refactor
      navigate('/login');
    } finally {
      setJoining(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: 'var(--bg-secondary)' }}>
        <Spin size="large" tip="正在加入会话..." />
      </div>
    );
  }

  // 还没有敲定外部身份时不渲染任何底层数据组件
  if (showNameModal) {
    return (
      <div style={{ height: '100vh', background: 'var(--bg-secondary)' }}>
        <Modal
          title="加入工单通讯"
          open={true}
          closable={false}
          maskClosable={false}
          footer={[
            <div key="actions" style={{ display: 'flex', gap: 12 }}>
              <Button onClick={() => navigate(`/login?redirect=/ticket-shared/${token}`)}>
                内部账号登录
              </Button>
              <Button type="primary" loading={joining} onClick={handleJoin} style={{ flex: 1 }}>
                游客接入工单
              </Button>
            </div>
          ]}
        >
          <div style={{ padding: '20px 0' }}>
            <p style={{ marginBottom: 16, color: 'var(--text-secondary)' }}>
              这是一个特定工单的专属外接通道。为了能与技术支持流畅沟通，请留下您的称呼：
            </p>
            <Input 
              placeholder="例如：张大山 / 测试工程师" 
              size="large"
              value={nickname}
              onChange={e => setNickname(e.target.value)}
              onPressEnter={handleJoin}
              autoFocus
            />
          </div>
        </Modal>
      </div>
    );
  }

  if (!ticketId) {
    return (
      <Result
        status="403"
        title="403"
        subTitle="无效或已过期的分享链接。"
        extra={<Button type="primary" onClick={() => navigate('/login')}>前往登录页面</Button>}
        style={{ marginTop: 100 }}
      />
    );
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
      <div style={{ flex: 1, padding: '16px', overflow: 'hidden', maxWidth: 1200, margin: '0 auto', width: '100%' }}>
        <TicketDetail externalTicketId={ticketId} />
      </div>
    </div>
  );
};

export default TicketShared;
