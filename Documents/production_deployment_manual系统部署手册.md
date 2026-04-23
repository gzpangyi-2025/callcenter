# CallCenter 平台生产环境迁移与部署手册

本手册基于您计划在即将上线的全新 **Oracle Linux 8.9** 裸机（或虚拟机）上进行的系统全量迁移环境，提供端到端的基础设施投产以及应用拉起指南。

由于系统目前属于前后端分离且包含 Elasticsearch 等独立引擎的现代微服务架构，请严格按照以下 4 个阶段落实。

---

## 阶段一：宿主机底层环境预配

当您拿到只装好 Oracle Linux 8.9 的裸机后，首先利用 SSH 登录最高权限 `root` 账号。

### 1. 基础依赖库与工具链安装
```bash
# 更新现有软件包，安装编译与迁移利器
dnf update -y
dnf install -y wget curl git zip unzip tar vim
```

### 2. Node.js 运行时环境 (依赖 fnm 或 NodeSource)
后端完全依托高并发 Node.js 运行：
```bash
# 激活 Node 官方 Repository (使用 v20 LTS 版本)
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
dnf install -y nodejs

# 安装进程存活守护神器 PM2 和 TypeScript
npm install -g pm2 typescript
```

### 3. Nginx 代理服务器安装
负责前端包的静态分发以及后端的负载均衡代理映射：
```bash
dnf install -y nginx
systemctl enable nginx
systemctl start nginx
```

### 4. 核心存储引擎：MySQL 8.x
系统的主业务命脉，包含结构化核心数据字典：
```bash
dnf install -y mysql-server
systemctl enable --now mysqld

# （必做）系统会指引您初始化密码，禁止 root 远程登录等安全交互
mysql_secure_installation

# 登录进数据库后，创建业务库并设置正确的字符集
# mysql -u root -p
# > CREATE DATABASE callcenter DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 5. 高级检索引擎：Elasticsearch 8.x 与 Java (重要)
ES 是提供全平台毫秒级高级搜索的核心服务：
```bash
# 1. 安装 OpenJDK 17（ES 运行基础）
dnf install -y java-17-openjdk-devel

# 2. 导入 Elastic 官方密钥与镜像源
rpm --import https://artifacts.elastic.co/GPG-KEY-elasticsearch
cat <<EOF > /etc/yum.repos.d/elasticsearch.repo
[elasticsearch]
name=Elasticsearch repository for 8.x packages
baseurl=https://artifacts.elastic.co/packages/8.x/yum
gpgcheck=1
gpgkey=https://artifacts.elastic.co/GPG-KEY-elasticsearch
enabled=1
autorefresh=1
type=rpm-md
EOF

# 3. 安装并启动 ES
dnf install -y elasticsearch
systemctl daemon-reload
systemctl enable elasticsearch

# 4. （必须操作）安装 IK 中文分词器（版本务必与您下载的 ES 8.x 版本完全对应！）
/usr/share/elasticsearch/bin/elasticsearch-plugin install https://github.com/medcl/elasticsearch-analysis-ik/releases/download/v8.12.0/elasticsearch-analysis-ik-8.12.0.zip

# 5. 为了内网服务方便连接，可能需要去 /etc/elasticsearch/elasticsearch.yml 修改安全策略：
# xpack.security.enabled: false (如果是纯内网，可以关闭强制 https/账号校验以简化部署)

# 重启使分词器和配置生效
systemctl restart elasticsearch
```

---

## 阶段二：数据提取与横向迁移 (从旧服务器向新服务器)

系统有两处不可再生资产需要在停机割接日打包迁移：**MySQL 数据库记录** 和 **上传的静态附件 (OSS / Uploads)**。

> [!WARNING]
> 执行本阶段前，请在测试服务器（192.168.50.51）上通知大家暂停使用，或直接在旧机 `pm2 stop all` 将系统下线，防止在迁移中产生数据丢失。

### 1. 物理附件与静态切片迁移
到原先 `192.168.50.51` 节点下，将上传的文件块打包：
```bash
cd /var/www/callcenter/backend
# 包含工单里的全部文件，以及AI生成的中间图等
tar -czvf oss_backup.tar.gz ./oss ./uploads

# 使用 scp 发送到新生产服务器
scp oss_backup.tar.gz root@<生产机IP>:/tmp/
```

### 2. MySQL 数据库核心字典导出
在旧服务器使用 Dump 剥离冷备：
```bash
mysqldump -u root -p callcenter > callcenter_prod_backup.sql
scp callcenter_prod_backup.sql root@<生产机IP>:/tmp/
```
再去新服务器将它“注入”到第一阶段建立的空白数据库中：
```bash
# 在新机器：
mysql -u root -p callcenter < /tmp/callcenter_prod_backup.sql
```

---

## 阶段三：应用代码部署与启动

我们将为生产制定统一架构空间：`/var/www/callcenter`。

### 1. 创建挂载阵列并落位代码
在新机器上：
```bash
mkdir -p /var/www/callcenter/frontend
mkdir -p /var/www/callcenter/backend
```
将旧机器中**最后构建成功**的后端项目（含代码、非 node_modules）与前端纯静态 `dist/` 文件夹传输并放在上述结构下。
将第二阶段提取的文件包 `/tmp/oss_backup.tar.gz` 解压恢复到新机器的 `/var/www/callcenter/backend` 后端根目录下！

### 2. 后端服务端环境变量指引与拉起
进入代码层：
```bash
cd /var/www/callcenter/backend
npm install # 只安装依赖

