# BBS 板块化 + 标签系统 + 版面重构

对现有 BBS 模块进行全面升级，引入"板块"(Section) 和"预设标签"(Preset Tag) 两大核心概念，重构前端版面为左侧边栏 + 右侧内容区的经典论坛布局。

## User Review Required

> [!IMPORTANT]
> **板块管理方式**：当前方案将 5 个初始板块通过数据库 Seed 写入，管理员后续可以在后台管理中增删改板块。请确认是否需要在后台管理增加"板块管理" Tab，还是暂时只通过数据库 Seed 固定？
>
> **板块 URL 策略**：方案采用 `/bbs?section=技术分享` query 参数方式切换板块（不改变路由结构），而非 `/bbs/sections/:id` 嵌套路由。这样实现更简洁且兼容现有路由。请确认。

## Proposed Changes

整体改动按依赖顺序分为 5 个阶段：

---

### Phase 1: 数据库实体 (Backend Entity)

#### [NEW] `backend/src/entities/bbs-section.entity.ts`
新建 **BbsSection** 实体（板块表），字段：
- `id` (PK, auto-increment)
- `name` (varchar 50, unique) — 板块名称，如"技术分享"
- `icon` (varchar 50, nullable) — 板块图标 emoji/icon name
- `description` (varchar 200, nullable) — 板块简介
- `sortOrder` (int, default 0) — 排序权重
- `createdAt` / `updatedAt`

#### [NEW] `backend/src/entities/bbs-tag.entity.ts`
新建 **BbsTag** 实体（预设标签表），字段：
- `id` (PK, auto-increment)
- `name` (varchar 50, unique) — 标签名
- `color` (varchar 20, nullable) — 标签显示颜色
- `createdAt`

#### [MODIFY] `backend/src/entities/post.entity.ts`
在 Post 实体上增加板块关联：
- 新增 `sectionId` 列 (int, nullable，兼容历史数据)
- 新增 `@ManyToOne(() => BbsSection)` 关系
- 保留现有 `tags: string[]` JSON 列（存自由标签 + 预设标签名的混合数组）

#### [MODIFY] `backend/src/entities/index.ts`
导出新增的 `BbsSection` 和 `BbsTag` 实体。

---

### Phase 2: 后端 API (Backend Service / Controller)

#### [MODIFY] `backend/src/modules/bbs/bbs.module.ts`
- 在 `TypeOrmModule.forFeature` 中注册 `BbsSection` 和 `BbsTag` 实体。

#### [MODIFY] `backend/src/modules/bbs/bbs.service.ts`
- 注入 `BbsSection` 和 `BbsTag` 仓库。
- **`findAll()`** 增加 `sectionId` 筛选参数；搜索条件从仅标题模糊扩展为 **标题 + 正文内容** 双字段 `OR` 全文模糊搜索。
- **`create()`** 接收并存储 `sectionId`。
- **`update()`** 支持修改 `sectionId`。
- 新增 `findAllSections()` — 查询所有板块（按 sortOrder 排序）。
- 新增 `createSection()` / `updateSection()` / `removeSection()` — 板块 CRUD。
- 新增 `findAllTags()` — 查询所有预设标签。
- 新增 `createTag()` / `removeTag()` — 预设标签的增删。

#### [MODIFY] `backend/src/modules/bbs/bbs.controller.ts`
新增以下路由（均放在 `posts` 相关路由之前，避免路径冲突）：

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| `GET` | `sections` | `bbs:read` | 获取所有板块列表 |
| `POST` | `sections` | `bbs:edit` | 新增板块（管理员） |
| `PUT` | `sections/:id` | `bbs:edit` | 修改板块 |
| `DELETE` | `sections/:id` | `bbs:delete` | 删除板块 |
| `GET` | `tags` | `bbs:read` | 获取所有预设标签 |
| `POST` | `tags` | `bbs:edit` | 新增预设标签 |
| `DELETE` | `tags/:id` | `bbs:delete` | 删除预设标签 |

- 修改 `GET posts` 增加 `@Query('sectionId')` 参数。
- 修改 `GET posts` 的 search 逻辑传递到 service 层做全文搜索。

#### 数据库 Seed
在 BbsService 的 `onModuleInit` 中，检测 `bbs_sections` 表为空时自动插入 5 个默认板块：
`技术分享`、`Bug反馈`、`新功能建议`、`日常闲聊`、`经验总结`

---

### Phase 3: 前端 API 绑定

#### [MODIFY] `frontend/src/services/api.ts`
在文件末尾新增 `bbsAPI` 导出对象：
```ts
export const bbsAPI = {
  getSections: () => api.get('/bbs/sections'),
  createSection: (data: any) => api.post('/bbs/sections', data),
  updateSection: (id: number, data: any) => api.put(`/bbs/sections/${id}`, data),
  deleteSection: (id: number) => api.delete(`/bbs/sections/${id}`),
  getTags: () => api.get('/bbs/tags'),
  createTag: (data: any) => api.post('/bbs/tags', data),
  deleteTag: (id: number) => api.delete(`/bbs/tags/${id}`),
};
```

