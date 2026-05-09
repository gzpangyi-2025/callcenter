# CallCenter 系统对接技术手册

> **版本：** v3.0 | **日期：** 2026年5月9日 | **编制：** CallCenter 项目组  
> **面向：** 公司信息部/OMM团队开发人员、OAuth2.0对接开发人员

---

## 一、服务器与基础设施需求

### 1.1 服务器配置需求

| 项目 | 最低配置 | 推荐配置 | 说明 |
|------|---------|---------|------|
| CPU | 4 核 | 8 核 | Node.js 单线程运行，多核用于 Nginx/MySQL/ES 并发 |
| 内存 | 8 GB | 16 GB | MySQL 约 2G + Elasticsearch 约 2G + Node 约 1G + 系统预留 |
| 系统盘 | 100 GB SSD | 200 GB SSD | 系统+数据库+日志+附件缓存 |
| 带宽 | 100 Mbps | 100 Mbps | WebRTC 屏幕共享/语音协作需较高带宽 |
| 操作系统 | CentOS 8+ | CentOS 8 Stream / Rocky Linux 9 | |

### 1.2 网络端口需求

| 端口 | 用途 | 方向 |
|------|------|------|
| 443 (HTTPS) | Web 服务 + API + WebSocket | 入站 |
| 80 (HTTP) | 自动跳转 HTTPS | 入站 |
| 3478 (TCP/UDP) | TURN 服务控制端口（用于 WebRTC 音视频/屏幕共享穿透） | 入站 |
| 49152-65535 (UDP)| TURN 服务媒体中继端口范围（WebRTC 流量转发） | 入站 |
| 3306 | MySQL（仅本机监听） | 本机 |
| 6379 | Redis（仅本机监听） | 本机 |
| 9200 | Elasticsearch（仅本机监听） | 本机 |

### 1.3 域名与证书需求

| 项目 | 说明 |
|------|------|
| 域名 | `callcenter.trustfar.cn` |
| SSL 证书 | 公司信息部/OMM团队提供 `.crt`/`.pem` + `.key` 文件 |
| DNS 解析 | 内网解析：A 记录指向内网 IP `172.31.0.22`<br>外网解析：A 记录指向公网 IP `101.251.208.178` |

### 1.4 数据库配置

| 组件 | 版本 | 用途 |
|------|------|------|
| **MySQL 8.0** | 8.0+ | 主数据库（用户、工单、消息、权限等） |
| **Redis 7** | 7.0+ | 会话缓存、JWT 黑名单、任务队列 |
| **Elasticsearch** | 8.10+ | 全文检索（工单/知识库搜索） |

**MySQL 数据表总览：**

| 表名 | 说明 | 核心字段 |
|------|------|---------|
| `users` | 用户表 | id, username, email, password, realName, phone, avatar, roleId |
| `roles` | 角色表 | id, name, description |
| `permissions` | 权限表 | id, name, description |
| `role_permissions` | 角色-权限关联 | roleId, permissionId |
| `tickets` | 工单表 | id, ticketNo, title, description, type, status, serviceNo, customerName, creatorId, assigneeId, category1/2/3 |
| `messages` | 工单消息/聊天 | id, ticketId, senderId, content, type |
| `ticket_participants` | 工单协作者 | ticketId, userId |
| `audit_logs` | 审计日志 | id, type, action, userId, detail, ip |
| `settings` | 系统设置 | key, value |

---

## 二、系统架构概览

```
┌─────────────────────────────────────────────────────┐
│                    前端 (React + Ant Design)          │
│         callcenter.trustfar.cn (Nginx 反向代理)       │
└──────────────┬──────────────────────────────────────┘
               │ HTTPS / WebSocket
┌──────────────▼──────────────────────────────────────┐
│              后端 NestJS (Node.js)                    │
│  ┌──────────┬──────────┬──────────┬───────────────┐  │
│  │ Auth     │ Tickets  │ Users   │ Knowledge/BBS │  │
│  │ 认证模块  │ 工单模块  │ 用户模块 │ 知识库/社区    │  │
│  └──────────┴──────────┴──────────┴───────────────┘  │
│  JWT 认证 · RBAC 权限 · WebSocket 实时通信             │
└──────┬─────────┬──────────┬──────────────────────────┘
       │         │          │
  MySQL 8.0   Redis 7   Elasticsearch 8
```