# 确认配置文件 .env 的配置 (很重要)
vim .env
```
由于是新环境，请务必在 `.env` 中修正：
- `DB_HOST` / `DB_PASSWORD` / `DB_USER` (填您配置的新 MySQL)
- `ES_NODE_PROD` (填 `http://localhost:9200`)
- `AI_API_KEY` 及相关私钥。

利用 PM2 一键后台守护挂载：
```bash
npm run build 
pm2 start dist/main.js --name "callcenter-backend"
pm2 save
pm2 startup # 将应用刻录入开机自启动链
```

---

## 阶段四：网关编排域 (Nginx) 收尾

在生产部署下，我们要关闭以前任何带有 `npm run dev` 字样的前台黑框框，改用高吞吐度的 Nginx Web 服务直接将您的应用推向用户。

```bash
# 修改 Nginx 配置文件
vim /etc/nginx/nginx.conf
```
建议在 `{ server }` 块采用如下跨域分流路由：
```nginx
server {
    listen       80;
    server_name  YOUR_PRODUCTION_DOMAIN_OR_IP; # 填新机器公网IP或绑定域名

    # 1. 前端静态大包交付映射
    location / {
        root   /var/www/callcenter/frontend/dist;
        index  index.html index.htm;
        # 防止 SPA 前端 React-Router 刷新出现 404 (核心)
        try_files $uri $uri/ /index.html;
    }

    # 2. 拦截后端的 Rest API 进行反向转发
    location /api/ {
        proxy_pass http://localhost:3000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_addrs;
    }

    # 3. 拦截双向实时通讯的 WebSockets (非常重要，否则消息提醒不跳)
    location /socket.io/ {
        proxy_pass http://localhost:3000/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```
保存后，重启激活网络层：
```bash
systemctl restart nginx
```

---

## 阶段五：启航验收检查项 (Checklist)

部署完成后，在您的个人电脑使用浏览器敲入 http://新生产IP ，然后照着检查以下 3 步以确认全系统无伤存活：

1. **登录系统后查看工单**：验证 MySQL 已经安全迁入且密码/账户正常；点开某个含附件工单，随便下载一个附件，确认 `oss` （文件系统迁移）无损坏可用。
2. **AI引擎与外网连通**：随便找一个关单的界面生成知识库报告，或者在聊天中触发 AI 回答，确认您的新 Oracle Linux 服务器外部连通性以及底层域名解析正常（DNS 可以正确解出 Google/OpenAI 的入口地址）。
3. **搜索引擎重建**：登录后台进入 **管理员后台 -> 搜索引擎管理**。由于我们只从旧机器迁了 MySQL，新机器目前刚建好的 ES 头脑还是空白的没有索引树。**在此刻点击一次【开始全量同步】按钮。** 一旦看到绿色提示“成功同步 xxxx 条”，恭喜您，整套微服务架构宣告迁移大吉！

---

## 阶段六：日常代码版本更新与维护 (System Update)

随着系统的不断迭代开发，当您需要把最新的代码部署到生产环境时，请遵循以下轻量级的“热更新”流程，切勿全盘覆盖以免丢失附件或配置：

### 1. 打包最新代码 (在开发环境)
在您的开发机上进行代码打包，**注意排除** `node_modules`（环境异构会导致报错）和静态资源（避免覆盖生产机）：
```bash
cd /Users/yipang/Documents/code/callcenter
# 使用 exclude 参数排除不要覆盖的运行时文件
tar --exclude='backend/node_modules' \
    --exclude='frontend/node_modules' \
    --exclude='backend/oss' \
    --exclude='backend/uploads' \
    --exclude='backend/.env' \
    --exclude='backend/dist' \
    --exclude='frontend/dist' \
    -czvf callcenter_update.tar.gz ./*
```

### 2. 传输并解压覆盖 (在生产环境)
将包传到生产机后，直接解压覆盖旧代码：
```bash
scp callcenter_update.tar.gz root@<生产机IP>:/tmp/

# 在生产机执行：
cd /var/www/callcenter
# 解压并强制覆盖原同名文件 (-o 覆盖)
tar -xzvf /tmp/callcenter_update.tar.gz -C .
```

### 3. 安装依赖与编译打包 (在生产环境)
分别进入前端和后端进行依赖拉取和安全编译：

**前端更新**：
```bash
cd /var/www/callcenter/frontend
npm install
npm run build   # 重新生成前端的独立 dist 文件夹
```

**后端更新**：
```bash
cd /var/www/callcenter/backend
npm install
npm run build   # 把新的 src 代码经过 TypeScrip 转换输出到 dist
```

### 4. 重启业务进程使其生效
代码构建完毕后，**无需**重启整台服务器，仅通过守护进程热加载即可：
```bash
# 平滑重启后端的 Node.js 微服务群
pm2 reload callcenter-backend

# (可选) 如果你修改了前端路由或者 Nginx 配置文件，可以重启一下 Web 代理层
systemctl reload nginx
```
> [!TIP]
> **关于 Nginx 的重启**：因为前端 Vite 构建出的是纯静态 `.html` 和 `.js` 文件落入磁盘。每次前端 `npm run build` 结束后，其实新前台界面就已经实时生效了，通常只要用户在浏览器按下 `F5` 刷新缓存即可看到新界面，**Nginx 本身是不需要执行任何重启指令的**，除非您去动了 `/etc/nginx/nginx.conf` 代理转发配置。
