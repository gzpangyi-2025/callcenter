# CallCenter 中台开放 API 文档

> **版本**：v2.0  
> **更新时间**：2026年5月9日  
> **使用对象**：中台开发人员、业务系统集成研发

本文档详细说明了中台系统与 CallCenter 系统之间的数据同步与事件推送接口规范。

---

## 1. 接口调用说明

### 1.1 基础请求地址
- **测试环境（公网联调 IP）**：`http://101.251.208.178` 或 `https://101.251.208.178`
- **生产环境（首选，支持 HTTPS 域名接入）**：`https://callcenter.trustfar.cn`
- **生产环境（内网直连，仅限 HTTP）**：`http://172.31.0.22:3000`
*(注：当前处于联调测试阶段未绑定域名时，外部测试系统请统一使用**测试环境公网联调 IP** 进行 HTTP 请求调用)*

**URL 拼接规则：**
实际请求的完整 URL = `基础请求地址` + `接口地址`。

**1. 联调测试阶段使用公网 IP 接入时的完整地址示例（已强制 HTTPS）：**
- **人员同步接口**：`https://101.251.208.178/api/ext/users/sync`
- **工单推送接口**：`https://101.251.208.178/api/ext/tickets`
*(注：通过公网 IP 访问 HTTPS 接口时，由于证书是绑定在域名上的，测试工具或代码中如遇 SSL 证书校验不通过的错误，请配置忽略证书校验，例如 `curl -k` 或在代码 HTTP 客户端中关闭 `verify SSL`)*

**2. 生产环境正式上线后使用域名接入时的完整地址示例：**
- **人员同步接口**：`https://callcenter.trustfar.cn/api/ext/users/sync`
- **工单推送接口**：`https://callcenter.trustfar.cn/api/ext/tickets`

### 1.2 鉴权机制与 Headers 设置
所有开放接口必须使用 `Service Token` 进行鉴权，且请求体必须指定为 JSON 格式。发起 HTTP 请求时，必须携带以下两个 Headers 字段：

```http
Content-Type: application/json
Authorization: Bearer 1c43f8a0ea1b72b4511d42c584e977e5cea21ba0cce67fcea7a65c079954011d
```
> **安全警示：** 上述 `SERVICE_TOKEN` 为生产环境高权限凭证，具备越权读写能力，请务必在服务端代码中发起请求，**严禁**硬编码在任何客户端应用或前端页面中。

### 1.3 数据格式
- 所有接口的返回格式均为 JSON。成功时返回状态码 HTTP 200/201，并在返回体中包含 `code: 0`。

---

## 2. 接口列表

### 2.1 组织架构与人员同步接口

#### 2.1.1 接口描述
提供给中台系统，用于批量创建或更新员工账号。如果员工信息在 CallCenter 已存在（通过 `employeeId` 判定），则执行更新操作；如果不存在，则新增本地账号，并根据邮箱前缀自动分配登录用户名。由于 SSO 登录已取消静默建号，此接口是向 CallCenter 系统导入新员工的主要途径。

#### 2.1.2 接口地址
`POST /api/ext/users/sync`

#### 2.1.3 请求参数

本接口接收一个 JSON 数组，数组内的每个对象包含以下字段。**为保证系统数据完整性，目前以下所有字段均为必填项**：

| 参数名 | 类型 | 必填 | 描述 | 示例值 |
| :--- | :--- | :--- | :--- | :--- |
| `employeeId` | String | 是 | 员工工号（唯一标识） | `"10086"` |
| `realName` | String | 是 | 员工真实姓名 | `"张三"` |
| `email` | String | 是 | 员工邮箱（首选作为用户名生成来源） | `"zhangsan@trustfar.cn"` |
| `phone` | String | 是 | 手机号码 | `"13800138000"` |
| `department` | String | 是 | 所属部门 | `"研发中心"` |
| `position` | String | 是 | 岗位职位 | `"高级后端工程师"` |
| `isActive` | Number | 是 | 账号状态：`1` 为启用，`0` 为禁用。 | `1` |

#### 2.1.4 请求示例

```json
[
  {
    "employeeId": "TEST_001",
    "realName": "测试员工A",
    "email": "testA@trustfar.cn",
    "phone": "13800138001",
    "department": "技术支持部",
    "position": "一线客服",
    "isActive": 1
  },
  {
    "employeeId": "TEST_002",
    "realName": "测试员工B",
    "email": "testB@trustfar.cn",
    "phone": "13912345678",
    "department": "技术支持部",
    "position": "二线研发",
    "isActive": 0
  }
]
```

#### 2.1.5 返回参数

| 参数名 | 类型 | 描述 |
| :--- | :--- | :--- |
| `code` | Number | 状态码，`0` 表示成功 |
| `message` | String | 提示信息 |
| `data.total` | Number | 接收到的数据总条数 |
| `data.inserted` | Number | 成功新增的用户数 |
| `data.updated` | Number | 成功更新的用户数 |

#### 2.1.6 返回示例