**技术栈：** 前端 React + Ant Design | 后端 NestJS (Node.js) | JWT 认证 | PM2 进程管理 | Nginx 反向代理

---

## 三、OAuth2.0 统一登录对接

### 3.1 对接方式

采用 **OAuth 2.0 授权码模式（Authorization Code Flow）**，与 OMM 系统接入方式一致。

### 3.2 登录流程

```
① 用户访问 callcenter.trustfar.cn
② 检测未登录 → 302 跳转至统一认证平台
   https://yx.trustfar.cn/oauth/authorize?
     client_id={CALLCENTER_CLIENT_ID}&
     scope=read&
     response_type=code&
     redirect_uri=https://callcenter.trustfar.cn/api/auth/sso/callback&
     state={random}
③ 用户在统一认证平台完成企业微信扫码登录
④ 认证平台携带 code 回调至 CallCenter
   https://callcenter.trustfar.cn/api/auth/sso/callback?code=xxx&state=xxx
⑤ CallCenter 后端用 code 换取 access_token
⑥ 用 access_token 获取用户信息
⑦ 自动创建/匹配本地账号 → 签发 JWT → 登录成功
```

### 3.3 公司信息部/OMM团队需提供

| # | 信息项 | 说明 |
|---|-------|------|
| 1 | **CallCenter 的 Client ID** | 类似 OMM 的 `APP014` |
| 2 | **Client Secret** | 与 Client ID 配对的密钥 |
| 3 | **授权地址 (Authorization URL)** | 如 `yx.trustfar.cn/oauth/authorize` |
| 4 | **令牌获取地址 (Token URL)** | 如 `yx.trustfar.cn/oauth/token` |
| 5 | **用户信息地址 (UserInfo URL)** | 如 `yx.trustfar.cn/oauth/userinfo` |
| 6 | **Scope** | 建议与 OMM 一致 (`read`) |
| 7 | **回调地址白名单注册** | 将 `https://callcenter.trustfar.cn/api/auth/sso/callback` 加入白名单 |
| 8 | **UserInfo 返回字段文档** | 见 3.4 |
| 9 | **测试账号** | 供联调使用 |

### 3.4 账号自动注册机制及所需字段

CallCenter团队系统将全面实现无感自动注册。当用户首次通过单点登录（SSO）访问时，系统基于返回信息自动注册本地账号，因此必须提供以下字段：

| 字段 | 必须 | 说明 |
|------|------|------|
| userId / 工号 | ✅ | 唯一标识，用于关联用户和工单对接 |
| realName | ✅ | 系统内显示姓名 |
| email | 可选 | 通知 |
| phone | 可选 | 通知 |
| avatar | 可选 | 头像 URL |
| department | 可选 | 组织架构 |

### 3.5 CallCenter团队提供

| 信息项 | 值 |
|-------|-----|
| 回调地址 (Redirect URI) | `https://callcenter.trustfar.cn/api/auth/sso/callback` |
| 登录成功跳转 | `https://callcenter.trustfar.cn/` |
| 应用名称 | "CallCenter" 或 "技术支持中心" |

---

## 四、企业微信 H5 应用对接

### 4.1 对接方式

在企业微信「工作台」创建自建 H5 应用，员工点击后打开 CallCenter 页面，通过企业微信 OAuth 自动免密登录。

### 4.2 登录流程

```
① 员工在企业微信工作台点击 "CallCenter" 应用
② 企业微信自动携带 code 跳转至应用首页
   https://callcenter.trustfar.cn/?code=xxx
③ 前端将 code 发送至后端
④ 后端调用企业微信 API 用 code 换取用户身份 (userid)
⑤ 匹配本地账号 → 签发 JWT → 登录成功
```

### 4.3 公司信息部/OMM团队需提供

| # | 信息项 | 说明 |
|---|-------|------|
| 1 | 企业 CorpID | 企业微信企业标识 |
| 2 | 应用 AgentID + Secret | 自建应用凭证 |
| 3 | 可信域名配置 | 将 `callcenter.trustfar.cn` 加入可信域名 |
| 4 | JS-SDK 域名白名单 | 如需使用企微 JS-SDK |

