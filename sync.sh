#!/bin/bash
# Code Sync Script for Callcenter Project

REMOTE_USER="root"
REMOTE_HOST="192.168.50.51"
REMOTE_DIR="/var/www/callcenter"
LOCAL_DIR="/Users/yipang/Documents/Antigravity/callcenter"

echo "Syncing frontend files..."
rsync -avz --delete --exclude 'node_modules' --exclude '.git' --exclude '.env' "$LOCAL_DIR/frontend/" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/frontend/"

echo "Syncing backend files..."
rsync -avz --delete --exclude 'node_modules' --exclude '.git' --exclude '.env' --exclude 'oss' --exclude 'uploads' --exclude 'backups' "$LOCAL_DIR/backend/" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/backend/"

echo "Sync completed successfully!"