```json
{
  "code": 0,
  "message": "同步成功",
  "data": {
    "total": 2,
    "inserted": 1,
    "updated": 1
  }
}
```

---

### 2.2 业务工单推送接口

#### 2.2.1 接口描述
当中台系统或 OMM 派发工单时，调用此接口将工单推送到 CallCenter。系统将自动分配服务流，分配接单人，并触发内部的消息和红点通知。默认首次成功推送的工单状态为 `in_progress`（服务中）。如果推送已存在的工单，系统会根据传入的 `status` 字段动态更新本地工单状态（如：关单、重开等）。

#### 2.2.2 接口地址
`POST /api/ext/tickets`

#### 2.2.3 请求参数

| 参数名 | 类型 | 必填 | 描述 | 示例值 |
| :--- | :--- | :--- | :--- | :--- |
| `title` | String | 是 | 工单标题 | `"XX客户机房网络中断故障"` |
| `description` | String | 是 | 详细故障描述（支持多行或Markdown） | `"客户反馈核心交换机宕机，请尽快排查。"` |
| `serviceNo` | String | 是 | 中台/OMM系统的原始业务单号（防重主键） | `"SR-2026-0509-001"` |
| `customerName` | String | 是 | 关联的最终客户名称 | `"XX科技有限公司"` |
| `creatorEmployeeId` | String | 是 | 建单人/派单人的员工工号 | `"10086"` |
| `assigneeEmployeeId` | String | 是 | 指定二线接单支持人员的工号 | `"TEST_001"` |
| `type` | String | 否 | 工单类型（预设枚举值） | `"network"`/`hardware`/`software` |
| `category1` | String | 否 | 第一级分类 | `"远程支持"` |
| `category2` | String | 否 | 第二级分类 | `"网络"` |
| `category3` | String | 否 | 第三级分类 | `"故障排查"` |
| `status` | String | 否 | 状态同步。首次建单时会被系统强制置为服务中；后续推送支持同步状态更新。合法值：`pending`/`in_progress`/`closing`/`closed` | `"closed"` |

> **注意：** `creatorEmployeeId` 和 `assigneeEmployeeId` 在 CallCenter 中必须已存在，否则请求将被阻断。必须先调用【人员同步接口】后再派单。

#### 2.2.4 请求示例

```json
{
  "title": "测试工单推送集成",
  "description": "这是从外部系统推送到呼叫中心二线的工单内容。",
  "serviceNo": "API-TEST-999123",
  "customerName": "VIP大客户",
  "creatorEmployeeId": "TEST_001",
  "assigneeEmployeeId": "TEST_001",
  "type": "software",
  "category1": "远程测试",
  "status": "in_progress"
}
```

#### 2.2.5 返回参数

| 参数名 | 类型 | 描述 |
| :--- | :--- | :--- |
| `code` | Number | 状态码，`0` 表示成功 |
| `message` | String | 提示信息 |
| `data.id` | Number | CallCenter 系统内部工单的主键 ID |
| `data.ticketNo` | String | 自动生成的具有阅读语义的工单号（例：TK20260509001） |
| `data.status` | String | 初始状态，一般默认为 `in_progress`（服务中） |
| `data.serviceNo` | String | 映射回中台的原业务单号 |
| `data.createdAt` | String | 创建时间 (ISO-8601格式) |
| `data.updated` | Boolean | 是否为更新操作 |

#### 2.2.6 返回示例

> **注：本接口采用 Upsert（有则更新，无则新增）逻辑。**
> 如果中台重复推送了相同的 `serviceNo`，系统**不会报错**，而是会自动更新该工单最新的标题、描述、指派人等信息，并在响应中返回 `"updated": true`。

```json
{
  "code": 0,
  "message": "工单创建或更新成功",
  "data": {
    "id": 142,
    "ticketNo": "TK202605096538",
    "title": "测试工单推送集成",
    "status": "in_progress",
    "serviceNo": "API-TEST-999123",
    "customerName": "VIP大客户",
    "createdAt": "2026-05-09T05:22:15.123Z",
    "updated": false
  }
}
```

---

## 3. 全局错误码与排查指南

系统使用 HTTP 原生状态码表示响应结果，具体的业务错误信息将在 response body 的 `message` 字段中透出。

| HTTP 状态码 | 业务说明 | 常见原因与排查方案 |
| :--- | :--- | :--- |
| **400 Bad Request** | 参数校验失败 | - 漏传了 `IsNotEmpty()` 标记的必填字段。<br>- 派单接口中传递的 `creatorEmployeeId` 或 `assigneeEmployeeId` 在系统中查无此人。请先执行人员同步。 |
| **401 Unauthorized** | 鉴权被拒绝 | - Header 中未携带 `Authorization`。<br>- 携带的 `SERVICE_TOKEN` 格式错误或已失效。 |
| **403 Forbidden** | 权限越界 | - Token 无效或服务 IP 被限制。 |
| **500 Internal Error**| 内部服务器错误 | - 数据库宕机或网络连接池打满，请联系运维团队查看 PM2 报错日志。 |
