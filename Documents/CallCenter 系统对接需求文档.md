# CallCenter 系统对接需求文档

> **文档版本：** v1.0  
> **日期：** 2026年5月6日  
> **编制：** CallCenter 项目组  
> **面向：** 公司信息部

---

## 一、文档概述

本文档旨在明确 **CallCenter 工单协作系统** 与公司现有信息系统对接所需的技术信息交换清单。  
对接共涉及以下 **六个模块**：

| # | 对接模块 | 简要说明 |
|---|---------|---------|
| 1 | 统一登录（SSO） | 通过公司统一登录平台（企业微信扫码）登录 CallCenter |
| 2 | 用户信息同步 | 从公司系统获取用户信息，自动创建/更新 CallCenter 账号 |
| 3 | 统一域名与证书 | 使用公司统一域名前缀及 SSL 证书 |
| 4 | 工单系统对接 | OMM系统推送二线工单至 CallCenter |
| 5 | 企业微信网页入口 | 在企业微信工作台添加 CallCenter 入口 |
| 6 | 独立手机 APP 认证 | 独立 APP 通过企业微信实现身份认证 |

---

## 二、各模块对接详情

---

### 模块一：统一登录（SSO / 企业微信扫码登录）

#### 对接方式说明

公司已有 **统一身份认证平台**（`yx.trustfar.cn`），员工通过 **企业微信扫码** 登录后进入统一门户，再从门户进入各子系统（如 OA、EHR、新OMM 等）。

根据 OMM 系统的 URL 参数分析，统一认证平台使用的是 **OAuth 2.0 授权码模式（Authorization Code Flow）**：

```
OMM 示例 URL：
ommnew.trustfar.cn/?client_id=APP014&scope=read&response_type=code&state=null&sessionId=...
```

**已知信息汇总：**

| 信息项 | 已知值 | 来源 |
|-------|-------|------|
| 统一认证平台地址 | `yx.trustfar.cn` | 门户页面 |
| 登录页地址 | `yx.trustfar.cn/portal/login.html` | 扫码登录页 |
| 门户首页地址 | `yx.trustfar.cn/portal/main.html` | 登录后门户 |
| 认证协议 | **OAuth 2.0 授权码模式** | URL 参数 `response_type=code` |
| OMM 应用的 Client ID | `APP014` | OMM 系统 URL 参数 |
| OMM 系统域名 | `ommnew.trustfar.cn` | OMM 系统地址栏 |
| 登录方式 | 企业微信扫码 | 登录页面 |

**CallCenter 接入后的预期登录流程：**

```
                    ┌──────────────────────────────────────────────────────────────────┐
                    │                                                                  │
  ① 用户访问         ② 跳转至统一认证       ③ 企业微信扫码      ④ 携带 code 回调         ⑤ 换取用户信息
  CallCenter   →    yx.trustfar.cn     →     登录成功     →   callcenter.trustfar.cn  →  自动登录
                    /portal/login.html                        /api/auth/sso/callback
                    │                                                                  │
                    └──────────────────────────────────────────────────────────────────┘
```

或者通过 **统一门户入口**：

```
  ① 企业微信扫码登录 → ② 进入门户 yx.trustfar.cn → ③ 点击"CallCenter"应用 → ④ OAuth 自动授权 → ⑤ 进入系统
```

#### 🏢 公司需提供

| # | 信息项 | 说明 | 备注 |
|---|-------|------|------|
| 1 | **为 CallCenter 分配 Client ID** | 类似 OMM 的 `APP014`，为 CallCenter 分配一个新的应用标识 | **核心，必须** |
| 2 | **Client Secret** | 与 Client ID 配对的应用密钥 | **核心，必须** |
| 3 | **授权地址（Authorization URL）** | 用户跳转到的统一认证页面地址（可能是 `yx.trustfar.cn/oauth/authorize` 或类似路径） | 需确认完整路径 |
| 4 | **令牌获取地址（Token URL）** | 用 authorization code 换取 access_token 的接口 | 需确认 |
| 5 | **用户信息获取地址（UserInfo URL）** | 用 access_token 获取当前登录用户信息的接口 | 需确认 |
| 6 | **Scope 范围** | OMM 使用 `scope=read`，CallCenter 需要什么 scope？ | 建议与 OMM 一致 |
| 7 | **回调地址注册** | 将 CallCenter 的回调地址加入白名单 | 见下方 |
| 8 | **用户信息返回字段说明** | UserInfo 接口返回的 JSON 字段列表及含义 | 见下方"需要的字段" |
| 9 | **统一门户中添加入口** | 在 `yx.trustfar.cn` 门户的"办公应用"中添加 CallCenter 入口（类似"新OMM"） | 可选 |
| 10 | **测试账号** | 供对接调试的测试账号 | 建议提供 |

