# CallCenter AI 助手 — 自建 RAG 系统 0→1 可行性方案

## 1. 结论：完全可行

基于对现有 CallCenter 代码库的全面审计，**在现有架构上集成 AI 对话助手是高度可行的**。核心原因：

| 能力 | 现有状态 | 评估 |
|---|---|---|
| AI 大模型调用 | ✅ 已集成 Gemini 3.1 Pro（KnowledgeService） | 直接复用 |
| 权限系统 | ✅ 完善的 `resource:action` RBAC 模型 | 新增 `ai:chat` 权限即可 |
| 全文检索 | ✅ Elasticsearch 已索引工单/消息/知识库/论坛 | RAG 关键词召回层 |
| 文件存储 | ✅ COS 云存储 + 上传/下载/预签名完整链路 | 文档存储层 |
| WebSocket | ✅ Socket.IO 实时通信已就绪 | AI 流式回答 |
| 前端框架 | ✅ React + Ant Design + 路由守卫 | 新增 `/ai` 页面 |
| 部署能力 | ✅ PM2 + Nginx + Docker（生产服务器） | Qdrant 用 Docker 部署 |

**唯一需要新增的核心组件：向量数据库 (Qdrant) + 文档解析 Worker + Embedding 管道。**

---

## 2. 系统架构设计

### 2.1 整体架构

```
┌──────────────────────────────────────────────────────────┐
│                     前端 (React + Antd)                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
│  │ AI 对话页 │  │ 知识管理  │  │ 文档上传  │  │ 权限配置  │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘ │
└───────┼──────────────┼──────────────┼──────────────┼──────┘
        │ SSE/WebSocket│    REST      │    REST      │
┌───────▼──────────────▼──────────────▼──────────────▼──────┐
│                  NestJS Backend (已有)                     │
│  ┌────────────┐  ┌────────────┐  ┌────────────────────┐  │
│  │ AI Module   │  │ RAG Service│  │ Doc Parser Worker  │  │
│  │ (新增)      │  │ (新增)     │  │ (新增)             │  │
│  └──────┬─────┘  └──────┬─────┘  └─────────┬──────────┘  │
│         │               │                   │             │
│  ┌──────▼────┐   ┌──────▼─────┐   ┌────────▼────────┐   │
│  │ Gemini API│   │ 混合检索    │   │ 文档解析管道     │   │
│  │ (已有)    │   │ ES+Qdrant  │   │ PDF/Word/PPT    │   │
│  └───────────┘   └──────┬─────┘   └────────┬────────┘   │
└──────────────────────────┼──────────────────┼────────────┘
                           │                  │
┌──────────────────────────▼──────────────────▼────────────┐
│                      数据层                               │
│  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────────────┐ │
│  │ MySQL  │  │  ES    │  │ Qdrant │  │ 腾讯云 COS     │ │
│  │ (已有) │  │ (已有) │  │ (新增) │  │ (已有)         │ │
│  │元数据   │  │关键词   │  │向量     │  │原始文件+解析产物│ │
│  │权限     │  │召回     │  │语义召回  │  │                │ │
│  └────────┘  └────────┘  └────────┘  └────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

### 2.2 RAG 检索流程（混合召回）

```
用户提问
  ├─→ Gemini Embedding API → Qdrant 语义召回 Top-K
  ├─→ ES multi_match 关键词召回 Top-K
  ├─→ 合并去重
  ├─→ Rerank 重排序（可选：Gemini 打分 / 简单 RRF 融合）
  ├─→ 组装证据包（chunk 内容 + 来源元数据）
  └─→ Gemini 基于证据生成回答（附引用来源）
