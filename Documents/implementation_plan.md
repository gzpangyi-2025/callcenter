# CallCenter 即时通讯与技术支持系统 — 架构设计与可行性分析

## 项目概述

构建一个面向公司二线技术支持的网页版即时通讯（IM）系统，核心围绕 **技术支持工单** 展开，集成实时聊天、远程协助、AI 知识库生成、RBAC 权限管理和统计报表等功能。

---

## 一、功能模块总结与可行性评估

### 1. 用户模块 ✅ 可实现

| 功能 | 说明 | 难度 |
|------|------|------|
| 注册/登录 | 测试阶段使用邮箱+密码注册，默认 `admin` 为管理员 | ⭐ |
| 企业微信对接（预留） | 预留 OAuth2 回调接口，后续对接企业微信 SSO | ⭐⭐ |
| 统一认证（预留） | 预留 LDAP/CAS/OIDC 等标准认证协议接口 | ⭐⭐ |

### 2. 技术支持模块 ✅ 可实现

| 功能 | 说明 | 难度 |
|------|------|------|
| **开单** | 模版化表单：标题、问题描述、问题类型、服务单号、客户名称 | ⭐ |
| **接单** | 接单后状态流转为"服务中"，生成支持单号，创建外部访问短链接 | ⭐⭐ |
| **即时聊天** | 基于 WebSocket (Socket.io) 的实时双向通讯，开单/接单人自动进入聊天房间，外部人员通过链接加入 | ⭐⭐⭐ |
| **富文本聊天** | 消息实时收发、图片/文件上传下载、聊天记录持久化、所见即所得编辑器 | ⭐⭐⭐ |
| **远程桌面协助** | 基于 WebRTC 实现屏幕共享和远程控制（需客户端配合） | ⭐⭐⭐⭐ |
| **关单** | 支持人员关单 → 创建人确认 → 2天超时自动关单 → AI 生成知识库文档（Markdown） | ⭐⭐⭐ |
| **工单列表** | 支持卡片/列表双模式切换，展示状态、时间、时长等 | ⭐⭐ |

> [!IMPORTANT]
> **远程桌面协助**是整个项目中技术复杂度最高的部分。纯浏览器端的远程控制存在操作系统权限限制，通常需要被控端安装一个轻量级 Agent 程序。建议实现路径：
> - **第一阶段**：先实现基于 WebRTC 的**屏幕共享**（纯浏览器即可）
> - **第二阶段**：开发轻量 Agent（Electron/Rust），实现真正的远程控制

### 3. 报表模块 ✅ 可实现

| 维度 | 说明 |
|------|------|
| 问题类型分布 | 饼图/柱状图 |
| 技术方向分布 | 分类统计 |
| 客户名称统计 | 按客户聚合 |
| 接单人统计 | 个人工作量排名 |
| 总数与时长 | 总工单数、平均处理时长、趋势图 |

> 前端使用 **ECharts** 或 **Chart.js** 渲染图表，后端提供聚合查询 API。

### 4. RBAC 权限模块 ✅ 可实现

| 功能 | 说明 |
|------|------|
| 角色管理 | 创建/编辑/删除角色（如管理员、技术支持、普通用户、外部访客） |
| 权限分配 | 工单的开单、接单、查看、编辑、删除、导出等细粒度权限 |
| 鉴权中间件 | 每个 API 请求经过权限校验中间件，基于角色判断是否放行 |
| 企业微信用户角色分配 | 导入的用户可在后台分配角色 |

### 5. 个人主页模块 ✅ 可实现

- 我发起的工单列表 / 我接手的工单列表
- 点击进入可查看完整聊天历史
- 查看 AI 生成的知识库文档（Markdown 渲染）

### 6. 全文搜索 ✅ 可实现

| 方案 | 说明 | 适用场景 |
|------|------|----------|
| MySQL FULLTEXT Index | 零额外依赖，MySQL 5.7+ 原生支持中文全文索引 | 数据量 < 50 万条 |
| Elasticsearch（后续升级） | 专业搜索引擎，支持分词、模糊匹配、高亮 | 数据量大 / 搜索要求高 |

> 建议初期使用 MySQL 全文索引 + ngram 分词器，后续按需升级。

### 7. 后台管理模块 ✅ 可实现