#### 📋 我方需提供

| # | 信息项 | 说明 |
|---|-------|------|
| 1 | **回调地址（Redirect URI）** | `https://callcenter.trustfar.cn/api/auth/sso/callback` |
| 2 | **登录成功后跳转地址** | `https://callcenter.trustfar.cn/` |
| 3 | **应用名称** | "CallCenter" 或 "技术支持中心"（用于门户显示） |
| 4 | **应用图标** | 供统一门户展示的应用图标 |

#### 我方需要的用户信息字段

用户首次通过 SSO 登录时，CallCenter 需自动创建账号，因此需要以下字段：

| 字段 | 是否必须 | 说明 |
|-----|---------|------|
| **唯一标识（userId / 工号）** | ✅ 必须 | 公司系统中的用户唯一 ID，用于关联账号和工单对接中的人员匹配 |
| **真实姓名（realName）** | ✅ 必须 | 系统内显示姓名 |
| **邮箱（email）** | 可选 | 通知用 |
| **手机号（phone）** | 可选 | 通知用 |
| **头像地址（avatar）** | 可选 | 头像 URL |
| **部门（department）** | 可选 | 组织架构归属 |

---

### 模块二：用户信息同步

#### 对接方式说明

除了首次 SSO 登录自动创建账号外，可能还需要 **批量同步** 公司通讯录用户到 CallCenter，以便在创建工单时可以选择指派人。

#### 🏢 公司需提供

| # | 信息项 | 说明 |
|---|-------|------|
| 1 | **通讯录/用户列表接口** | 获取公司全部（或指定部门）用户列表的 API |
| 2 | **接口认证方式** | API Key / OAuth Token / 其他 |
| 3 | **返回数据格式及字段** | JSON 字段说明（同上方"需要的用户信息字段"） |
| 4 | **分页方式** | 如有分页，需说明分页参数 |
| 5 | **增量同步机制** | 是否支持按更新时间增量获取变更用户 |
| 6 | **用户变更通知（可选）** | 是否支持 Webhook，在用户入职/离职/信息变更时主动通知 |

#### 📋 我方需提供

| # | 信息项 | 说明 |
|---|-------|------|
| 1 | **用户创建接口** | `POST /api/auth/register`，可供公司系统主动推送用户 |
| 2 | **Webhook 回调地址（可选）** | 接收用户变更通知的地址 |

---

### 模块三：统一域名与证书

#### 🏢 公司需提供

| # | 信息项 | 说明 |
|---|-------|------|
| 1 | **分配的域名** | 建议：`callcenter.trustfar.cn` 或 `support.trustfar.cn`（待公司确认） |
| 2 | **SSL 证书文件** | `.crt`（或 `.pem`）证书文件 + `.key` 私钥文件 |
| 3 | **证书链文件（如有）** | 中间证书 / CA Bundle |
| 4 | **DNS 解析方式** | CNAME 指向我方服务器？还是 A 记录？ |
| 5 | **是否需要通过公司网关/WAF** | 流量是否经过公司安全网关 |
| 6 | **证书续期方式** | 自动续期还是手动更换，到期提醒机制 |

#### 📋 我方需提供

| # | 信息项 | 说明 |
|---|-------|------|
| 1 | **服务器公网 IP** | 用于 DNS 解析指向（当前：`101.43.59.206`） |
| 2 | **当前使用端口** | HTTP: 80 → HTTPS: 443（标准端口） |
| 3 | **Nginx 配置确认** | 我方将在 Nginx 中配置新域名和证书 |

---

### 模块四：工单系统对接（二线工单推送）

#### 对接方式说明

OMM系统在生成二线支持工单后，将工单信息 **推送至 CallCenter**，CallCenter 自动创建对应工单。

推送流程：
```
OMM系统 → 调用 CallCenter API → CallCenter 自动创建工单 → 返回工单号
```

#### 🏢 公司需提供

| # | 信息项 | 说明 |
|---|-------|------|
| 1 | **推送时机** | 什么条件触发推送（如"工单状态变为二线支持"时） |
| 2 | **推送的数据字段** | 详见下方"推送数据字段映射表" |
| 3 | **回调需求** | CallCenter 处理完成后是否需要回调通知公司系统（如工单状态变更、关单通知等） |
| 4 | **认证方式** | 公司系统调用我方 API 时的认证方式（建议使用 API Key 或 Service Token） |
| 5 | **测试环境** | 是否提供工单系统的测试/沙箱环境 |