```

### 2.3 数据模型设计（新增 MySQL 表）

```sql
-- AI 文档库（原始文件元数据）
CREATE TABLE ai_documents (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  title         VARCHAR(500) NOT NULL,
  fileName      VARCHAR(500) NOT NULL,       -- 原始文件名
  cosKey        VARCHAR(500) NOT NULL,       -- COS 存储路径
  fileType      VARCHAR(20) NOT NULL,        -- pdf/docx/pptx/md/txt
  fileSize      BIGINT DEFAULT 0,
  status        ENUM('pending','parsing','ready','error') DEFAULT 'pending',
  pageCount     INT DEFAULT 0,               -- 页码/slide 数
  chunkCount    INT DEFAULT 0,               -- 切片数量
  uploadedBy    INT NOT NULL,                -- 上传者 user.id
  projectName   VARCHAR(200),                -- 项目名称（可选标签）
  customerName  VARCHAR(200),                -- 客户名称（可选标签）
  tags          TEXT,                        -- 标签，逗号分隔
  parseError    TEXT,                        -- 解析错误信息
  createdAt     DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_status (status),
  INDEX idx_uploaded_by (uploadedBy)
);

-- AI 文档切片（chunk 元数据，向量存 Qdrant）
CREATE TABLE ai_chunks (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  documentId    INT NOT NULL,                -- 关联 ai_documents.id
  chunkIndex    INT NOT NULL,                -- 切片序号
  content       TEXT NOT NULL,               -- 原文文本
  pageNumber    INT,                         -- 所在页码
  sectionTitle  VARCHAR(500),                -- 章节标题
  chunkType     ENUM('text','table','image_desc') DEFAULT 'text',
  tokenCount    INT DEFAULT 0,
  qdrantPointId VARCHAR(100),                -- Qdrant 向量 ID
  createdAt     DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_document (documentId),
  INDEX idx_qdrant (qdrantPointId)
);

-- AI 对话会话
CREATE TABLE ai_sessions (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  userId        INT NOT NULL,
  title         VARCHAR(200),                -- 会话标题（自动生成）
  createdAt     DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_user (userId)
);

-- AI 对话消息
CREATE TABLE ai_messages (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  sessionId     INT NOT NULL,
  role          ENUM('user','assistant','system') NOT NULL,
  content       TEXT NOT NULL,
  citations     JSON,                        -- 引用来源 [{documentId, chunkId, pageNumber, title, snippet}]
  tokenUsage    INT DEFAULT 0,               -- token 消耗
  createdAt     DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_session (sessionId)
);
```

---

## 3. 技术选型详解

### 3.1 向量数据库：Qdrant（Docker 部署）

| 对比项 | Qdrant | pgvector | Milvus |
|---|---|---|---|
| 部署复杂度 | ⭐ 极低（单 Docker 镜像） | 需要 PostgreSQL | 重，需多组件 |
| 资源占用 | ~200MB 内存起步 | 取决于 PG | 2GB+ 内存 |
| 向量性能 | 优秀（HNSW） | 一般 | 优秀 |
| API 友好度 | REST + gRPC，JS SDK | SQL 查询 | 稍复杂 |
| 适合规模 | 10 万~千万向量 | 10 万以内 | 百万+ |
| 成熟度 | 生产级 | 生产级 | 生产级 |

**推荐 Qdrant**：一行 Docker 命令即可启动，内存占用小，REST API 简洁，JS/TS SDK 完善。

```bash
# 生产服务器一键部署
docker run -d --name qdrant \
  -p 6333:6333 -p 6334:6334 \
  -v /var/data/qdrant:/qdrant/storage \
  qdrant/qdrant:latest
```

### 3.2 Embedding 模型

| 方案 | 模型 | 维度 | 中文效果 | 成本 |
|---|---|---|---|---|
| **Gemini Embedding** | `text-embedding-004` | 768 | 优秀 | 免费额度大，超出极低 |
| OpenAI | `text-embedding-3-small` | 1536 | 优秀 | $0.02/1M tokens |
| 本地部署 | `bge-m3` | 1024 | 优秀 | 免费，需 GPU |

**推荐 Gemini `text-embedding-004`**：你已有 Gemini API Key，无需额外开通，免费额度足够 MVP 阶段。

### 3.3 文档解析方案

| 文件类型 | 解析工具 | 说明 |
|---|---|---|
| **PDF** | `pdf-parse` (Node.js) | 文本型 PDF 直接提取；扫描型 PDF 需 OCR |
| **Word (.docx)** | `mammoth` (已有) | 现有 BBS 已集成，直接复用 |
| **PPT (.pptx)** | `pptx-parser` / `unzipper` (已有) | 解压 XML 提取文字+图片 |
| **Markdown/Txt** | 原生 Node.js | 直接读取 |
| **图片 OCR** | Gemini Vision API | 用于扫描型 PDF、PPT 截图理解 |

### 3.4 文本切片策略

```
文档 → 按章节/标题拆分 → 每个 chunk 目标 500~800 tokens
      → 相邻 chunk 重叠 100 tokens（避免跨段落语义丢失）
      → 保留元数据：页码、章节标题、文件名、项目名