- 公司信息配置（名称、电话、邮箱）
- Logo 上传及品牌定制
- 角色权限可视化配置
- AI 配置面板（模型选择：Gemini 3.1 Pro / Nano Banana 2，API Key 加密存储）

### 8. 安全架构 ✅ 可实现

| 措施 | 方案 |
|------|------|
| 身份认证 | JWT Access Token（短有效期）+ HttpOnly Cookie 存储 Refresh Token |
| 传输安全 | Nginx 反向代理 + Let's Encrypt / 自签 SSL 证书，全站 HTTPS |
| API 防护 | 请求频率限制（Rate Limiting）、CORS 白名单、XSS/CSRF 防护 |
| 数据安全 | 密码 bcrypt 哈希、API Key AES 加密存储、SQL 参数化查询 |

---

## 二、关于 Redis 的建议

> [!TIP]
> **强烈建议加入 Redis**，它在本项目中将发挥以下关键作用：

| 用途 | 说明 | 重要性 |
|------|------|--------|
| **WebSocket 会话管理** | 存储在线用户列表、聊天房间映射，支持多实例部署时的 Socket.io Adapter | 🔴 核心 |
| **JWT Token 黑名单** | 用户登出时将 Token 加入黑名单，实现真正的 Token 失效 | 🔴 核心 |
| **消息队列/发布订阅** | IM 消息的 Pub/Sub，保证多节点间消息同步 | 🟡 重要 |
| **接口缓存** | 报表数据、工单列表等高频查询结果缓存，降低 MySQL 压力 | 🟡 重要 |
| **Rate Limiting** | 基于 IP/用户的 API 请求频率限制，防刷防爆破 | 🟢 可选 |
| **定时任务辅助** | 2天自动关单等定时逻辑的分布式锁 | 🟢 可选 |

> 不加 Redis 的话，单机开发阶段可以用内存替代，但进入生产/多实例部署后 **Redis 是必须的**。

---

## 三、推荐技术栈架构

```
┌─────────────────────────────────────────————————————┐
│                     前端 (Frontend)                  │
│  React 18 + TypeScript + Vite                       │
│  UI 框架: Ant Design 5                              │
│  状态管理: Zustand                                   │
│  实时通讯: Socket.io-client                          │
│  富文本: TipTap Editor                               │
│  图表: ECharts                                       │
│  远程桌面: WebRTC API                                │
│  Markdown渲染: react-markdown                        │
└──────────────────────┬──────────────────────────────┘
                       │ HTTPS (Nginx 反向代理)
┌──────────────────────▼──────────────────────────────┐
│                     后端 (Backend)                    │
│  Node.js + NestJS + TypeScript                      │
│  ORM: TypeORM (对接 MySQL)                           │
│  实时通讯: Socket.io + Redis Adapter                 │
│  认证: Passport.js + JWT                             │
│  文件存储: 本地 OSS 目录 (backend/oss/)               │
│  AI集成: Google Gemini API (知识库生成)               │
│  定时任务: @nestjs/schedule (自动关单)                │
│  权限: CASL 或自研 RBAC Guard                        │
│  全文搜索: MySQL FULLTEXT (初期)                     │
└───────┬──────────────────┬──────────────────────────┘
        │                  │
┌───────▼───────┐  ┌───────▼───────┐
│    MySQL 8    │  │    Redis 7    │
│  核心数据存储  │  │  缓存/会话/队列│
└───────────────┘  └───────────────┘
```

### 为什么选择这个栈？

| 选择 | 理由 |
|------|------|
| **NestJS** | 模块化架构天然适合 RBAC、中间件、Guard 等企业级需求；内置 WebSocket Gateway 完美适配 IM |
| **TypeORM** | TypeScript 原生 ORM，与 NestJS 深度集成，MySQL 支持完善 |
| **React + Ant Design** | 企业级 UI 组件库，开箱即用的表格、表单、布局组件，开发效率最高 |
| **Socket.io** | 成熟的 WebSocket 方案，自带心跳、断线重连、房间机制，配合 Redis Adapter 可水平扩展 |
| **TipTap** | 基于 ProseMirror 的现代富文本编辑器，支持图片、文件嵌入，可定制性极强 |

---

## 四、数据库核心表设计概览