#### 推送数据字段映射表

以下是OMM系统需推送的字段与 CallCenter 工单字段的对应关系：

| 公司工单字段 | CallCenter 字段 | 类型 | 是否必须 | 说明 |
|------------|----------------|------|---------|------|
| 服务单号 | `serviceNo` | string(100) | ✅ 必须 | 公司系统中的原始工单号 |
| 工单标题 | `title` | string(200) | ✅ 必须 | 工单标题/问题简述 |
| 问题描述 | `description` | text | ✅ 必须 | 详细问题描述 |
| 客户名称 | `customerName` | string(100) | ✅ 必须 | 终端客户名称 |
| 项目名称 | `category3` | string(50) | 可选 | 映射到 CallCenter 品牌/项目字段 |
| 开单人员（工号） | `creatorUserId` | string | ✅ 必须 | 公司用户工号，系统自动匹配为工单创建人 |
| 二线支持人员（工号） | `assigneeUserId` | string | ✅ 必须 | 公司用户工号，系统自动匹配为工单处理人 |
| 问题类型 | `type` | string | ⏳ 后续 | 后续双方协商配置，初期可不传 |
| 支持类型 | `category1` | string(50) | ⏳ 后续 | 后续双方协商配置，初期可不传 |
| 技术方向 | `category2` | string(50) | ⏳ 后续 | 后续双方协商配置，初期可不传 |

> [!NOTE]
> **关于开单人员和二线支持人员：** 这两个角色都是公司内部员工，推送时请传入公司系统中的 **用户工号**，CallCenter 会根据工号自动匹配已同步的用户账号。因此，**模块二（用户信息同步）需先于工单对接完成**，确保公司用户已存在于 CallCenter 系统中。

> [!TIP]
> **关于问题类型、支持类型、技术方向：** 这些分类字段在 CallCenter 系统内可灵活配置，初期对接时可暂不传入。待系统上线后，双方根据实际业务需求再协商统一分类标准。

#### 📋 我方提供的工单 API 接口

> [!IMPORTANT]
> 以下接口需为公司系统调用新增一个 **服务端认证机制**（API Key 或 Service Token），区别于普通用户的 JWT 登录认证。具体认证方式双方协商确定。

**① 创建工单**

```
POST /api/tickets
Content-Type: application/json
Authorization: Bearer {service_token}
```

请求体示例：
```json
{
  "title": "XX客户存储扩容故障",
  "description": "客户反馈存储扩容后无法识别新磁盘，需二线远程支持...",
  "type": "hardware",
  "serviceNo": "SR-2026-05-00123",
  "customerName": "XX科技有限公司",
  "category1": "远程支持",
  "category2": "存储",
  "category3": "XX项目",
  "assigneeId": 5
}
```

响应示例：
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

**② 查询工单状态（可选，按需开放）**

```
GET /api/tickets/no/{serviceNo}
Authorization: Bearer {service_token}
```

响应示例：
```json
{
  "code": 0,
  "data": {
    "id": 42,
    "ticketNo": "TK202605060001",
    "status": "in_progress",
    "assignee": { "realName": "张三" },
    "createdAt": "2026-05-06T10:00:00.000Z"
  }
}
```

**③ 工单状态回调（可选，如公司系统需要）**

如OMM系统需接收 CallCenter 的状态变更通知，我方可开发 Webhook 回调：

```
POST {公司提供的回调URL}
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

**工单状态枚举值：**

| 状态值 | 含义 |
|-------|------|
| `pending` | 待接单 |
| `in_progress` | 服务中 |
| `closing` | 待确认关单 |
| `closed` | 已关单 |

---

### 模块五：企业微信网页入口

#### 对接方式说明

在企业微信「工作台」中添加 CallCenter 应用入口，员工点击后直接打开系统页面，并自动完成身份认证（免密登录）。

#### 🏢 公司需提供

| # | 信息项 | 说明 |
|---|-------|------|
| 1 | **企业微信管理后台操作** | 在工作台中添加「自建应用」或「网页」类型入口 |
| 2 | **企业 CorpID** | 企业微信企业标识 |
| 3 | **应用 AgentID 和 Secret** | 用于服务端验证 |
| 4 | **可信域名配置** | 将 CallCenter 域名加入企业微信可信域名列表 |
| 5 | **JS-SDK 域名白名单** | 如需使用企微 JS-SDK 功能 |

#### 📋 我方需提供

| # | 信息项 | 说明 |
|---|-------|------|
| 1 | **应用首页地址** | `https://callcenter.trustfar.cn/` |
| 2 | **域名验证文件** | 配合企业微信域名归属验证（如 `WW_verify_xxxx.txt`） |
| 3 | **移动端适配确认** | CallCenter 前端为响应式设计，支持移动端访问 |

