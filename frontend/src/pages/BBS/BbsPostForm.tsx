import { useState, useEffect, useMemo } from 'react';
import MDEditor from '@uiw/react-md-editor';
import { Button, Input, Select, message, Space, Card, Spin, Tree, Upload, Typography, Drawer } from 'antd';
import { ArrowLeftOutlined, SaveOutlined, ImportOutlined, SettingOutlined } from '@ant-design/icons';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import api, { filesAPI, bbsAPI } from '../../services/api';
import TurndownService from 'turndown';
// @ts-ignore
import { gfm } from 'turndown-plugin-gfm';
import * as mammoth from 'mammoth';

export default function BbsPostForm() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const isEdit = Boolean(id);
  const editId = id ? parseInt(id, 10) : undefined;

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [sectionId, setSectionId] = useState<number | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [loadingPost, setLoadingPost] = useState(isEdit);

  const [propertiesDrawerOpen, setPropertiesDrawerOpen] = useState(false);

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // 板块和预设标签数据
  const [sections, setSections] = useState<any[]>([]);
  const [presetTags, setPresetTags] = useState<any[]>([]);

  // 加载板块和预设标签
  useEffect(() => {
    bbsAPI.getSections().then((res: any) => {
      setSections(Array.isArray(res) ? res : []);
    }).catch(() => {});
    bbsAPI.getTags().then((res: any) => {
      setPresetTags(Array.isArray(res) ? res : []);
    }).catch(() => {});
  }, []);

  // 从 URL query 预选板块（发新帖时）
  useEffect(() => {
    if (!isEdit) {
      const sectionParam = searchParams.get('section');
      if (sectionParam) setSectionId(Number(sectionParam));
    }
  }, [isEdit, searchParams]);

  useEffect(() => {
    if (isEdit && editId) {
      api.get(`/bbs/posts/${editId}`)
        .then((post: any) => {
          if (post && post.id) {
            setTitle(post.title || '');
            setContent(post.content || '');
            if (post.sectionId) setSectionId(post.sectionId);
            if (post.tags) {
              setTags(typeof post.tags === 'string' ? post.tags.split(',').filter(Boolean) : (Array.isArray(post.tags) ? post.tags : []));
            }
          } else {
            message.error('获取帖子详情失败');
            navigate('/bbs');
          }
        })
        .catch(err => {
          console.error(err);
          message.error('获取帖子详情失败');
          navigate('/bbs');
        })
        .finally(() => setLoadingPost(false));
    }
  }, [isEdit, editId, navigate]);

  const handleSave = async (returnBack: boolean = true) => {
    if (!title.trim()) return message.warning('请输入标题');
    if (!content.trim()) return message.warning('请输入正文内容');
    if (title.length > 100) return message.warning('标题过长 (超过100字)');
    
    setSaving(true);
    try {
      const payload: any = {
        title: title.trim(),
        content,
        tags: tags,
        sectionId: sectionId || null,
      };

      if (isEdit) {
        const post: any = await api.put(`/bbs/posts/${editId}`, payload);
        if (post && post.id) {
          message.success('保存成功！');
          if (returnBack) navigate(`/bbs/${editId}`);
        } else {
          message.error('保存失败');
        }
      } else {
        const post: any = await api.post('/bbs/posts', payload);
        if (post && post.id) {
          message.success('发布成功！');
          if (returnBack) {
            navigate('/bbs');
          } else {
            navigate(`/bbs/${post.id}/edit`, { replace: true });
          }
        } else {
          message.error('发布失败');
        }
      }
    } catch (error: any) {
      console.error(error);
//       message.error(error.response?.data?.message || '操作失败'); // Removed by global interceptor refactor
    } finally {
      setSaving(false);
    }
  };

  const insertTextAtCursor = (text: string) => {
    const textarea = document.querySelector('.w-md-editor-text-input') as HTMLTextAreaElement;
    if (textarea) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        setContent(prev => prev.substring(0, start) + text + prev.substring(end));
        setTimeout(() => {
            textarea.focus();
            textarea.setSelectionRange(start + text.length, start + text.length);
        }, 100);
    } else {
        setContent(prev => prev + text);
    }
  };

  const uploadMultipleImagesAndInsert = async (items: any) => {
    const uploadPromises: Promise<string>[] = [];
    for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
            const file = items[i].getAsFile();
            if (file) {
                uploadPromises.push(filesAPI.upload(file, 'bbs').then((res: any) => {
                    if (res.code === 0 && res.data?.url) {
                        return `\n![图片](${res.data.url})\n`;
                    }
                    return '';
                }).catch(() => ''));
            }
        }
    }
    if (uploadPromises.length > 0) {
        const hide = message.loading('批量上传图片中...', 0);
        const results = await Promise.all(uploadPromises);
        hide();
        const combinedMarkdown = results.filter(Boolean).join('');
        if (combinedMarkdown) {
            insertTextAtCursor(combinedMarkdown);
        }
        return true;
    }
    return false;
  };

  const handlePaste = async (event: React.ClipboardEvent) => {
    const items = event.clipboardData.items;

    // 1. 特殊处理：拦截带格式的富文本内容（来自 Word 或者含有基本标题结构的网页内容）
    const htmlData = event.clipboardData.getData('text/html');
    if (htmlData && (htmlData.includes('urn:schemas-microsoft-com:office') || /<(h[1-6]|ul|ol|table)>/i.test(htmlData))) {
        // 如果是从代码编辑器复制来的带有语法高亮的原始代码栈，则跳过富文本处理
        if (!htmlData.includes('vscode') && !htmlData.includes('hljs')) {
            event.preventDefault();
            try {
                // 预处理 HTML，清理复杂表格，防止 GFM 解析器降级为原始 HTML
                const doc = new DOMParser().parseFromString(htmlData, 'text/html');
                
                // 强制修复没有表头的 Table，添加 th 让 GFM 插件能识别
                const tables = doc.querySelectorAll('table');
                tables.forEach(table => {
                    const firstRow = table.querySelector('tr');
                    if (firstRow && !table.querySelector('thead')) {
                        const thead = doc.createElement('thead');
                        table.insertBefore(thead, table.firstChild);
                        thead.appendChild(firstRow);
                        
                        const tds = firstRow.querySelectorAll('td, th');
                        tds.forEach(td => {
                            const th = doc.createElement('th');
                            th.innerHTML = td.innerHTML;
                            firstRow.replaceChild(th, td);
                        });
                    }
                });

                const cells = doc.querySelectorAll('td, th');
                cells.forEach(cell => {
                    cell.removeAttribute('rowspan');
                    cell.removeAttribute('colspan');
                    // 彻底清除所有复杂的内部标签（p, span, div），仅保留文本，彻底治愈 markdown 表格降维打击
                    let text = cell.textContent || '';
                    text = text.replace(/\n/g, ' ').trim();
                    cell.innerHTML = text;
                });

                const turndownService = new TurndownService({ headingStyle: 'atx' });
                turndownService.use(gfm);
                
                // 防卡顿/防413规则：清理掉 Word 复制带来的庞大 Base64 行内图片和无法访问的本地缓存图片
                turndownService.addRule('stripBrokenImages', {
                    filter: 'img',
                    replacement: function (_content, node: any) {
                        const src = node.getAttribute('src');
                        if (src && (src.startsWith('data:image') || src.startsWith('file://'))) {
                            return '\n> [!WARNING]\n> ⚠️ 从 Word 复制引发的本地图片无法被直接粘贴。若要保留图文，请直接将 .docx 文件拖拽进本编辑器内导入。\n';
                        }
                        return `![图片](${src || ''})`;
                    }
                });

                // 将被污染的 HTML 转译为干净的 Markdown
                const markdownText = turndownService.turndown(doc.body.innerHTML);
                insertTextAtCursor(markdownText);
                return; // 如果处理成功，则短路后面的默认操作
            } catch (e) {
                console.error('富文本/Word 转换粘贴失败，回退到默认行为:', e);
            }
        }
    }

    // 2. 兜底处理：处理单纯的图片直接粘贴或多张截图并行粘贴
    const hasImageItem = Array.from(items).some((item: any) => item.type.indexOf('image') !== -1);
    if (hasImageItem) {
        event.preventDefault(); // 必须同步阻止默认事件
        await uploadMultipleImagesAndInsert(items);
    }
  };

  const handleDocxDrop = async (file: File) => {
    const hide = message.loading('解析 Word 文档解包中，正在抽取图片至服务端...', 0);
    try {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer }, {
            styleMap: [
                "p[style-name='trustfar-标题1'] => h1:fresh",
                "p[style-name='trustfar-标题2'] => h2:fresh",
                "p[style-name='trustfar-标题3'] => h3:fresh",
                "p[style-name='trustfar-标题4'] => h4:fresh",
                "p[style-name='trustfar-标题5'] => h5:fresh",
                "p[style-name='trustfar-标题6'] => h6:fresh",
                "p[style-name='标题 1'] => h1:fresh",
                "p[style-name='标题 2'] => h2:fresh",
                "p[style-name='标题 3'] => h3:fresh",
                "p[style-name='标题 4'] => h4:fresh",
                "p[style-name='标题 5'] => h5:fresh",
                "p[style-name='标题 6'] => h6:fresh",
                "p[style-name='Heading 1'] => h1:fresh",
                "p[style-name='Heading 2'] => h2:fresh",
                "p[style-name='Heading 3'] => h3:fresh",
                "p[style-name='Heading 4'] => h4:fresh",
                "p[style-name='Heading 5'] => h5:fresh",
                "p[style-name='Heading 6'] => h6:fresh"
            ],
            convertImage: mammoth.images.imgElement(async (element: any) => {
                try {
                    const contentType = element.contentType;
                    const b64 = await element.read("base64");
                    const byteCharacters = atob(b64);
                    const byteNumbers = new Array(byteCharacters.length);
                    for (let i = 0; i < byteCharacters.length; i++) {
                        byteNumbers[i] = byteCharacters.charCodeAt(i);
                    }
                    const byteArray = new Uint8Array(byteNumbers);
                    const blob = new Blob([byteArray], { type: contentType });
                    const ext = contentType === 'image/jpeg' ? 'jpg' : contentType === 'image/png' ? 'png' : 'gif';
                    const imageFile = new File([blob], `word_image_${Date.now()}.${ext}`, { type: contentType });
                    
                    const res: any = await filesAPI.upload(imageFile, 'bbs');
                    if (res.code === 0 && res.data?.url) {
                        return { src: res.data.url };
                    }
                } catch (imgError) {
                    console.error('单张图片上传失败:', imgError);
                }
                return { src: '' }; // 如果失败则返回空图
            })
        });
        
        let html = result.value;
        const doc = new DOMParser().parseFromString(html, 'text/html');
        
        const tables = doc.querySelectorAll('table');
        tables.forEach(table => {
            const firstRow = table.querySelector('tr');
            if (firstRow && !table.querySelector('thead')) {
                const thead = doc.createElement('thead');
                table.insertBefore(thead, table.firstChild);
                thead.appendChild(firstRow);
                
                const tds = firstRow.querySelectorAll('td, th');
                tds.forEach(td => {
                    const th = doc.createElement('th');
                    th.innerHTML = td.innerHTML;
                    firstRow.replaceChild(th, td);
                });
            }
        });

        const cells = doc.querySelectorAll('td, th');
        cells.forEach(cell => {
            cell.removeAttribute('rowspan');
            cell.removeAttribute('colspan');
            let text = cell.textContent || '';
            text = text.replace(/\n/g, ' ').trim();
            cell.innerHTML = text;
        });
        html = doc.body.innerHTML;

        const turndownService = new TurndownService({ headingStyle: 'atx' });
        turndownService.use(gfm);
        
        turndownService.addRule('stripBrokenImages', {
            filter: 'img',
            replacement: function (_content, node: any) {
                const src = node.getAttribute('src');
                if (src && (src.startsWith('data:image') || src.startsWith('file://'))) {
                    return '\n> [!WARNING]\n> ⚠️ 从 Word 复制引发的本地图片无法被直接粘贴。若要保留图文，请直接将 .docx 文件拖拽进本编辑器内导入。\n';
                }
                return `![${node.getAttribute('alt') || '图片'}](${src || ''})`;
            }
        });

        const markdown = turndownService.turndown(html);
        insertTextAtCursor('\n' + markdown + '\n');
        message.success('Word 文档解析导入完毕！格式已无损保留。');
    } catch (e) {
        console.error('Docx 解析严重异常:', e);
        message.error('Word 文档转码失败，可能是加密或特殊格式不支持');
    } finally {
        hide();
    }
  };

  const handleDrop = async (event: React.DragEvent) => {
    event.preventDefault();
    const items = event.dataTransfer.items;
    
    // 拦截 docx 拖入解压转译
    if (items.length === 1 && items[0].kind === 'file') {
        const file = items[0].getAsFile();
        if (file && (file.name.endsWith('.docx') || file.type.includes('wordprocessingml'))) {
            await handleDocxDrop(file);
            return;
        }
    }

    // 兜底图片处理
    await uploadMultipleImagesAndInsert(items);
  };

  const handleImportFile = (file: File) => {
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      
      if (ext === 'docx') {
          handleDocxDrop(file);
          return false; // 阻止 antd 自动上传行为
      }
      
      if (['pdf', 'pptx', 'ppt', 'doc'].includes(ext)) {
          message.warning({ content: `为保证极佳的排版格式，本平台暂不提供对 ${ext.toUpperCase()} 极其复杂的自降级抽取。请先将其另存为 DOCX 格式，再次导入即可享受一键图文上云！`, duration: 6 });
          return false;
      }
      
      if (['md', 'txt', 'sh', 'json', 'csv', 'log', 'js', 'ts', 'java', 'py', 'sql', 'html', 'css', 'go', 'yml', 'yaml'].includes(ext)) {
          file.text().then(text => {
              const isMarkdown = ['md', 'txt'].includes(ext);
              const textToInsert = isMarkdown ? `\n${text}\n` : `\n\`\`\`${ext}\n${text}\n\`\`\`\n`;
              insertTextAtCursor(textToInsert);
              message.success(`已成功提取 ${file.name} 内容并插入光标处！`);
          }).catch(() => message.error('提取文本文档内容失败'));
          return false;
      }
      
      message.error(`暂不支持直接导入 ${ext.toUpperCase() || '未知'} 格式的文档。`);
      return false;
  };



  const outlineItems = useMemo(() => {
    // 找出所有的代码块区间，避免把代码块里的注释如 # bash comment 错误识别为标题
    const codeBlockRanges: { start: number, end: number }[] = [];
    const codeBlockRegex = /^```[^\n]*\n[\s\S]*?^```/gm;
    let cbMatch;
    while ((cbMatch = codeBlockRegex.exec(content)) !== null) {
      codeBlockRanges.push({ start: cbMatch.index, end: cbMatch.index + cbMatch[0].length });
    }

    const regex = /^(#{1,6})\s+(.+)$/gm;
    const items: any[] = [];
    const stack: { level: number, item: any }[] = [];
    let match;

    while ((match = regex.exec(content)) !== null) {
      // 如果当前标题匹配命中任意一个代码块区间内，直接跳过
      const isInsideCodeBlock = codeBlockRanges.some(range => match!.index >= range.start && match!.index <= range.end);
      if (isInsideCodeBlock) continue;

      const level = match[1].length;
      const title = match[2].trim();
      const node = {
        title,
        key: match.index.toString(),
        charIndex: match.index,
        children: [],
      };

      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }

      if (stack.length === 0) {
        items.push(node);
      } else {
        stack[stack.length - 1].item.children.push(node);
      }

      stack.push({ level, item: node });
    }

    return items;
  }, [content]);

  if (loadingPost) {
    return <div style={{ padding: 100, textAlign: 'center' }}><Spin size="large" /></div>;
  }

  const SidebarContent = (
    <>
      {/* 板块选择 */}
      <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '10px 12px', flexShrink: 0 }}>
        <div style={{ paddingBottom: 6, fontWeight: 'bold', color: 'var(--text-secondary)', fontSize: 13 }}>所属板块</div>
        <Select
          placeholder="选择板块"
          value={sectionId}
          onChange={setSectionId}
          allowClear
          style={{ width: '100%' }}
          variant="borderless"
          options={sections.map(s => ({ label: `${s.icon || '📁'} ${s.name}`, value: s.id }))}
        />
      </div>

      {/* 标签 */}
      <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '10px 12px', flexShrink: 0 }}>
        <div style={{ paddingBottom: 6, fontWeight: 'bold', color: 'var(--text-secondary)', fontSize: 13 }}>帖子标签</div>
        <Select
          mode="tags"
          placeholder="选择或输入标签"
          value={tags}
          onChange={setTags}
          maxTagCount={5}
          variant="borderless"
          style={{ width: '100%', borderBottom: '1px solid var(--border)' }}
          options={presetTags.map(t => ({ label: t.name, value: t.name }))}
        />
      </div>

      {/* 实时大纲 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg-secondary)', borderRadius: 8, padding: '10px 12px', minHeight: 0 }}>
        <div style={{ paddingBottom: 8, fontWeight: 'bold', color: 'var(--text-secondary)', fontSize: 13 }}>实时大纲</div>
        <div style={{ flex: '1 1 auto', overflowY: 'auto', height: 0 }}>
          {outlineItems.length > 0 ? (
            <Tree
              treeData={outlineItems}
              expandedKeys={outlineItems.flatMap(function getKeys(node: any): string[] { 
                return [node.key, ...(node.children || []).flatMap(getKeys)] 
              })}
              selectedKeys={[]}
              onSelect={(_keys, info: any) => {
                const charIndex = info.node.charIndex;
                const ta = document.querySelector('.w-md-editor-text-input') as HTMLTextAreaElement;
                if (ta && charIndex !== undefined) {
                  ta.focus();
                  ta.setSelectionRange(charIndex, charIndex);
                  setTimeout(() => {
                    const beforeContent = content.substring(0, charIndex);
                    const linesCount = beforeContent.split('\n').length;
                    ta.scrollTop = Math.max(0, (linesCount - 3) * 24);
                    ta.dispatchEvent(new Event('scroll'));
                  }, 50);
                }
              }}
              showLine={{ showLeafIcon: false }}
              style={{ background: 'transparent' }}
              blockNode
            />
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', marginTop: 40 }}>
              输入 # 标题 即可生成大纲
            </div>
          )}
        </div>
      </div>
    </>
  );

  return (
    <div style={{ padding: isMobile ? '8px 12px' : '16px 24px', maxWidth: 1200, margin: '0 auto', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 56px)', boxSizing: 'border-box' }}>
      <div id="bbs-post-form-top" />

      <Card bordered={false} style={{ borderRadius: 12, display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', minHeight: 0 }} bodyStyle={{ padding: isMobile ? 12 : 16, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        
        {/* 全局双分栏 */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 16, overflowY: isMobile ? 'auto' : 'hidden' }} onPaste={handlePaste} onDrop={handleDrop} onDragOver={e => e.preventDefault()}>
          
          {/* 左侧编辑区域 (包含原本的顶部标题控制栏) */}
          <div data-color-mode="light" style={{ flex: isMobile ? 'none' : 1, height: isMobile ? 'auto' : '100%', minHeight: isMobile ? 500 : 0, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            
            {/* 顶部控制栏 */}
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16, flexShrink: 0, flexWrap: isMobile ? 'wrap' : 'nowrap', gap: 12 }}>
              <Space size="small" style={{ marginRight: isMobile ? 8 : 12, flexShrink: 0 }}>
                <Button type="text" size="small" icon={<ArrowLeftOutlined />} onClick={() => navigate(isEdit ? `/bbs/${editId}` : '/bbs')} style={{ fontWeight: 'bold', color: 'var(--text-secondary)' }}>返回</Button>
                <div style={{ width: 1, height: 12, background: 'var(--border)' }} />
                {!isMobile && <span style={{ fontWeight: 'bold', color: 'var(--text-secondary)', fontSize: 13, whiteSpace: 'nowrap' }}>{isEdit ? '编辑帖子' : '发新帖'}</span>}
              </Space>
              
              <div style={{ display: 'flex', alignItems: 'center', flex: isMobile ? '1 1 100%' : 1, minWidth: 0 }}>
                {!isMobile && <span style={{ fontWeight: 'bold', color: 'var(--text-secondary)', marginRight: 8, fontSize: 14, whiteSpace: 'nowrap' }}>标题</span>}
                <Input 
                  size="middle" 
                  placeholder="请输入帖子标题" 
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  maxLength={100}
                  style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 'bold', border: 'none', borderBottom: '1px solid #e8e8e8', borderRadius: 0, paddingLeft: 8, paddingRight: 8, boxShadow: 'none', background: 'transparent' }}
                />
              </div>

              <Space size="small" style={{ width: isMobile ? '100%' : 'auto', justifyContent: isMobile ? 'flex-end' : 'flex-start', flexShrink: 0 }}>
                {isMobile ? (
                  <Button type="primary" icon={<SaveOutlined />} onClick={() => handleSave(false)} loading={saving} />
                ) : (
                  <Button type="primary" icon={<SaveOutlined />} onClick={() => handleSave(false)} loading={saving}>{isEdit ? '保存' : '发布'}</Button>
                )}
                <Button onClick={() => handleSave(true)} loading={saving}>{isEdit ? '保存并返回' : '发布并返回'}</Button>
                {isMobile && (
                  <Button type="dashed" icon={<SettingOutlined />} onClick={() => setPropertiesDrawerOpen(true)}>属性</Button>
                )}
              </Space>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 8, padding: '0 4px' }}>
              {!isMobile && (
                <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                  💡 撰写指南：直接将 Word 文档拖拽入黑框，或点击右侧按键一键导入源文件
                </Typography.Text>
              )}
              <div style={{ flex: isMobile ? 1 : 'none', textAlign: isMobile ? 'right' : 'left' }}>
                <Upload 
                  accept=".docx,.md,.txt,.sh,.json,.csv,.log,.js,.ts,.py,.java,.sql,.html,.css,.go,.yml,.yaml,.pdf,.pptx,.ppt" 
                  showUploadList={false} 
                  beforeUpload={handleImportFile}
                >
                  <Button type="primary" size="small" icon={<ImportOutlined />} style={{ borderRadius: 6, fontWeight: 'bold' }}>导入本地文档</Button>
                </Upload>
              </div>
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              <MDEditor
                value={content}
                onChange={(v: string | undefined) => setContent(v || '')}
                height="100%"
                visibleDragbar={false}
                preview="edit"
                textareaProps={{
                  placeholder: '支持按 Ctrl+V 粘贴单张或多张截图...\n支持导入 Word、Txt、以及各式代码日志源文件...',
                }}
              />
            </div>
          </div>
          
          {/* 右侧边栏 (桌面端) / 属性抽屉 (移动端) */}
          {isMobile ? (
            <Drawer
              title="帖子属性"
              placement="bottom"
              height="80vh"
              onClose={() => setPropertiesDrawerOpen(false)}
              open={propertiesDrawerOpen}
              bodyStyle={{ padding: '16px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}
            >
              {SidebarContent}
            </Drawer>
          ) : (
            <div style={{ width: 280, display: 'flex', flexDirection: 'column', height: '100%', gap: 12, minHeight: 0 }}>
              {SidebarContent}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