```
users              ─── 用户表（id, username, email, password_hash, avatar, role_id, ...）
roles              ─── 角色表（id, name, description）
permissions        ─── 权限表（id, resource, action）
role_permissions   ─── 角色-权限关联表
tickets            ─── 工单表（id, title, description, type, status, service_no,
                       customer_name, creator_id, assignee_id, ticket_no,
                       external_link, created_at, assigned_at, closed_at）
messages           ─── 聊天消息表（id, ticket_id, sender_id, content, type,
                       file_url, created_at）
knowledge_docs     ─── 知识库文档表（id, ticket_id, title, content_md,
                       ai_summary, created_at）
attachments        ─── 附件表（id, ticket_id, message_id, filename,
                       file_path, file_size, mime_type）
company_settings   ─── 公司配置表（id, name, phone, email, logo_path）
ai_settings        ─── AI配置表（id, model_name, api_key_encrypted）
```

---

## 五、项目目录结构规划

```
callcenter/
├── frontend/                    # 前端项目 (React + Vite)
│   ├── src/
│   │   ├── components/          # 通用组件
│   │   ├── pages/               # 页面
│   │   │   ├── Login/           # 登录/注册
│   │   │   ├── Dashboard/       # 仪表盘
│   │   │   ├── Tickets/         # 工单管理
│   │   │   ├── Chat/            # 聊天界面
│   │   │   ├── Reports/         # 报表
│   │   │   ├── Profile/         # 个人主页
│   │   │   └── Admin/           # 后台管理
│   │   ├── services/            # API 调用层
│   │   ├── stores/              # 状态管理
│   │   ├── hooks/               # 自定义 Hooks
│   │   └── utils/               # 工具函数
│   └── package.json
│
├── backend/                     # 后端项目 (NestJS)
│   ├── src/
│   │   ├── modules/
│   │   │   ├── auth/            # 认证模块 (JWT + Cookie)
│   │   │   ├── users/           # 用户模块
│   │   │   ├── roles/           # 角色权限模块
│   │   │   ├── tickets/         # 工单模块
│   │   │   ├── chat/            # 即时通讯模块 (WebSocket)
│   │   │   ├── knowledge/       # 知识库模块
│   │   │   ├── reports/         # 报表模块
│   │   │   ├── search/          # 全文搜索模块
│   │   │   ├── files/           # 文件上传模块
│   │   │   └── settings/        # 系统配置模块
│   │   ├── guards/              # RBAC 鉴权守卫
│   │   ├── middleware/          # 中间件
│   │   ├── interceptors/        # 拦截器
│   │   └── common/              # 公共工具
│   ├── oss/                     # 文件对象存储目录
│   └── package.json
│
├── sync.sh                      # 代码同步脚本
└── docker-compose.yml           # (可选) MySQL + Redis 容器编排
```

---

## 六、开发分期建议

### 第一期 — 核心功能（约 3-4 周）
- 用户注册/登录 + JWT 认证
- 工单 CRUD + 状态流转
- 基础 IM 聊天（文字消息）
- 工单列表（卡片+列表）

### 第二期 — 增强功能（约 2-3 周）
- RBAC 权限模块
- 文件/图片上传
- 富文本聊天编辑器
- 个人主页

### 第三期 — 智能化与报表（约 2 周）
- AI 自动生成知识库文档
- 全文搜索
- 统计报表与图表
- 后台管理面板

### 第四期 — 高级功能（约 2-3 周）
- WebRTC 屏幕共享
- 远程桌面控制 Agent
- 企业微信对接
- SSL/HTTPS 部署

---

## 需要您确认的问题

> [!IMPORTANT]
> 1. **前端框架偏好**：推荐使用 **React + Ant Design**，您是否同意？还是更倾向 Vue 3 + Element Plus？
> 2. **Redis**：建议从一开始就引入，可以在本地和远程均通过包管理器安装。是否同意？
> 3. **远程桌面方案**：是否接受分阶段实现？即先做屏幕共享，再做远程控制？
> 4. **开发启动**：是否现在就开始初始化前后端项目框架（安装依赖、配置模板），从第一期开始开发？

## 验证计划

### 自动化测试
- 后端：NestJS 内置的 Jest 单元测试 + E2E 测试
- 前端：Vitest + React Testing Library
- API：Postman / REST Client 接口测试

### 手工验证
- 本地开发完成后通过 `sync.sh` 同步到远程服务器
- 远程通过 Nginx 提供 HTTPS 访问进行集成测试