---

### 模块六：独立手机 APP（企业微信认证）

#### 对接方式说明

未来将开发独立的 CallCenter 手机 APP（iOS / Android），需在 APP 内集成企业微信认证，实现员工用企业微信身份一键登录。

**APP 登录流程：**

```
  ① 打开 CallCenter APP → ② 点击"企业微信登录" → ③ 跳转企业微信 APP 授权
  → ④ 用户确认授权 → ⑤ 企业微信返回授权码 → ⑥ CallCenter 后端换取用户信息 → ⑦ 登录成功
```

技术实现上有两种方案：

| 方案 | 说明 | 适用场景 |
|-----|------|----------|
| **方案 A：企业微信 SDK** | APP 内集成企业微信 SDK，调起企业微信 APP 完成授权 | 推荐，体验最好 |
| **方案 B：OAuth 网页跳转** | APP 内打开浏览器跳转 `yx.trustfar.cn` 登录，回调返回 APP | 备选，无需集成 SDK |

#### 🏢 公司需提供

| # | 信息项 | 说明 | 备注 |
|---|-------|------|------|
| 1 | **企业 CorpID** | 企业微信企业标识 | 与模块五共用 |
| 2 | **为 APP 创建企业微信应用** | 在企业微信管理后台创建移动应用，获取 AgentID 和 Secret | **核心，必须** |
| 3 | **应用 AgentID 和 Secret** | APP 对应的企业微信应用凭证 | 用于服务端验证 |
| 4 | **企业微信移动应用 Schema** | APP 跳转企业微信授权所需的 URL Scheme 配置 | 方案 A 需要 |
| 5 | **OAuth 回调地址注册** | 将 APP 的回调地址加入白名单 | 方案 B 需要 |
| 6 | **应用签名信息登记** | 在企业微信后台登记 APP 的包名（Android）和 Bundle ID（iOS） | 方案 A 需要 |

#### 📋 我方需提供

| # | 信息项 | 说明 |
|---|-------|------|
| 1 | **APP Bundle ID（iOS）** | 如：`cn.trustfar.callcenter` |
| 2 | **APP 包名（Android）** | 如：`cn.trustfar.callcenter` |
| 3 | **APP 签名（Android）** | 用于企业微信后台登记 |
| 4 | **Universal Links（iOS）** | 用于企业微信回调跳转回 APP |
| 5 | **后端回调接口** | `https://callcenter.trustfar.cn/api/auth/wechat-work/callback` |

> [!NOTE]
> 独立 APP 的企业微信认证与 Web 端的 SSO 登录共用同一套后端用户体系。用户无论从 Web 端还是 APP 端登录，账号和数据完全互通。

---

## 三、总览：双方信息交换清单

### 公司需提供给我方的信息

| 模块 | 关键信息 |
|-----|---------|
| SSO 登录 | Client ID/Secret、授权/令牌/用户信息 URL |
| 用户同步 | 通讯录 API 地址、认证方式、数据格式 |
| 域名证书 | 分配域名、SSL 证书（.crt + .key）、DNS 解析方式 |
| 工单对接 | 推送字段定义、认证方式协商、回调需求、测试环境 |
| 企微入口 | CorpID、AgentID + Secret、可信域名配置 |
| 独立 APP | CorpID、APP 专用 AgentID + Secret、应用签名登记 |

### 我方提供给公司的信息

以下信息已确定，可直接提供：

