# CallCenter 系统环境配置清单

此文档由 Antigravity 于 2026-05-08 生成，记录当前 `172.31.0.22` (Company Server) 的系统环境、网络架构、核心组件、版本信息及相关凭据，作为日后运维、部署和故障排查的基础参考依据。

## 一、网络及系统概览

* **操作系统**: CentOS Stream 9 (x86_64)
* **内网 IP (VPC)**: `172.31.0.22`
* **公网 IP (EIP)**: `101.251.208.178`
* **项目部署主路径**: `/data/callcenter`
* **网络与防火墙**: 
  * HTTP (TCP/80) —— 开放给 Nginx 代理前端和后端 API
  * WebRTC/TURN (TCP/UDP 3478) —— 开放给 coturn 服务
  * WebRTC Media Ports (UDP 49152-65535) —— 开放给 coturn 媒体流中继
  * SSH (TCP/22) —— 开放给管理员访问

## 二、账号与凭据大全

> [!CAUTION]
> 以下记录了高权限核心凭据。请在正式投入生产环境并完成交接后，及时对密码进行修改，并更新此文档。

| 组件 / 服务 | 用户名 | 密码 / Key | 地址或端口 | 备注 |
| :--- | :--- | :--- | :--- | :--- |
| **Linux SSH** | `root` | `Yxkj@300231` | `101.251.208.178:22` | 服务器最高权限 |
| **MySQL Database** | `pangyi` | `pangyi@123` | `172.31.0.100:3306` | 公司统一外置数据库 (TypeORM同步已关) |
| **Redis** | (默认空) | (默认空) | `127.0.0.1:6379` | 本地 Native 缓存及 BullMQ 队列 |
| **Elasticsearch** | `elastic` | `cAgckF9S6aTF8rRWXY8j` | `127.0.0.1:9200` | 全文检索引擎 (仅供后端内网调用) |
| **coturn (WebRTC)** | `callcenter` | `Yxkj@300231` | `101.251.208.178:3478` | 共享屏幕、语音通话的穿透服务器 |
| **CallCenter Web** | `admin` | (初始密码 `admin@123`) | `http://101.251.208.178` | CallCenter 超级管理员账号 |
| **首云 OSS (S3)** | AK:`8a2fffc01...` | SK:`d5fc1f9a6...` | `oss-high-qy01.cdsgss.com` | `callcenter` 存储桶 (`us-east-1`) |

## 三、核心依赖组件及版本

| 组件 | 版本 | 运行方式 | 核心配置路径或状态 |
| :--- | :--- | :--- | :--- |
| **Node.js** | v20.20.2 | Native | 平台运行环境 |
| **NPM** | 10.8.2 | Native | 包管理器 |
| **PM2** | 7.0.1 | Global NPM | `pm2 list` (守护 `callcenter-backend` 进程) |
| **Nginx** | 1.20.1 | Native | `/etc/nginx/nginx.conf`, `/etc/nginx/conf.d/callcenter.conf` |
| **Docker** | 29.4.3 | Native | `/var/lib/docker` |
| **Redis** | Native | Native | 服务为 `redis.service`。当前内存分配策略：默认无限制 (`maxmemory=0`)，由主机物理内存决定上限。 |
| **Elasticsearch** | 8.13.0 | Docker 容器 | 容器名：`callcenter_es`，内置 `ik-analyzer 8.13.0`。已通过环境变量限制最大堆内存为 `512MB` (`-Xms512m -Xmx512m`)。 |
| **coturn** | Native | Native | 配置文件：`/etc/coturn/turnserver.conf` |
| **Sysstat** | 12.5.4 | Native | 提供 `sar`、`iostat`，位于 `/var/log/sa/` |
| **Net-tools** | 2.0 | Native | 提供 `netstat` 等网络排障工具 |

## 四、服务部署细节

### 1. 前端 (Frontend - React/Vite)
* **代码目录**: `/data/callcenter/frontend`
* **静态构建目录**: `/data/callcenter/frontend/dist`
* **Nginx 代理配置**: `/etc/nginx/conf.d/callcenter.conf`
  * 将 `/` 路由到 `frontend/dist/index.html`，实现 SPA 路由接管。
  * `client_max_body_size 50M;` —— 允许前端直传最大 50MB 附件。