### 4.4 CallCenter团队需提供

| 信息项 | 值 |
|-------|-----|
| 应用首页地址 | `https://callcenter.trustfar.cn/` |
| 域名验证文件 | 配合域名归属验证 |
| 后端回调接口 | `https://callcenter.trustfar.cn/api/auth/wechat-work/callback` |

---

## 五、OMM 工单推送接口规范（含自动建号机制）

### 5.1 对接原则

- OMM 系统可通过 **HTTP 接口直推（首选）** 或 **消息中间件（MQ）** 推送二线工单至 CallCenter
- 若采用 MQ，请提供连接凭证及 Topic，无论哪种方式，字段结构要求均一致
- 认证方式：**Service Token**（CallCenter团队分配长期有效的 API 密钥）

> [!IMPORTANT]
> **关于取消组织架构同步与工单推送“自动建号”的说明**  
> 本期项目已取消“全量组织架构同步”模块。为了防止 OMM 推送工单时遇到“分配给了一个从未登录过的员工，导致工单创建失败”的问题，我们在推送接口中新增了人员的明细字段（如 `assigneeName`, `assigneeDepartment`）。
> **处理逻辑：** 当接收到工单时，若系统检测到该工号未曾注册，将直接使用推送过来的信息进行静默建号，确保工单稳定落地。

### 5.2 接口认证

所有 OMM 系统调用的接口均需在 HTTP Header 中携带：

```
Authorization: Bearer {SERVICE_TOKEN}
```

`SERVICE_TOKEN` 由 CallCenter 管理员生成并提供给 OMM 开发方。

### 5.3 创建工单

```
POST https://callcenter.trustfar.cn/api/ext/tickets
Content-Type: application/json
Authorization: Bearer {SERVICE_TOKEN}
```

**请求体：**

```json
{
  "title": "XX客户存储扩容故障",
  "description": "客户反馈存储扩容后无法识别新磁盘，需二线远程支持...",
  "serviceNo": "SR-2026-05-00123",
  "customerName": "XX科技有限公司",
  "creatorEmployeeId": "10086",
  "creatorName": "王五",
  "creatorEmail": "wangwu@trustfar.cn",
  "creatorPhone": "13900139000",
  "creatorDepartment": "客服中心",
  "creatorPosition": "一线客服",
  "assigneeEmployeeId": "10087",
  "assigneeName": "李四",
  "assigneeEmail": "lisi@trustfar.cn",
  "assigneePhone": "13800138000",
  "assigneeDepartment": "IT运维部",
  "assigneePosition": "高级工程师",
  "type": "hardware",
  "category1": "远程支持",
  "category2": "存储",
  "category3": "XX项目"
}
```

**字段说明：**

| 字段 | 类型 | 必须 | 说明 |
|------|------|------|------|
| `title` | string(200) | ✅ | 工单标题 |
| `description` | text | ✅ | 详细问题描述 |
| `serviceNo` | string(100) | ✅ | OMM 系统中的原始服务单号（唯一） |
| `customerName` | string(100) | ✅ | 终端客户名称 |
| `creatorEmployeeId` | string | ✅ | 开单人员工号（关联创建人） |
| `creatorName` | string | ✅ | **[新增]** 开单人姓名，用于自动建号 |
| `creatorEmail` | string | ✅ | **[新增]** 开单人邮箱 |
| `creatorPhone` | string | ✅ | **[新增]** 开单人手机号 |
| `creatorDepartment`| string | ✅ | **[新增]** 开单人部门 |
| `creatorPosition` | string | ✅ | **[新增]** 开单人职位/岗位 |
| `assigneeEmployeeId` | string | ✅ | 二线支持人员工号（关联处理人） |
| `assigneeName` | string | ✅ | **[新增]** 处理人姓名，用于工号不存在时自动建号 |
| `assigneeEmail` | string | ✅ | **[新增]** 处理人邮箱，用于建号或邮件通知 |
| `assigneePhone` | string | ✅ | **[新增]** 处理人手机号，用于建号或短信通知 |
| `assigneeDepartment`| string | ✅ | **[新增]** 处理人部门，用于自动建号归属 |
| `assigneePosition`| string | ✅ | **[新增]** 处理人职位/岗位，用于完善人员信息 |
| `type` | enum | 可选 | 问题类型：`software`/`hardware`/`network`/`security`/`database`/`other` |
| `category1` | string(50) | 可选 | 支持类型（如：远程支持/现场支持） |
| `category2` | string(50) | 可选 | 技术方向（如：存储/网络/数据库） |
| `category3` | string(50) | 可选 | 项目/品牌名称 |