| 模块 | 信息项 | 具体值 |
|-----|-------|-------|
| SSO 登录 | 回调地址（Redirect URI） | `https://callcenter.trustfar.cn/api/auth/sso/callback` |
| SSO 登录 | 登录成功跳转地址 | `https://callcenter.trustfar.cn/` |
| SSO 登录 | 应用名称 | "CallCenter" 或 "技术支持中心"（待定） |
| SSO 登录 | 应用图标 | 待提供 |
| 域名证书 | 服务器公网 IP | `101.43.59.206` |
| 域名证书 | 使用端口 | 443（HTTPS 标准端口） |
| 企微入口 | 应用首页地址 | `https://callcenter.trustfar.cn/` |
| 企微入口 | 域名验证文件 | 待公司提供验证要求后生成 |
| 工单对接 | 工单创建接口 | `POST https://callcenter.trustfar.cn/api/tickets`（详见模块四） |
| 工单对接 | 工单查询接口 | `GET https://callcenter.trustfar.cn/api/tickets/no/{serviceNo}` |
| 独立 APP | Bundle ID（iOS） | `cn.trustfar.callcenter`（暂定） |
| 独立 APP | 包名（Android） | `cn.trustfar.callcenter`（暂定） |
| 独立 APP | APP 签名 | 待 APP 开发时生成 |
| 独立 APP | 后端回调接口 | `https://callcenter.trustfar.cn/api/auth/wechat-work/callback` |

### 公司侧需配合操作的事项

> [!IMPORTANT]
> 除了提供上述信息外，以下事项需要公司信息部在自身系统中 **实际操作完成**，我方无法代替执行。

| # | 操作事项 | 涉及模块 | 说明 |
|---|---------|---------|------|
| 1 | **DNS 域名解析** | 域名证书 | 将 `callcenter.trustfar.cn` 解析指向我方服务器 IP `101.43.59.206` |
| 2 | **统一门户添加应用入口** | SSO 登录 | 在 `yx.trustfar.cn` 门户的"办公应用"中添加 CallCenter 入口（类似"新OMM"） |
| 3 | **企业微信管理后台配置** | 企微入口 / APP | 创建应用、配置可信域名、登记 APP 签名等 |
| 4 | **OMM 系统推送功能开发** | 工单对接 | 在 OMM 系统中开发调用 CallCenter API 的工单推送逻辑（公司侧开发工作） |
| 5 | **联调测试** | 所有模块 | 双方在测试环境中联合调试，验证各模块数据互通 |

### 对接完成标志

各模块对接成功的验收标准：

| 模块 | ✅ 完成标志 |
|-----|-----------|
| 统一域名与证书 | 通过 `https://callcenter.trustfar.cn` 可正常访问系统 |
| 统一登录（SSO） | 用户通过企业微信扫码可登录 CallCenter，自动创建账号 |
| 用户信息同步 | CallCenter 中可看到公司通讯录用户，可在工单中选择指派 |
| 工单系统对接 | OMM 创建二线工单后，CallCenter 自动收到并生成工单 |
| 企业微信网页入口 | 在企业微信工作台点击入口可直接打开系统（免密登录） |
| 独立手机 APP | APP 内点击"企业微信登录"可完成身份认证并进入系统 |

---

## 四、对接优先级建议

| 优先级 | 模块 | 原因 |
|-------|------|------|
| 🔴 P0 | 统一域名与证书 | 基础设施，其他模块依赖此域名 |
| 🔴 P0 | 统一登录（SSO） | 核心功能，决定用户认证架构 |
| 🟡 P1 | 用户信息同步 | 配合 SSO，确保用户数据完整 |
| 🟡 P1 | 工单系统对接 | 核心业务价值 |
| 🟢 P2 | 企业微信网页入口 | 体验优化，可在 SSO 完成后快速接入 |
| 🟢 P2 | 独立手机 APP | 需先完成 SSO 和域名对接，APP 开发周期较长 |

---

## 五、我方系统技术概况（供参考）

| 项目 | 说明 |
|-----|------|
| **技术栈** | 前端 React + Ant Design，后端 NestJS (Node.js) |
| **数据库** | MySQL 8.0 |
| **认证机制** | JWT (Access Token + Refresh Token) |
| **API 前缀** | 所有接口均以 `/api/` 开头 |
| **部署方式** | Nginx 反向代理 + PM2 进程管理 |
| **通信协议** | REST API (HTTP/HTTPS) + WebSocket (实时消息) |

---

## 六、下一步行动

1. **公司信息部** 确认 SSO 协议类型及各模块的技术方案；
2. **双方** 协商 API 认证方式（API Key / Service Token / OAuth）；
3. **公司信息部** 分配域名、证书，并提供各接口文档及测试环境；
4. **我方** 根据公司提供的信息进行开发适配；
5. **双方** 在测试环境联调验证。

---

> [!NOTE]
> 本文档中的接口示例基于系统当前版本，实际对接过程中可能需根据公司系统的具体情况进行调整和新增开发。如有疑问请随时沟通。
