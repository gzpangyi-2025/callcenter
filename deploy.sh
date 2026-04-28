#!/bin/bash
# 一键自动部署脚本 (One-click Deployment Script) for Callcenter Project
# 该脚本包含代码同步、远程构建、PM2服务重启的完整流程

REMOTE_USER="root"
REMOTE_HOST="192.168.50.51"
REMOTE_DIR="/var/www/callcenter"
LOCAL_DIR="/Users/yipang/Documents/Antigravity/callcenter"

echo "========================================="
echo "🚀 开始部署 CallCenter 项目到生产环境..."
echo "服务器: $REMOTE_HOST"
echo "========================================="

echo "▶ 步骤 1: 同步前端文件..."
rsync -avz --delete \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude '.env' \
  --exclude 'dist' \
  "$LOCAL_DIR/frontend/" \
  "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/frontend/"

echo ""
echo "▶ 步骤 2: 同步后端文件..."
rsync -avz --delete \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude '.env' \
  --exclude 'oss' \
  --exclude 'uploads' \
  --exclude 'backups' \
  --exclude 'dist' \
  "$LOCAL_DIR/backend/" \
  "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/backend/"

echo ""
echo "▶ 步骤 3: 远程构建与重启服务 (通过 SSH)..."
ssh $REMOTE_USER@$REMOTE_HOST << 'EOF'
  set -e

  echo "  👉 正在构建前端项目..."
  cd /var/www/callcenter/frontend
  npm install
  npm run build

  echo "  👉 正在构建后端项目..."
  cd /var/www/callcenter/backend
  npm install
  npm run build

  echo "  👉 正在重启 PM2 后端服务..."
  # 检查 PM2 是否已存在该进程，存在则 reload（零停机），否则 start
  if pm2 show callcenter-backend > /dev/null 2>&1; then
      pm2 reload callcenter-backend
  else
      pm2 start dist/main.js --name callcenter-backend
  fi
  pm2 save
  
  echo "✅ 远程端任务执行完毕！"
EOF

echo "========================================="
echo "🎉 部署已全部完成！"
echo "========================================="
