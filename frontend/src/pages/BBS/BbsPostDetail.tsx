import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, Avatar, Typography, Button, Space, Divider, Anchor, Input, List, message, Tag, Drawer, Modal, Image } from 'antd';
import { ArrowLeftOutlined, EyeOutlined, SendOutlined, EditOutlined, DeleteOutlined, PushpinOutlined, InboxOutlined, UnorderedListOutlined, MessageOutlined, ShareAltOutlined, CheckOutlined, VerticalAlignTopOutlined, PictureOutlined, CloseCircleFilled, LoadingOutlined } from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import { MarkdownViewer } from '../../components/MarkdownViewer';
import api, { filesAPI } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import { useSocketStore } from '../../stores/socketStore';
import './bbs.css';

const { Title, Text } = Typography;

// 权限检查 helper
function useHasPermission(code: string): boolean {
  const { user } = useAuthStore();
  if (!user || !user.role) return false;
  const roleObj: any = user.role;
  if (roleObj.name === 'admin' || user.username === 'admin') return true;
  const perms = roleObj.permissions || [];
  return perms.some((p: any) => {
    const pCode = p.code || `${p.resource}:${p.action}`;
    return pCode === code;
  });
}

export default function BbsPostDetail({ externalPostId }: { externalPostId?: string }) {
  const { id: routeId } = useParams();
  const id = externalPostId || routeId;
  const navigate = useNavigate();
  const { user } = useAuthStore();
  
  const [post, setPost] = useState<any>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [newComment, setNewComment] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [outline, setOutline] = useState<any[]>([]);
  const [isMobile, setIsMobile] = useState(false);
  const [outlineDrawerOpen, setOutlineDrawerOpen] = useState(false);
  const [copiedExternalLink, setCopiedExternalLink] = useState(false);
  const [showBackTop, setShowBackTop] = useState(false);
  const [commentImages, setCommentImages] = useState<{ url: string; uploading?: boolean }[]>([]);
  const [uploadingCount, setUploadingCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const { setCurrentBbs } = useSocketStore();

  const canEdit = useHasPermission('bbs:edit');
  const canDelete = useHasPermission('bbs:delete');
  const canComment = useHasPermission('bbs:comment');

  const isOwner = user?.id === post?.authorId;

  // 移动端检测
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // 监听滚动，控制回到顶部按钮显隐
  useEffect(() => {
    const container = document.getElementById('bbs-container');
    if (!container) return;
    const onScroll = () => {
      setShowBackTop(container.scrollTop > 300);
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, [loading]);

  const handleBackToTop = useCallback(() => {
    const container = document.getElementById('bbs-container');
    if (container) {
      container.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, []);

  const fetchPost = async () => {
    try {
      const res: any = await api.get(`/bbs/posts/${id}`);
      setPost(res);
      if (!externalPostId) {
         fetchComments();
      }
    } catch {
      message.error('无法加载帖子');
    } finally {
      setLoading(false);
    }
  };

  const fetchComments = async () => {
    try {
      const res: any = await api.get(`/bbs/posts/${id}/comments`);
      setComments(res || []);
    } catch {
      console.error('无法加载评论');
    }
  };

  useEffect(() => {
    fetchPost();
    if (!externalPostId && id) {
      setCurrentBbs(Number(id));
      api.get(`/bbs/posts/${id}/subscribe`).then((res: any) => {
        setIsSubscribed(res.isSubscribed);
      }).catch(() => {});
    }
    return () => {
      if (!externalPostId) {
        setCurrentBbs(null);
      }
    };
  }, [id, externalPostId, setCurrentBbs]);

  useEffect(() => {
    if (!loading && post?.content) {
      setTimeout(() => {
        const headings = Array.from(document.querySelectorAll('.markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4'));
        const items: any[] = [];
        const stack: { level: number; item: any }[] = [];

        headings.forEach((heading: any, index) => {
          const hid = `heading-${index}`;
          heading.id = hid;
          const level = parseInt(heading.tagName.replace('H', ''), 10);
          
          const anchorItem = {
            key: hid,
            href: `#${hid}`,
            title: heading.innerText,
            children: [],
          };

          // 回溯栈，找到父节点（即最近的层级小的值）
          while (stack.length > 0 && stack[stack.length - 1].level >= level) {
            stack.pop();
          }

          if (stack.length === 0) {
            items.push(anchorItem);
          } else {
            stack[stack.length - 1].item.children.push(anchorItem);
          }

          stack.push({ level, item: anchorItem });
        });

        // 移除空的 children 数组，保持 Ant Design Anchor 格式最优化
        const cleanEmptyChildren = (arr: any[]) => {
          arr.forEach(node => {
            if (node.children.length === 0) delete node.children;
            else cleanEmptyChildren(node.children);
          });
        };
        cleanEmptyChildren(items);

        setOutline(items);
      }, 300);
    }
  }, [loading, post?.content]);

  // 上传图片并追加到评论图片列表
  const uploadCommentImage = async (file: File) => {
    setUploadingCount(prev => prev + 1);
    try {
      const res: any = await filesAPI.upload(file, 'bbs');
      if (res.code === 0 && res.data?.url) {
        setCommentImages(prev => [...prev, { url: res.data.url }]);
      } else {
        message.error('图片上传失败');
      }
    } catch {
      message.error('图片上传失败');
    } finally {
      setUploadingCount(prev => prev - 1);
    }
  };

  // 评论输入框粘贴事件
  const handleCommentPaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      for (const file of imageFiles) {
        await uploadCommentImage(file);
      }
    }
  };

  // 📎 按钮选择图片
  const handleCommentImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (let i = 0; i < files.length; i++) {
      uploadCommentImage(files[i]);
    }
    // 重置 input 以便重复选择同一文件
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // 移除预览中的图片
  const removeCommentImage = (index: number) => {
    setCommentImages(prev => prev.filter((_, i) => i !== index));
  };

  const handlePostComment = async () => {
    if (!newComment.trim() && commentImages.length === 0) return message.warning('请输入回复内容或添加图片');
    setSubmitting(true);
    try {
      // 拼接图片 Markdown 到评论内容末尾
      let finalContent = newComment.trim();
      if (commentImages.length > 0) {
        const imgMd = commentImages.map(img => `![图片](${img.url})`).join('\n');
        finalContent = finalContent ? `${finalContent}\n\n${imgMd}` : imgMd;
      }
      await api.post(`/bbs/posts/${id}/comments`, { content: finalContent });
      message.success('留言成功');
      setNewComment('');
      setCommentImages([]);
      fetchComments();
    } catch {
      message.error('留言失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    try {
      await api.delete(`/bbs/posts/${id}`);
      message.success('帖子已删除');
      navigate('/bbs');
    } catch {
      message.error('删除失败');
    }
  };

  const handlePin = async () => {
    try {
      const res: any = await api.put(`/bbs/posts/${id}/pin`);
      message.success(res.isPinned ? '已置顶' : '已取消置顶');
      fetchPost();
    } catch {
      message.error('操作失败');
    }
  };

  const handleArchive = async () => {
    try {
      await api.put(`/bbs/posts/${id}/archive`);
      message.success('已归档');
      navigate('/bbs');
    } catch {
      message.error('归档失败');
    }
  };

  const toggleSubscription = async () => {
    try {
      if (isSubscribed) {
        await api.delete(`/bbs/posts/${id}/subscribe`);
        setIsSubscribed(false);
        message.success('已取消关注');
      } else {
        await api.post(`/bbs/posts/${id}/subscribe`);
        setIsSubscribed(true);
        message.success('已成功关注本帖');
      }
    } catch {
      message.error('操作失败');
    }
  };

  const handleShare = async () => {
    try {
      const res: any = await api.post(`/bbs/posts/${id}/share`);
      const link = `${window.location.origin}/external/bbs/${res.token || res?.data?.token}`;
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(link);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = link;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        textArea.style.top = "-999999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        textArea.remove();
      }
      message.success('外部免密免登分享链接已复制到剪贴板！');
      setCopiedExternalLink(true);
      setTimeout(() => setCopiedExternalLink(false), 3000);
    } catch {
      message.error('获取分享链接失败');
    }
  };

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  if (loading || !post) {
    return <div style={{ padding: 100, textAlign: 'center' }}>加载中...</div>;
  }

  const showActions = isOwner || canEdit || canDelete;

  // 侧边栏内容（大纲 + 作者）复用
  const sidebarContent = (
    <>
      <div style={{ marginBottom: 24 }}>
        <Title level={5} style={{ marginBottom: 16 }}>📑 目录大纲</Title>
        <div style={{ maxHeight: 'calc(100vh - 300px)', overflowY: 'auto', paddingRight: 8 }}>
          {outline.length > 0 ? (
            <Anchor
              affix={false}
              showInkInFixed
              items={outline}
              targetOffset={80}
              getContainer={() => document.getElementById('bbs-container') as HTMLElement}
              onClick={() => {
                if (isMobile) {
                  // 关闭抽屉让滚动生效
                  setTimeout(() => setOutlineDrawerOpen(false), 200);
                }
              }}
            />
          ) : (
            <Text type="secondary" style={{ fontSize: 12 }}>（暂无大纲节点）</Text>
          )}
        </div>
      </div>
    </>
  );

  return (
    <div id="bbs-container" className={`bbs-detail-page ${isMobile ? 'mobile' : ''}`}>
      {/* 顶部导航栏 / 移动端菜单 */}
      {(!externalPostId || isMobile) && (
        <div className="bbs-detail-nav" style={{ justifyContent: !externalPostId ? 'space-between' : 'flex-end', padding: isMobile && externalPostId ? '0 12px 12px' : undefined }}>
          {!externalPostId ? (
            <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/bbs')}>返回广场</Button>
          ) : (
            <div /> /* 占位符，如果仅外链移动端也可保持flex分布 */
          )}

          <Space>
            {/* 移动端大纲按钮 */}
            {isMobile && outline.length > 0 && (
              <Button type="text" icon={<UnorderedListOutlined />} onClick={() => setOutlineDrawerOpen(true)}>
                {!isMobile && '大纲'}
              </Button>
            )}

            {/* 公共操作按钮（移动端仅显示图标以节省空间） */}
            {showActions && !externalPostId && (
              <>
                <Button type="text" onClick={toggleSubscription} style={{ color: isSubscribed ? 'var(--primary, #4f46e5)' : undefined }}>
                  {isSubscribed ? '⭐ 已关注' : '☆ 关注本帖'}
                </Button>
                <Button type="text" icon={<MessageOutlined />} onClick={() => {
                  setTimeout(() => {
                    const container = document.getElementById('bbs-container');
                    const target = document.getElementById('comments-section');
                    if (container && target) {
                      const cRect = container.getBoundingClientRect();
                      const tRect = target.getBoundingClientRect();
                      container.scrollBy({
                        top: tRect.top - cRect.top - 60,
                        behavior: 'smooth'
                      });
                    }
                  }, 0);
                }}>
                  {!isMobile && '留言区'}
                </Button>
                {canEdit && (
                  <Button type="text" icon={copiedExternalLink ? <CheckOutlined style={{color: '#52c41a'}} /> : <ShareAltOutlined />} onClick={handleShare}>
                    {copiedExternalLink ? '已复制' : (!isMobile ? '分享链接' : '')}
                  </Button>
                )}
              </>
            )}
            
            {/* 桌面端高阶操作按钮群（移动端彻底隐藏） */}
            {showActions && !externalPostId && !isMobile && (
              <Space size={2} wrap>
                {(isOwner || canEdit) && (
                  <Button type="text" icon={<EditOutlined />} onClick={() => navigate(`/bbs/${id}/edit`)}>编辑</Button>
                )}
                {canEdit && (
                  <Button type="text" icon={<PushpinOutlined />} onClick={handlePin}>{post?.isPinned ? '取消置顶' : '置顶'}</Button>
                )}
                {canEdit && (
                  <Button type="text" icon={<InboxOutlined />} onClick={handleArchive}>{post?.isArchived ? '取消归档' : '归档'}</Button>
                )}
                {(isOwner || canDelete) && (
                  <Button type="text" danger icon={<DeleteOutlined />} onClick={() => setDeleteModalOpen(true)}>删除</Button>
                )}
              </Space>
            )}
          </Space>
        </div>
      )}

      <div className="bbs-detail-body">
        {/* 主内容区 */}
        <div className="bbs-detail-main">
          <Card bordered={false} style={{ borderRadius: isMobile ? 12 : 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              {post.section && <Tag color="purple">{post.section.icon || '📁'} {post.section.name}</Tag>}
              {post.isPinned && <Tag color="orange">📌 置顶</Tag>}
              {post.isArchived && <Tag color="default">📦 已归档</Tag>}
            </div>
            <Title level={isMobile ? 3 : 1} style={{ marginBottom: 16 }}>{post.title}</Title>
            <div className="bbs-detail-meta">
              <Avatar size={isMobile ? 28 : 36} src={post.author?.avatar}>{post.author?.realName?.[0] || '?'}</Avatar>
              <div>
                <strong style={{ fontSize: isMobile ? 13 : 14 }}>{post.author?.realName || post.author?.username}</strong>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  发布于 {new Date(post.createdAt).toLocaleString()} · <EyeOutlined /> {post.viewCount || 0} 次阅读
                </div>
              </div>
            </div>
            {(Array.isArray(post.tags) ? post.tags : (typeof post.tags === 'string' ? post.tags.split(',') : []))?.length > 0 && (
              <div style={{ marginTop: 12, marginBottom: 8 }}>
                {(Array.isArray(post.tags) ? post.tags : (typeof post.tags === 'string' ? post.tags.split(',') : [])).map((t: string) => <Tag key={t} color="blue">{t}</Tag>)}
              </div>
            )}
            
            <Divider style={{ margin: '16px 0 24px 0' }} />

            <div className="markdown-body" style={{ minHeight: isMobile ? 200 : 400, fontSize: isMobile ? 15 : 16, lineHeight: 1.8 }}>
              <MarkdownViewer content={post.content} />
            </div>
            
            <Divider />
            
            {/* 留言区 */}
            {!externalPostId && (
                <div style={{ marginTop: isMobile ? 24 : 40 }} id="comments-section">
                  <Title level={4}>留言讨论 ({comments.length})</Title>
                  
                  {canComment && (
                    <div style={{ display: 'flex', marginTop: 16, marginBottom: 24, gap: isMobile ? 8 : 16 }}>
                      {!isMobile && <Avatar style={{ flexShrink: 0 }}>{user?.realName?.[0] || '我'}</Avatar>}
                      <div style={{ flex: 1 }}>
                        <div style={{ position: 'relative' }}>
                          <Input.TextArea
                            rows={isMobile ? 3 : 4}
                            placeholder="友善的观点，将使社区更美好...  支持粘贴截图"
                            value={newComment}
                            onChange={e => setNewComment(e.target.value)}
                            onPaste={handleCommentPaste}
                            style={{ borderRadius: 8, paddingBottom: 40 }}
                          />
                          <div style={{ position: 'absolute', right: 8, bottom: 8, display: 'flex', gap: 6, alignItems: 'center' }}>
                            <Button
                              type="text"
                              icon={uploadingCount > 0 ? <LoadingOutlined /> : <PictureOutlined />}
                              size="small"
                              style={{ color: 'var(--text-secondary)' }}
                              onClick={() => fileInputRef.current?.click()}
                              title="添加图片"
                            />
                            <Button 
                              type="primary" 
                              icon={<SendOutlined />} 
                              size={isMobile ? 'small' : 'middle'}
                              style={{ borderRadius: 6 }}
                              onClick={handlePostComment}
                              loading={submitting}
                              disabled={uploadingCount > 0}
                            >
                              发布
                            </Button>
                          </div>
                        </div>
                        {/* 图片预览条 */}
                        {commentImages.length > 0 && (
                          <div className="comment-image-preview-bar">
                            {commentImages.map((img, idx) => (
                              <div key={idx} className="comment-image-preview-item">
                                <Image
                                  src={img.url}
                                  width={60}
                                  height={60}
                                  style={{ objectFit: 'cover', borderRadius: 6 }}
                                  preview={{ mask: false }}
                                />
                                <CloseCircleFilled
                                  className="comment-image-preview-remove"
                                  onClick={() => removeCommentImage(idx)}
                                />
                              </div>
                            ))}
                            {uploadingCount > 0 && (
                              <div className="comment-image-preview-item" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-secondary)', borderRadius: 6, width: 60, height: 60 }}>
                                <LoadingOutlined style={{ fontSize: 20, color: 'var(--text-muted)' }} />
                              </div>
                            )}
                          </div>
                        )}
                        {/* 隐藏的文件输入 */}
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          multiple
                          style={{ display: 'none' }}
                          onChange={handleCommentImageSelect}
                        />
                      </div>
                    </div>
                  )}

                  <List
                    itemLayout="horizontal"
                    dataSource={comments}
                    renderItem={(item: any, index) => (
                      <List.Item style={{ padding: isMobile ? '12px 0' : '24px 0' }}>
                        <List.Item.Meta
                          avatar={<Avatar src={item.author?.avatar} size={isMobile ? 32 : 40}>{item.author?.realName?.[0] || '?'}</Avatar>}
                          title={
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
                              <strong style={{ fontSize: isMobile ? 13 : 14 }}>{item.author?.realName || item.author?.username}</strong>
                              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                                #{index + 1}楼 · {new Date(item.createdAt).toLocaleString()}
                              </span>
                            </div>
                          }
                          description={
                            <div className="comment-content" style={{ marginTop: 4, color: 'var(--text-primary)', fontSize: isMobile ? 14 : 15 }}>
                              <MarkdownViewer content={item.content} />
                            </div>
                          }
                        />
                      </List.Item>
                    )}
                  />
                </div>
            )}
          </Card>
        </div>

        {/* 桌面端侧边栏 */}
        {!isMobile && (
          <div className="bbs-detail-sidebar">
            <div style={{ position: 'sticky', top: 24 }}>
              <Card 
                bordered={false} 
                style={{ borderRadius: 12, background: 'var(--bg-secondary)' }} 
                bodyStyle={{ padding: '20px 24px' }}
              >
                {sidebarContent}
              </Card>
            </div>
          </div>
        )}
      </div>

      {/* 移动端大纲抽屉 */}
      {isMobile && (
        <Drawer
          title="目录导航"
          placement="right"
          width="75%"
          open={outlineDrawerOpen}
          onClose={() => setOutlineDrawerOpen(false)}
          styles={{ body: { padding: '16px 20px' } }}
        >
          {sidebarContent}
        </Drawer>
      )}

      {/* 删除确认弹窗 */}
      <Modal
        title="确认删除"
        open={deleteModalOpen}
        onOk={() => {
          handleDelete();
          setDeleteModalOpen(false);
        }}
        onCancel={() => setDeleteModalOpen(false)}
        okText="删除"
        okButtonProps={{ danger: true }}
        cancelText="取消"
      >
        <p>确定要删除帖子「{post?.title}」吗？此操作不可恢复。</p>
      </Modal>

      {/* 移动端悬浮回到顶部按钮 */}
      {isMobile && showBackTop && (
        <div className="bbs-detail-fab-top" onClick={handleBackToTop}>
          <VerticalAlignTopOutlined />
        </div>
      )}

    </div>
  );
}