**成功响应 (HTTP 201)：**

```json
{
  "code": 0,
  "message": "工单创建成功",
  "data": {
    "id": 42,
    "ticketNo": "TK202605060001",
    "title": "XX客户存储扩容故障",
    "status": "pending",
    "serviceNo": "SR-2026-05-00123",
    "customerName": "XX科技有限公司",
    "createdAt": "2026-05-06T10:00:00.000Z"
  }
}
```

**错误响应：**

| HTTP 状态码 | code | 说明 |
|------------|------|------|
| 401 | -1 | Token 无效或过期 |
| 400 | -1 | 参数校验失败（缺少必填字段，如没有带上人员名字导致无法建号） |
| 409 | -1 | serviceNo 重复（该工单已推送过） |

### 5.4 查询工单状态

```
GET https://callcenter.trustfar.cn/api/ext/tickets/{serviceNo}
Authorization: Bearer {SERVICE_TOKEN}
```

**响应：**

```json
{
  "code": 0,
  "data": {
    "id": 42,
    "ticketNo": "TK202605060001",
    "serviceNo": "SR-2026-05-00123",
    "status": "in_progress",
    "assignee": { "realName": "张三", "employeeId": "10087" },
    "createdAt": "2026-05-06T10:00:00.000Z",
    "assignedAt": "2026-05-06T10:05:00.000Z"
  }
}
```

### 5.5 工单状态回调（可选）

如 OMM 需接收工单状态变更通知，CallCenter团队可配置 Webhook：

```
POST {OMM提供的回调URL}
Content-Type: application/json
```

```json
{
  "event": "ticket.status_changed",
  "serviceNo": "SR-2026-05-00123",
  "ticketNo": "TK202605060001",
  "oldStatus": "pending",
  "newStatus": "in_progress",
  "assignee": "张三",
  "timestamp": "2026-05-06T10:30:00.000Z"
}
```

### 5.6 工单状态枚举

| 值 | 含义 |
|----|------|
| `pending` | 待接单 |
| `in_progress` | 服务中 |
| `closing` | 待确认关单 |
| `closed` | 已关单 |

---

## 六、系统 API 总览

> 以下为 CallCenter 系统主要 API 路由，所有接口均以 `/api/` 为前缀。

### 6.1 认证接口

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| POST | `/auth/login` | 用户名密码登录 | 无 |
| POST | `/auth/register` | 注册（已关闭，仅系统自动建号） | 无 |
| POST | `/auth/refresh` | 刷新 Token | Cookie |
| POST | `/auth/logout` | 退出登录 | 无 |
| GET | `/auth/me` | 获取当前用户信息 | JWT |
| GET | `/auth/sso/callback` | OAuth2.0 SSO 回调 | 待开发 |
| GET | `/auth/wechat-work/callback` | 企业微信回调 | 待开发 |

### 6.2 工单接口

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| POST | `/tickets` | 创建工单 | tickets:create |
| GET | `/tickets` | 工单列表（分页/筛选） | tickets:read |
| GET | `/tickets/:id` | 工单详情 | tickets:read |
| GET | `/tickets/no/:ticketNo` | 按工单号查询 | tickets:read |
| PUT | `/tickets/:id` | 更新工单 | tickets:read |
| POST | `/tickets/:id/assign` | 接单 | tickets:assign |
| POST | `/tickets/:id/request-close` | 申请关单 | tickets:assign |
| POST | `/tickets/:id/confirm-close` | 确认关单 | tickets:read |
| DELETE | `/tickets/:id` | 删除工单 | tickets:delete |
| POST | `/tickets/:id/share` | 生成分享外链 | tickets:share |
| POST | `/tickets/:id/invite` | 邀请协作者 | tickets:read |

