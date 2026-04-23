# Elasticsearch 全文搜索集成 — 详细实施方案

## 环境现状分析

### 远程服务器 (192.168.50.51 — CentOS)

| 项目 | 值 |
|------|-----|
| ES 版本 | **8.19.14**（最新稳定版） |
| 运行状态 | ✅ 已运行 3 天，systemd 管理 |
| 安全模式 | xpack.security = **true**，HTTPS + 认证 |
| JVM 堆 | 3772 MB（偏大，建议降到 1 GB） |
| 数据目录 | `/var/lib/elasticsearch`（312 KB，空） |
| 磁盘 `/var` | 25 GB 中剩余 **18 GB**（充足） |
| IK 分词器 | ❌ **未安装** |
| elastic 密码 | ❓ 未知，需重置 |
| 插件 | 无自定义插件 |

### 本地环境 (macOS — Homebrew)

| 项目 | 值 |
|------|-----|
| ES 版本 | **7.17.4**（Homebrew tap 安装） |
| 运行状态 | ❌ **未运行**（brew services 未启动） |
| 安全模式 | 关闭（无 xpack.security 配置） |
| 集群名 | `elasticsearch_yipang` |
| 数据目录 | `/opt/homebrew/var/lib/elasticsearch/`（0 B，空） |
| 磁盘 | 926 GB 中剩余 **472 GB**（充足） |
| IK 分词器 | ❌ **未安装** |
| 插件 | 无 |

### 版本差异影响

> [!WARNING]
> 本地 ES **7.17.4** 与远程 ES **8.19.14** 版本差距较大（跨大版本）。
> - ES 7.x 和 8.x 的 REST API **基本兼容**（`_search`, `_bulk`, `_analyze` 等核心 API 不变）
> - 主要差异在安全配置：ES 8.x 默认强制 HTTPS + 认证，ES 7.x 默认关闭
> - **NestJS `@elastic/elasticsearch` 客户端 8.x 可以向下兼容 7.x**
> - IK 分词器版本需要严格匹配 ES 版本

**结论：版本差异不影响业务代码，只需在连接配置中区分本地/远程参数即可。**

---

## User Review Required

> [!IMPORTANT]
> **ES 8 密码重置**：远程服务器的 `elastic` 用户密码未知，需要执行 `elasticsearch-reset-password` 重置。重置后新密码将写入后端 `.env` 文件。是否同意执行？

> [!IMPORTANT]
> **本地 ES 版本**：本地是 7.17.4，远程是 8.19.14。两种处理方式：
> 1. **保持现状**：代码兼容两个版本，本地开发用 7.x，远程用 8.x（推荐，简单）
> 2. **升级本地到 8.x**：`brew uninstall elasticsearch-full && brew install elastic/tap/elasticsearch-full`
>
> 建议选择方案 1，省事且不影响功能。

---

## Proposed Changes

### Phase 1: 环境配置（远程 + 本地）

#### 远程服务器配置

1. **重置 elastic 密码**
```bash
/usr/share/elasticsearch/bin/elasticsearch-reset-password -u elastic --batch
```

2. **安装 IK 分词器**（版本需严格匹配 8.19.14）
```bash
/usr/share/elasticsearch/bin/elasticsearch-plugin install \
  https://get.infini.cloud/elasticsearch/analysis-ik/8.19.14
systemctl restart elasticsearch
```

3. **优化 JVM 内存**（从 3.7 GB 降到 1 GB）
```bash
# /etc/elasticsearch/jvm.options.d/custom.options
-Xms1g
-Xmx1g
```

4. **验证 ES 可用**
```bash
curl -sk -u elastic:<password> https://localhost:9200
curl -sk -u elastic:<password> https://localhost:9200/_analyze -H 'Content-Type: application/json' \
  -d '{"analyzer":"ik_smart","text":"远程桌面连接失败"}'
```

#### 本地环境配置

