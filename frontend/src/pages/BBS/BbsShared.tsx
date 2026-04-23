import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { Spin, Result, Button } from 'antd';
import BbsPostDetail from './BbsPostDetail';
import { authAPI } from '../../services/api';

const BbsShared: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [bbsId, setBbsId] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      navigate('/login');
      return;
    }

    const initLogin = async () => {
      try {
        const res: any = await authAPI.bbsExternalLogin(token);
        if (res.code === 0) {
          const { accessToken, user } = res.data;
          // BBS 是纯只读体验，游客也无需长留凭证或者覆盖已有员工凭证。
          // 但为了能通过 Axios 豁免下载其图片等附件，我们需要将其置入。
          localStorage.setItem('accessToken', accessToken);
          setAuth(user, accessToken);
          setBbsId(String(user.bbsId));
        } else {
            throw new Error(res.message);
        }
      } catch (err: any) {
//         message.error(err.response?.data?.message || '分享链接无效或已过期'); // Removed by global interceptor refactor
      } finally {
        setLoading(false);
      }
    };

    initLogin();
  }, [token]);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: 'var(--bg-secondary)' }}>
        <Spin size="large" tip="正在安全加载文章..." />
      </div>
    );
  }

  if (!bbsId) {
    return (
      <Result
        status="403"
        title="403"
        subTitle="无效或已过期的帖子分享链接。"
        extra={<Button type="primary" onClick={() => navigate('/login')}>内部人员前往登录</Button>}
        style={{ marginTop: 100 }}
      />
    );
  }

  return (
    <div style={{ height: '100vh', background: 'var(--bg-primary)', paddingTop: 24, paddingBottom: 24, boxSizing: 'border-box' }}>
      <BbsPostDetail externalPostId={bbsId} />
    </div>
  );
};

export default BbsShared;