### 6.3 用户接口

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/users` | 用户列表 | admin:access |
| GET | `/users/search?q=` | 搜索用户 | 登录即可 |
| PUT | `/users/me` | 修改个人信息 | 登录即可 |
| PUT | `/users/me/password` | 修改密码 | 登录即可 |
| PUT | `/users/:id/role` | 修改用户角色 | admin:access |
| PUT | `/users/:id/info` | 修改用户信息 | admin:access |
| DELETE | `/users/:id` | 删除用户 | admin:access |

### 6.4 外部对接接口

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| POST | `/ext/tickets` | OMM 推送工单（含遇缺建号） | Service Token |
| GET | `/ext/tickets/:serviceNo` | 查询工单状态 | Service Token |

---

## 七、对接优先级与时间线

| 优先级 | 模块 | 预估工时 | 前置条件 |
|-------|------|---------|---------|
| 🔴 P0 | 域名 + 证书部署 | 0.5 天 | 公司信息部/OMM团队提供域名/证书/DNS |
| 🔴 P0 | OAuth2.0 SSO 登录 | 2-3 天 | 公司信息部/OMM团队提供 Client ID/Secret/URL |
| 🟡 P1 | OMM 工单推送对接 | 2-3 天 | OMM 方按接口规范开发（需包含人员明细） |
| 🟢 P2 | 企业微信 H5 入口 | 1-2 天 | 公司信息部/OMM团队创建企微应用 |

---

## 八、信息交换汇总清单（当前状态）

为了确保对接顺利进行，以下梳理了双方需提供的各项关键资源及当前确认状态：

### 8.1 公司信息部/OMM团队需提供给 CallCenter团队

| 模块 | 信息项 / 资源 | 状态 | 具体内容 / 说明 |
|------|--------------|------|---------------|
| **基础设施** | 服务器资源 (4C8G) | ✅ **已提供** | 内网IP: `172.31.0.22` / 公网IP: `101.251.208.178` |
| **基础设施** | 域名解析 | ✅ **已提供** | 域名: `callcenter.trustfar.cn` |
| **基础设施** | SSL 证书 (.crt/.key) | ⏳ **待提供** | 用于配置 HTTPS 加密访问 |
| **SSO对接** | Client ID | ⏳ **待提供** | 分配给 CallCenter 的应用ID |
| **SSO对接** | Client Secret | ⏳ **待提供** | 与 Client ID 对应的密钥 |
| **SSO对接** | 认证接口 URLs | ⏳ **待提供** | 包含 Authorization、Token、UserInfo 三个完整 URL 地址 |
| **企业微信** | CorpID | ⏳ **待提供** | 企业的唯一标识 |
| **企业微信** | AgentID & Secret | ⏳ **待提供** | 为 CallCenter 创建的自建应用凭证 |
| **企业微信** | 域名验证文件 | ⏳ **待提供** | (按需) `.txt` 文件，用于企微后台配置可信域名时的归属验证 |
| **工单推送** | 最终推送方式确认 | ⏳ **待确定** | 确认采用 **HTTP直推** 还是 **MQ队列**。如选 MQ，需提供连接地址与账密 |

### 8.2 CallCenter团队需提供给公司信息部/OMM团队

| 模块 | 信息项 | 状态 | 具体内容 / 说明 |
|------|-------|------|---------------|
| **SSO对接** | SSO 回调地址 | ✅ **已确定** | `https://callcenter.trustfar.cn/api/auth/sso/callback` (测试/生产共用) |
| **企业微信** | 企微应用首页地址 | ✅ **已确定** | `https://callcenter.trustfar.cn/` |
| **工单推送** | 工单接收 API 接口 | ✅ **已确定** | `POST https://callcenter.trustfar.cn/api/ext/tickets` |
| **工单推送** | 工单状态查询 API | ✅ **已确定** | `GET https://callcenter.trustfar.cn/api/ext/tickets/{serviceNo}` |
| **工单推送** | 数据字段映射规范 | ✅ **已确定** | 已在本文档【第 5 节】中提供包含建号信息的 JSON 规范 |
| **安全认证** | **SERVICE_TOKEN** | ⏳ **待提供** | 供 OMM 调用接口时的鉴权密钥（后端系统开发完成后生成并提供） |

---

## 九、联系方式

如有技术问题，请联系 CallCenter 项目组进行联调沟通。

> 本文档中的接口规范基于系统当前版本，实际对接中可根据双方需求调整。