1. **启动 ES 服务**
```bash
brew services start elastic/tap/elasticsearch-full
```

2. **安装 IK 分词器**（版本匹配 7.17.4）
```bash
elasticsearch-plugin install \
  https://get.infini.cloud/elasticsearch/analysis-ik/7.17.4
brew services restart elastic/tap/elasticsearch-full
```

3. **验证**
```bash
curl http://localhost:9200
curl http://localhost:9200/_analyze -H 'Content-Type: application/json' \
  -d '{"analyzer":"ik_smart","text":"远程桌面连接失败"}'
```

---

### Phase 2: 后端 SearchModule

#### [NEW] `backend/src/modules/search/search.module.ts`
NestJS 搜索模块，注册 `ElasticsearchModule`：
- 从 `.env` 读取 ES 连接参数（`ES_NODE`, `ES_USERNAME`, `ES_PASSWORD`, `ES_TLS_REJECT_UNAUTHORIZED`）
- 本地默认 `http://localhost:9200` 无认证
- 远程 `https://localhost:9200` + basic auth

#### [NEW] `backend/src/modules/search/search.service.ts`
核心服务，提供以下方法：

| 方法 | 说明 |
|------|------|
| `onModuleInit()` | 启动时自动创建/检查 `callcenter-posts` 和 `callcenter-tickets` 索引，设置 IK 分词 mapping |
| `indexPost(post)` | 将帖子索引到 ES（创建/更新时调用） |
| `removePost(id)` | 从 ES 删除帖子索引 |
| `indexTicket(ticket)` | 将工单索引到 ES |
| `removeTicket(id)` | 从 ES 删除工单索引 |
| `search(query, options)` | **统一搜索入口**：跨索引搜索，返回结果 + 高亮 + 聚合 |
| `syncAll()` | 全量同步：从 MySQL 读取所有帖子/工单，批量写入 ES |

**索引 Mapping 设计（`callcenter-posts`）**：
```json
{
  "mappings": {
    "properties": {
      "title":       { "type": "text", "analyzer": "ik_max_word", "search_analyzer": "ik_smart" },
      "content":     { "type": "text", "analyzer": "ik_max_word", "search_analyzer": "ik_smart" },
      "tags":        { "type": "keyword" },
      "sectionId":   { "type": "integer" },
      "sectionName": { "type": "keyword" },
      "authorName":  { "type": "keyword" },
      "authorId":    { "type": "integer" },
      "createdAt":   { "type": "date" },
      "viewCount":   { "type": "integer" },
      "isPinned":    { "type": "boolean" },
      "isArchived":  { "type": "boolean" }
    }
  }
}
```

#### [NEW] `backend/src/modules/search/search.controller.ts`

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| `GET` | `/search` | `bbs:read` | 统一搜索接口，query 参数：`q`(关键词)、`type`(post/ticket/all)、`page`、`pageSize` |
| `POST` | `/search/sync` | `admin:access` | 管理员手动触发全量同步 |

返回格式：
```json
{
  "total": 15,
  "items": [
    {
      "id": 42,
      "type": "post",
      "title": "远程<em>桌面</em><em>连接</em>配置指南",
      "highlight": "...当<em>远程桌面连接失败</em>时，请检查...",
      "sectionName": "技术分享",
      "authorName": "管理员",
      "createdAt": "2026-04-20T08:00:00Z",
      "score": 12.5
    }
  ],
  "aggregations": {
    "sections": [{ "key": "技术分享", "count": 8 }, { "key": "Bug反馈", "count": 7 }],
    "tags": [{ "key": "远程", "count": 5 }]
  }
}
```

---

### Phase 3: 数据同步钩子

#### [MODIFY] `backend/src/modules/bbs/bbs.service.ts`
在帖子的 `create()`、`update()`、`remove()`、`batchRemove()`、`migrateToSection()` 方法中，**异步调用** `searchService.indexPost()` / `searchService.removePost()` 进行增量同步。使用 `try/catch` 包裹，ES 操作失败不阻塞主流程。

