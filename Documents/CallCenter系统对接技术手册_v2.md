# CallCenter 系统对接技术手册

> **版本：** v2.0 | **日期：** 2026年5月6日 | **编制：** CallCenter 项目组  
> **面向：** 公司信息部、OMM系统开发人员、OAuth2.0对接开发人员

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
| 3306 | MySQL（仅本机监听） | 本机 |
| 6379 | Redis（仅本机监听） | 本机 |
| 9200 | Elasticsearch（仅本机监听） | 本机 |

### 1.3 域名与证书需求

| 项目 | 说明 |
|------|------|
| 域名 | `callcenter.trustfar.cn` |
| SSL 证书 | 公司提供 `.crt`/`.pem` + `.key` 文件 |
| DNS 解析 | A 记录指向服务器公网 IP |

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

### 3.3 公司需提供

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

### 3.4 我方需要的用户信息字段

| 字段 | 必须 | 说明 |
|------|------|------|
| userId / 工号 | ✅ | 唯一标识，用于关联用户和工单对接 |
| realName | ✅ | 系统内显示姓名 |
| email | 可选 | 通知 |
| phone | 可选 | 通知 |
| avatar | 可选 | 头像 URL |
| department | 可选 | 组织架构 |

### 3.5 我方提供

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

### 4.3 公司需提供

| # | 信息项 | 说明 |
|---|-------|------|
| 1 | 企业 CorpID | 企业微信企业标识 |
| 2 | 应用 AgentID + Secret | 自建应用凭证 |
| 3 | 可信域名配置 | 将 `callcenter.trustfar.cn` 加入可信域名 |
| 4 | JS-SDK 域名白名单 | 如需使用企微 JS-SDK |

### 4.4 我方需提供

| 信息项 | 值 |
|-------|-----|
| 应用首页地址 | `https://callcenter.trustfar.cn/` |
| 域名验证文件 | 配合域名归属验证 |
| 后端回调接口 | `https://callcenter.trustfar.cn/api/auth/wechat-work/callback` |



---

## 五、用户与组织架构同步

### 5.1 同步方式

两个数据来源，都通过公司**系统中台**获取：

| 来源 | 场景 | 说明 |
|------|------|------|
| OAuth2.0 / 企业微信登录 | 首次登录 | 自动创建用户，从 UserInfo 接口获取 |
| 系统中台通讯录 API | 批量同步 | 定时拉取全量用户和部门 |

### 5.2 公司需提供

| # | 信息项 | 说明 |
|---|-------|------|
| 1 | 系统中台通讯录 API 地址 | 获取用户列表/部门列表 |
| 2 | API 认证方式 | API Key / OAuth Token |
| 3 | 返回数据字段说明 | userId, realName, department 等 |
| 4 | 增量同步支持 | 是否支持按更新时间增量获取 |

### 5.3 关闭注册

SSO 上线后，我方将：
1. **关闭前端注册入口**（隐藏注册页面）
2. **后端 `POST /api/auth/register` 接口增加管理员权限校验**，仅管理员或系统中台 Service Token 可创建用户
3. 所有用户通过 SSO 首次登录自动创建，或由管理员在后台手动创建

---

## 六、OMM 工单推送接口规范

### 6.1 对接原则

- OMM 系统**主动推送**二线工单至 CallCenter
- CallCenter 被动接收，**不主动拉取**
- 认证方式：**Service Token**（我方分配长期有效的 API 密钥）

### 6.2 接口认证

所有 OMM 系统调用的接口均需在 HTTP Header 中携带：

```
Authorization: Bearer {SERVICE_TOKEN}
```

`SERVICE_TOKEN` 由 CallCenter 管理员生成并提供给 OMM 开发方。

### 6.3 创建工单

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
  "assigneeEmployeeId": "10087",
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
| `creatorEmployeeId` | string | ✅ | 开单人员工号（系统自动匹配用户） |
| `assigneeEmployeeId` | string | ✅ | 二线支持人员工号（系统自动匹配用户） |
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
| 400 | -1 | 参数校验失败（缺少必填字段） |
| 409 | -1 | serviceNo 重复（该工单已推送过） |
| 404 | -1 | 员工工号未找到匹配用户 |