---

### Phase 4: 前端版面重构

#### [MODIFY] `frontend/src/pages/BBS/index.tsx` — 核心重构

**布局结构改为三栏式**（灵感来源：经典论坛/Reddit 侧边栏风格）：

```
┌──────────────────────────────────────────────────┐
│ 搜索栏 (全宽，支持全文搜索)      [排序] [管理] [发帖] │
├──────────┬───────────────────────────────────────┤
│ 左侧边栏  │         帖子列表区域                    │
│ ┌──────┐ │  ┌─────────────────────────────────┐  │
│ │ 板块  │ │  │ 帖子标题 | 板块 | 作者 | 时间 | 标签  │  │
│ │ 导航  │ │  │ ...                             │  │
│ │      │ │  │ ...                             │  │
│ ├──────┤ │  └─────────────────────────────────┘  │
│ │ 标签  │ │                                      │
│ │ 筛选  │ │                                      │
│ └──────┘ │                                      │
└──────────┴───────────────────────────────────────┘
```

- **左侧边栏（~200px 固定宽度）**：
  - 上方容器：板块导航列表。第一项为"全部"，点击切换到对应板块筛选。当前激活板块高亮。
  - 下方容器：预设标签云。可点击筛选，已选标签高亮，再点取消。
- **右侧主体**：帖子列表保持现有的紧凑行/卡片双视图。
- **帖子行信息增强**：每行增加显示 `所属板块` 名称标签（带颜色），保留 `作者`、`时间`、`标签` 等。
- **搜索栏**：placeholder 改为"搜索帖子标题和内容..."，后端对应做全文模糊匹配。
- **"全部"视图**：不传 sectionId，按时间倒序展示所有板块的帖子。

#### [MODIFY] `frontend/src/pages/BBS/BbsPostForm.tsx`

- 页面加载时调用 `bbsAPI.getSections()` 和 `bbsAPI.getTags()` 获取板块和预设标签列表。
- 在标题行后方（或标签区域上方）增加 **板块选择器**（Select 单选），如果是从某板块入口进来发帖，则自动预选当前板块。
- 标签选择器从纯自由输入改为 **预设标签下拉 + 自由输入混合模式**（Ant Design `Select mode="tags"` 配合 options 列表）。
- 提交时将 `sectionId` 一并写入 payload。

#### [MODIFY] `frontend/src/pages/BBS/BbsPostDetail.tsx`
- 帖子详情顶部元信息区域增加显示"所属板块"标签。

#### [MODIFY] `frontend/src/pages/BBS/bbs.css`
- 新增左侧边栏相关样式：`.bbs-layout`, `.bbs-sidebar`, `.bbs-sidebar-section`, `.bbs-sidebar-tags`。
- 调整 `.bbs-page` 最大宽度并改为 flex 横向布局。
- 帖子行增加板块 badge 样式。
- 移动端：左侧边栏折叠为顶部横向滚动条。

#### [MODIFY] `frontend/src/App.tsx`
- 路由无需改动（板块通过 query 参数切换，不需要新路由）。

---

### Phase 5: 后台管理标签预设

#### [NEW] `frontend/src/pages/Admin/components/BbsTagManageTab.tsx`
使用与 `CategoryTab` 类似的管理 UI：
- 上方表格列出所有预设标签（名称、颜色、创建时间），支持删除。
- 下方表单：输入标签名 + 选择颜色 → 创建新标签。
- 调用 `bbsAPI.createTag()` / `bbsAPI.deleteTag()`。

#### [MODIFY] `frontend/src/pages/Admin/index.tsx`
- 在 `Tabs` 配置中新增一个 Tab：`🏷️ 论坛标签`，children 渲染 `<BbsTagManageTab />`。

---

## Open Questions

> [!IMPORTANT]
> 1. **板块管理**：是否也需要在后台管理中增加"板块管理" Tab（增删改板块名称/图标/排序），还是暂时只用 Seed 预设的 5 个？
> 2. **历史帖子**：现有帖子 `sectionId` 为空，在"全部"视图中正常展示没问题，但在板块视图下不会显示。是否需要批量迁移旧帖到某个默认板块（如"日常闲聊"）？

## Verification Plan

### Automated Tests
- `npm run build` 前后端无编译错误。
- 远端 `pm2 restart` 后端、`npm run build` 前端后验证生产环境。

### Manual Verification
1. 刷新 `/bbs` 页面，确认左侧边栏渲染 5 个板块 + 标签云。
2. 点击板块切换，确认帖子列表只显示对应板块内容。
3. 点击"全部"，确认按时间展示所有帖子。
4. 在搜索栏输入关键词，验证标题 + 正文的全文模糊搜索。
5. 进入某板块后点击"发新帖"，确认板块自动预选。
6. 发帖时从预设标签列表选择标签，也可自由输入。
7. 帖子列表中每行信息包含：标题、板块名、作者、时间、标签。
8. 后台管理 → 论坛标签 Tab，增删标签后，发帖页面同步更新。