### 2. 后端 (Backend - NestJS)
* **代码目录**: `/data/callcenter/backend`
* **环境变量**: `/data/callcenter/backend/.env` (内部记录了数据库、Redis 缓存以及首云 OSS 基础信息，供启动时注入 `settingsService`)
* **运行端口**: `127.0.0.1:3000` (Nginx 会将 `/api/` 和 `/socket.io/` 转发至此端口)
* **进程管理**: 运行命令为 `pm2 restart callcenter-backend --update-env`。进程在异常奔溃时由 PM2 自动拉起，分配了最大 1GB 的内存限制策略(`--max-memory-restart 1G`)，以及 V8 引擎的最大堆内存为 800M (`--max-old-space-size=800`)。

### 3. Elasticsearch (搜索与检索)
* **角色**: 支撑工单、知识库文章和 BBS 论坛的全文本分词检索。
* **部署方式**: 通过 `docker-compose.es.yml` 拉起，限制了 JVM `Xms` 和 `Xmx` 内存占用以防 OOM。
* **分词器**: 采用的官方镜像没有中文分词能力，已通过脚本将 Infinilabs 提供的 `elasticsearch-analysis-ik` 插件植入容器并重新启动。

### 4. Coturn (WebRTC)
* **角色**: 充当 STUN/TURN 服务器，帮助处于对称 NAT（如公司内网、手机 4G/5G 网络）的用户在无法建立直连时提供云端媒体流中继。
* **配置**: 已在 `turnserver.conf` 中开启 `lt-cred-mech` 长期鉴权，强制要求账号密码方可使用资源。

## 五、高级运维脚本 (`sync.sh`)

位于 `/Users/yipang/Documents/Antigravity/callcenter/sync.sh`。
这套脚本目前承载了**所有节点的自动化推送发布**。

> [!NOTE]
> **发布逻辑:**
> 本地开发完毕后，确保所有代码已经 `git commit` 并 `push` 到了远程仓库，然后执行 `./sync.sh`。
> 脚本会依次通过 `rsync` 跳板将前端和后端代码分发到：
> 1. `192.168.50.51` (本地服务器)
> 2. `101.43.59.206` (上海生产节点)
> 3. `172.31.0.22` (当前公司服务器)
> 
> 然后在远端依次执行 `npm run build` 并在热更新无缝重启对应的 `pm2` 进程，从而实现零停机发布。

## 六、常用运维命令与日常维护

为了方便后续运维，以下列出各核心组件的基本管理命令：

### 1. Nginx (Web 代理)
* **查看运行状态**: `systemctl status nginx`
* **重启服务**: `systemctl restart nginx`
* **热重载配置 (平滑)**: `nginx -s reload`
* **检查配置语法**: `nginx -t`
* **修改主站配置**: `vi /etc/nginx/conf.d/callcenter.conf`

### 2. PM2 (Node.js 后端守护进程)
* **查看所有进程**: `pm2 list` 或者 `pm2 ls`
* **实时查看控制台日志**: `pm2 logs callcenter-backend`
* **监控 CPU/内存面板**: `pm2 monit`
* **重启后端应用**: `pm2 restart callcenter-backend --update-env`
* **保存当前进程状态为开机自启**: `pm2 save`

### 3. Redis (缓存队列)
* **查看运行状态**: `systemctl status redis`
* **重启服务**: `systemctl restart redis`
* **进入交互终端**: `redis-cli`
* **修改配置文件**: `vi /etc/redis/redis.conf` (修改后需重启)

### 4. Elasticsearch (Docker 容器)
* **查看容器运行情况**: `docker ps | grep elasticsearch`
* **查看服务日志**: `docker logs -f callcenter_es`
* **重启容器**: `docker restart callcenter_es`
* **进入容器内部终端**: `docker exec -it callcenter_es /bin/bash`

### 5. Coturn (WebRTC TURN 穿透)
* **查看运行状态**: `systemctl status coturn`
* **重启服务**: `systemctl restart coturn`
* **实时查看日志**: `journalctl -u coturn -f`
* **修改配置文件**: `vi /etc/coturn/turnserver.conf`

### 6. MySQL (外部统一数据库)
* **登录数据库**: `mysql -h 172.31.0.100 -u pangyi -p` (输入密码 `pangyi@123`)
* **直接执行 SQL 语句**: `mysql -h 172.31.0.100 -u pangyi -ppangyi@123 -e "SHOW DATABASES;"`
