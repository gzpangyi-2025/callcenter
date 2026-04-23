# 日志审计功能实现计划

为后台管理增加完整的日志审计模块，涵盖工单状态变更、内部用户登录、外部用户登录三种审计类型，并支持审计开关控制、多条件筛选、时间范围筛选和批量删除。

## Proposed Changes

### 后端 - 审计日志实体层

#### [NEW] [audit-log.entity.ts](file:///Users/yipang/Documents/code/callcenter/backend/src/entities/audit-log.entity.ts)
新建审计日志实体，字段包括：
- `id` (自增主键)
- `type` (枚举: `ticket_status` | `user_login` | `external_login`)
- `action` (具体动作: `created` / `assigned` / `requestClose` / `closed` / `deleted` / `batchDeleted` / `login` / `login_failed` / `external_login`)
- `userId` (操作人ID，外部用户为 null)
- `username` (操作人用户名，便于查询)
- `targetId` (目标ID，如工单ID)
- `targetName` (目标名称，如工单编号)
- `detail` (JSON 格式详细信息，如「状态从 pending 变为 in_progress」)
- `ip` (客户端IP)
- `createdAt` (时间戳)

#### [MODIFY] [index.ts](file:///Users/yipang/Documents/code/callcenter/backend/src/entities/index.ts)
导出新的 `AuditLog` 实体。

---

### 后端 - 审计日志模块

#### [NEW] audit 模块目录 `backend/src/modules/audit/`

- **audit.module.ts** — 注册 TypeORM 实体和 Service/Controller
- **audit.service.ts** — 核心审计逻辑：
  - `log(type, action, detail)` — 写入审计记录（内部先检查该类型的审计开关是否开启）
  - `findAll(query)` — 分页、筛选、时间范围查询
  - `batchDelete(filter)` — 按时间范围 + 类型批量删除
  - `getSettings()` / `updateSettings()` — 读写审计开关（存储在 system_settings 表，key 为 `audit.ticket_status` / `audit.user_login` / `audit.external_login`，值为 `true`/`false`）
- **audit.controller.ts** — REST 端点：
  - `GET /audit/logs` — 查询审计日志（分页、筛选）
  - `DELETE /audit/logs` — 批量删除（按时间范围）
  - `GET /audit/settings` — 获取审计开关状态
  - `PUT /audit/settings` — 更新审计开关

---

### 后端 - 审计埋点（在现有业务代码中注入审计记录）

#### [MODIFY] [auth.service.ts](file:///Users/yipang/Documents/code/callcenter/backend/src/modules/auth/auth.service.ts)
- 在 `login()` 成功/失败时调用 `auditService.log('user_login', ...)`
- 在 `externalLogin()` 成功时调用 `auditService.log('external_login', ...)`

#### [MODIFY] [auth.module.ts](file:///Users/yipang/Documents/code/callcenter/backend/src/modules/auth/auth.module.ts)
- 导入 `AuditModule` 以注入 `AuditService`

#### [MODIFY] [tickets.service.ts](file:///Users/yipang/Documents/code/callcenter/backend/src/modules/tickets/tickets.service.ts)
- 在 `create()` / `assign()` / `requestClose()` / `confirmClose()` 中调用 `auditService.log('ticket_status', ...)`
- 在 `deleteTicket()` 和 `batchDelete()` 中调用 `auditService.log('ticket_status', 'deleted' / 'batchDeleted', ...)`，记录被删除的工单编号、标题和操作人

#### [MODIFY] [tickets.module.ts](file:///Users/yipang/Documents/code/callcenter/backend/src/modules/tickets/tickets.module.ts)
- 导入 `AuditModule` 以注入 `AuditService`

#### [MODIFY] [app.module.ts](file:///Users/yipang/Documents/code/callcenter/backend/src/app.module.ts)
- 注册 `AuditLog` 实体和 `AuditModule`

---

### 前端 - API 层

#### [MODIFY] [api.ts](file:///Users/yipang/Documents/code/callcenter/frontend/src/services/api.ts)
新增 `auditAPI` 对象：
- `getLogs(params)` — 查询审计日志
- `deleteLogs(params)` — 批量删除
- `getSettings()` — 获取开关状态
- `updateSettings(data)` — 更新开关

---

### 前端 - 审计日志 Tab

#### [NEW] [AuditLogTab.tsx](file:///Users/yipang/Documents/code/callcenter/frontend/src/pages/Admin/components/AuditLogTab.tsx)
新建审计日志组件，包含：
- **顶部开关区**：三个 Switch 对应工单状态/用户登录/外部登录的审计开关
- **筛选栏**：类型下拉 + 关键词搜索 + 时间范围选择器（DateRangePicker）
- **表格**：显示时间、类型标签、动作、操作人、目标、详情、IP
- **批量删除**：选中时间范围后弹出确认框执行批量删除

#### [MODIFY] [index.tsx](file:///Users/yipang/Documents/code/callcenter/frontend/src/pages/Admin/index.tsx)
- 在 Tabs items 中新增「📋 日志审计」Tab，渲染 `<AuditLogTab />`
- 新增导入 `AuditLogTab` 和图标 `AuditOutlined`

---

## Verification Plan

### Automated Tests
- `npm run build` 后端和前端均无编译错误
- 部署后访问管理页面确认新 Tab 正常渲染

### Manual Verification
1. 切换三个审计开关，确认保存/读取正确
2. 执行登录操作，确认审计日志出现内部登录记录
3. 外部链接登录，确认出现外部登录记录
4. 创建工单、接单、申请关单、确认关单，确认工单状态变更记录完整
5. 删除单个工单和批量删除工单，确认审计日志记录了被删除的工单信息
6. 使用筛选条件和时间范围筛选，确认数据正确
7. 选择时间范围批量删除审计日志，确认数据被清除