#### [MODIFY] `backend/src/modules/bbs/bbs.module.ts`
imports 中添加 `SearchModule`。

#### [MODIFY] `backend/src/modules/bbs/bbs.service.ts` （搜索逻辑替换）
当 `search` 参数存在时，先调用 `searchService.search()` 获取匹配的 post IDs，再用 IDs 从 MySQL 查出完整数据（带 relations），返回时附上 ES 的高亮片段。

---

### Phase 4: 前端搜索增强

#### [MODIFY] `frontend/src/services/api.ts`
新增搜索 API：
```ts
export const searchAPI = {
  search: (params: { q: string; type?: string; page?: number; pageSize?: number }) =>
    api.get('/search', { params }),
};
```

#### [MODIFY] `frontend/src/pages/BBS/index.tsx`
- 搜索框输入后调用 `searchAPI.search()` 替代当前的 `api.get('/bbs/posts', { search })`
- 搜索结果中帖子标题和摘要支持 **HTML 高亮渲染**（`dangerouslySetInnerHTML` + 样式 `em { color: var(--primary); font-style: normal; font-weight: 600; }`）
- 搜索时右侧/下方展示聚合 facets（按板块/标签统计命中数）

#### [MODIFY] `frontend/src/pages/BBS/bbs.css`
新增搜索高亮样式：
```css
.bbs-highlight em {
  color: var(--primary, #4f46e5);
  font-style: normal;
  font-weight: 600;
  background: rgba(79, 70, 229, 0.08);
  padding: 0 2px;
  border-radius: 2px;
}
```

---

### Phase 5: 后台管理 — ES 管理面板

#### [MODIFY] `frontend/src/pages/Admin/components/BbsManageTab.tsx`
在现有的"板块管理 / 标签管理 / 帖子迁移"子 Tab 中新增第 4 个：**🔍 搜索引擎**
- 显示 ES 连接状态（绿/红灯）
- 显示当前索引文档数
- 「全量同步」按钮：调用 `POST /search/sync` 重建索引
- 同步进度条

---

### Phase 6: 环境变量配置

#### [MODIFY] `backend/.env`（远程）
```env
# Elasticsearch
ES_NODE=https://localhost:9200
ES_USERNAME=elastic
ES_PASSWORD=<重置后的密码>
ES_TLS_REJECT_UNAUTHORIZED=false
```

#### [MODIFY] `backend/.env`（本地）
```env
# Elasticsearch
ES_NODE=http://localhost:9200
ES_USERNAME=
ES_PASSWORD=
ES_TLS_REJECT_UNAUTHORIZED=true
```

---

## 后端依赖安装

```bash
cd backend
npm install @elastic/elasticsearch @nestjs/elasticsearch
```

---

## Open Questions

> [!IMPORTANT]
> 1. **ES 密码重置**：远程 ES 8 的 elastic 密码需要重置，是否同意现在执行？
> 2. **本地 ES 版本**：保持 7.17.4 还是升级到 8.x？建议保持现状。
> 3. **IK 分词器来源**：推荐从 `get.infini.cloud` 镜像下载（国内快速），如果服务器无法访问外网，需要手动上传安装包。远程服务器是否可以访问外网？
> 4. **工单搜索**：是否也将工单（tickets + 聊天消息）纳入 ES 全文搜索范围？还是先只做 BBS 帖子？

## Verification Plan

### Automated Tests
1. `npm run build` 前后端编译无错误
2. ES 分词验证：`GET /_analyze` 确认 IK 分词器工作正常

### Manual Verification
1. 启动后，`GET /search/sync` 全量同步数据到 ES
2. BBS 搜索栏输入关键词，验证：
   - 搜索结果高亮显示
   - 结果按相关度排序
   - 聚合统计正确
3. 新建/编辑/删除帖子后，搜索结果实时更新
4. 后台管理 — 搜索引擎面板，全量同步功能正常