```

---

## 4. 生产服务器资源评估

**当前服务器 (192.168.50.51)：**

| 资源 | 现状 | AI 功能新增占用 | 评估 |
|---|---|---|---|
| CPU | i5-10500 (4核) | Qdrant HNSW 索引 ~0.5核 | ⚠️ 偏紧，可用 |
| 内存 | 7.5GB (已用 3.3GB) | Qdrant ~500MB + 解析 Worker ~200MB | ✅ 可承受 |
| 磁盘 | 20GB (已用 13GB, 剩 7.9GB) | Qdrant 数据 + 解析产物 | ⚠️ 需扩容或挂载额外磁盘 |
| Docker | ✅ 已安装 (v26.1.3) | 用于部署 Qdrant | ✅ 就绪 |

> [!WARNING]
> **磁盘空间是主要瓶颈**。当前仅剩 7.9GB，如果大量上传 PDF/PPT 文档（原始文件存 COS 不占本地），但 Qdrant 向量索引 + ES 索引 + MySQL 数据会持续增长。建议：
> 1. 清理不必要的文件（如旧的本地 `oss/` 备份）
> 2. 或挂载额外数据盘

---

## 5. 分阶段实施路线

### Phase 1：基础 AI 对话（1~2 天）

**目标**：实现最基本的 AI 对话页面，用户可以与 Gemini 直接对话。

**变更范围**：
- **[NEW] 后端** `src/modules/ai/` — AI Module（Controller + Service + Gateway）
- **[NEW] 前端** `src/pages/AI/` — AI 对话页面
- **[MODIFY] 前端** `App.tsx` — 新增 `/ai` 路由
- **[MODIFY] 前端** `MainLayout.tsx` — 侧边栏新增「AI 助手」菜单
- **[MODIFY] 后端** DB Seeder — 新增 `ai:chat` 权限

**交付物**：
- 独立的 AI 聊天界面（类似 ChatGPT）
- 多轮对话、历史会话管理
- 流式输出（SSE/WebSocket）
- `ai:chat` 权限控制

---

### Phase 2：自建 RAG 管道 — 向量检索（2~3 天）

**目标**：部署 Qdrant，实现"上传文档 → 解析 → 切片 → Embedding → 入库 → 语义检索"的完整管道。

**变更范围**：
- **[NEW] 生产服务器** Docker 部署 Qdrant
- **[NEW] 后端** `src/modules/ai/rag.service.ts` — RAG 检索编排
- **[NEW] 后端** `src/modules/ai/embedding.service.ts` — Embedding 管道
- **[NEW] 后端** `src/modules/ai/parser.service.ts` — 文档解析器
- **[NEW] 后端** DB 表 — `ai_documents`, `ai_chunks`
- **[MODIFY] 前端** AI 页面 — 新增文档上传面板 + 知识库管理

**交付物**：
- 用户上传 PDF/Word/PPT/Markdown → 自动解析入库
- AI 对话自动检索相关文档，带引用回答
- 文档管理界面（列表、状态、删除）

---

### Phase 3：混合检索 + 内部数据融合（1~2 天）

**目标**：将现有的 ES 索引数据（工单/消息/知识库/论坛）也纳入 RAG 检索范围。

**变更范围**：
- **[MODIFY] 后端** `rag.service.ts` — 集成 ES 关键词召回
- **[MODIFY] 后端** `search.service.ts` — 新增 RAG 专用检索方法
- **[NEW] 后端** Rerank 逻辑（RRF 算法融合 ES + Qdrant 结果）

**交付物**：
- AI 能搜索到系统内的历史工单、聊天记录、知识库文档、论坛帖子
- 混合检索：关键词精准匹配 + 语义相似度双通道
- 回答中附带引用来源（"来自工单 #T20250401-001 第3条消息"）

---

### Phase 4：高级 AI 能力（2~3 天）

**目标**：生成建议/方案/报告等高阶功能。

**变更范围**：
- **[NEW] 后端** `ai/generators/` — 方案生成器、PPT 生成器
- **[MODIFY] 前端** AI 页面 — 快捷指令面板（预设 Prompt 模板）

**交付物**：
- 快捷指令："帮我生成方案"、"对比两个项目的差异"、"总结本周工单"
- Markdown 方案生成 + 一键导出 Word/PDF
- PPT 大纲生成（基于 RAG 检索到的资料）

---

### Phase 5：打磨与增强（持续）

- 图片/扫描型 PDF 的 OCR 理解（Gemini Vision）
- PPT 页面截图理解
- 对话中直接引用并跳转到源文档
- Token 用量统计与配额管理
- 批量文档导入

---

## 6. 需要新增的 npm 依赖

| 包名 | 用途 | 大小 |
|---|---|---|
| `@qdrant/js-client-rest` | Qdrant JS SDK | 轻量 |
| `pdf-parse` | PDF 文本提取 | 轻量 |
| `langchain` (可选) | RAG 编排框架 | 较重，可自行实现 |

> [!TIP]
> 推荐**不用 LangChain**，直接用 Qdrant SDK + Gemini SDK 手写 RAG 管道。代码量不大（~300 行），但完全可控，避免引入重框架。

---

## 7. 成本估算

| 项目 | 费用 | 说明 |
|---|---|---|
| Qdrant | **免费** | 开源自部署，Docker 运行 |
| Gemini Embedding | **免费/极低** | 免费额度 1500 次/分钟 |
| Gemini 3.1 Pro 对话 | **现有成本** | 已在用，无新增 |
| COS 存储 | **现有成本** | 增量极小 |
| 服务器 | **现有** | 复用 192.168.50.51 |
| **总新增成本** | **≈ ¥0/月** | MVP 阶段几乎零成本 |

---

## User Review Required

> [!IMPORTANT]
> **以下决策需要你确认：**

### Q1: 向量数据库部署位置
Qdrant Docker 部署在现有生产服务器 `192.168.50.51` 上，还是本地 Mac 先做验证？

**建议**：先本地 Mac Docker 开发验证，跑通后同步到生产服务器。

### Q2: Phase 1 是否先行？
是否同意先做 Phase 1（纯 AI 对话，不含 RAG），快速上线一个可用版本，再逐步加入 RAG 能力？

### Q3: 文档范围
第一批需要导入 RAG 的文档类型优先级：
- [ ] PDF（标书、方案）
- [ ] Word (.docx)（技术文档）
- [ ] PPT (.pptx)（演示文稿）
- [ ] 系统内已有数据（工单/知识库/论坛帖子）

### Q4: 磁盘空间
生产服务器磁盘仅剩 7.9GB，是否有额外数据盘可挂载？或是否可以清理旧数据？

### Q5: LangChain vs 手写
是否倾向于使用 LangChain 框架，还是纯手写 RAG 管道（推荐，更轻更可控）？

---

## Verification Plan

### Phase 1 验证
- 本地启动后端，`curl` 测试 AI 对话 API
- 前端打开 `/ai` 页面，发送消息，验证流式回答
- 切换无权限用户，验证访问拦截

### Phase 2 验证
- 上传一份测试 PDF，检查 MySQL `ai_documents` 状态变为 `ready`
- 在 Qdrant Dashboard 验证向量已写入
- 发起与文档内容相关的提问，验证引用回答

### Phase 3 验证
- 提问包含工单号的问题，验证 ES 召回命中
- 提问语义相关问题，验证 Qdrant 召回命中
- 验证混合排序结果质量