### 6.4 查询工单状态

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

### 6.5 工单状态回调（可选）

如 OMM 需接收工单状态变更通知，我方可配置 Webhook：

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

### 6.6 工单状态枚举

| 值 | 含义 |
|----|------|
| `pending` | 待接单 |
| `in_progress` | 服务中 |
| `closing` | 待确认关单 |
| `closed` | 已关单 |

---

## 七、系统 API 总览

> 以下为 CallCenter 系统主要 API 路由，所有接口均以 `/api/` 为前缀。

### 7.1 认证接口

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| POST | `/auth/login` | 用户名密码登录 | 无 |
| POST | `/auth/register` | 注册（后续关闭） | 无 |
| POST | `/auth/refresh` | 刷新 Token | Cookie |
| POST | `/auth/logout` | 退出登录 | 无 |
| GET | `/auth/me` | 获取当前用户信息 | JWT |
| GET | `/auth/sso/callback` | OAuth2.0 SSO 回调 | 待开发 |
| GET | `/auth/wechat-work/callback` | 企业微信回调 | 待开发 |

### 7.2 工单接口

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

### 7.3 用户接口

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/users` | 用户列表 | admin:access |
| GET | `/users/search?q=` | 搜索用户 | 登录即可 |
| PUT | `/users/me` | 修改个人信息 | 登录即可 |
| PUT | `/users/me/password` | 修改密码 | 登录即可 |
| PUT | `/users/:id/role` | 修改用户角色 | admin:access |
| PUT | `/users/:id/info` | 修改用户信息 | admin:access |
| DELETE | `/users/:id` | 删除用户 | admin:access |

### 7.4 外部对接接口（待开发）

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| POST | `/ext/tickets` | OMM 推送工单 | Service Token |
| GET | `/ext/tickets/:serviceNo` | 查询工单状态 | Service Token |
| POST | `/ext/users/sync` | 批量同步用户 | Service Token |

---

## 八、对接优先级与时间线

| 优先级 | 模块 | 预估工时 | 前置条件 |
|-------|------|---------|---------|
| 🔴 P0 | 域名 + 证书部署 | 0.5 天 | 公司提供域名/证书/DNS |
| 🔴 P0 | OAuth2.0 SSO 登录 | 2-3 天 | 公司提供 Client ID/Secret/URL |
| 🟡 P1 | 用户组织架构同步 | 1-2 天 | 系统中台 API 文档 |
| 🟡 P1 | OMM 工单推送对接 | 2-3 天 | OMM 方按接口规范开发 |
| 🟡 P1 | 关闭注册功能 | 0.5 天 | SSO 上线后 |
| 🟢 P2 | 企业微信 H5 入口 | 1-2 天 | 公司创建企微应用 |

---

## 九、信息交换汇总

### 公司需提供

| 模块 | 关键信息 |
|------|---------|
| 基础设施 | 服务器（4C8G 100G）、域名、SSL 证书 |
| SSO 登录 | Client ID/Secret、Authorization/Token/UserInfo URL |
| 企业微信 | CorpID、AgentID + Secret、可信域名配置 |
| 用户同步 | 系统中台通讯录 API 地址、认证方式、字段文档 |
| 工单对接 | 确认推送字段映射、回调需求、测试环境 |

### 我方提供

| 模块 | 信息项 | 值 |
|------|-------|-----|
| SSO | 回调地址 | `https://callcenter.trustfar.cn/api/auth/sso/callback` |
| 域名 | 服务器 IP | 待公司分配服务器后确定 |
| 工单 | 推送接口 | `POST https://callcenter.trustfar.cn/api/ext/tickets` |
| 工单 | 查询接口 | `GET https://callcenter.trustfar.cn/api/ext/tickets/{serviceNo}` |
| 企微 | 应用首页 | `https://callcenter.trustfar.cn/` |

---

## 十、联系方式

如有技术问题，请联系 CallCenter 项目组进行联调沟通。

> 本文档中的接口规范基于系统当前版本，实际对接中可根据双方需求调整。
