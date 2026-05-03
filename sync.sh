#!/bin/bash
# Code Sync Script for Callcenter Project

LOCAL_DIR="/Users/yipang/Documents/Antigravity/callcenter"
REMOTE_DIR="/var/www/callcenter"

# Sync to 192.168.50.51 (Local Prod)
REMOTE_USER_1="root"
REMOTE_HOST_1="192.168.50.51"

echo "Syncing frontend to $REMOTE_HOST_1..."
rsync -avz --delete --exclude 'node_modules' --exclude '.git' --exclude '.env' "$LOCAL_DIR/frontend/" "$REMOTE_USER_1@$REMOTE_HOST_1:$REMOTE_DIR/frontend/"

echo "Syncing backend to $REMOTE_HOST_1..."
rsync -avz --delete --exclude 'node_modules' --exclude '.git' --exclude '.env' --exclude 'oss' --exclude 'uploads' --exclude 'backups' "$LOCAL_DIR/backend/" "$REMOTE_USER_1@$REMOTE_HOST_1:$REMOTE_DIR/backend/"

# Sync to 101.43.59.206 (Shanghai Prod)
REMOTE_USER_2="root"
REMOTE_HOST_2="101.43.59.206"
PASSWORD_2="Matrox123#"

echo "Syncing frontend to $REMOTE_HOST_2..."
sshpass -p "$PASSWORD_2" rsync -avz -e "ssh -o StrictHostKeyChecking=no" --delete --exclude 'node_modules' --exclude '.git' --exclude '.env' "$LOCAL_DIR/frontend/" "$REMOTE_USER_2@$REMOTE_HOST_2:$REMOTE_DIR/frontend/"

echo "Syncing backend to $REMOTE_HOST_2..."
sshpass -p "$PASSWORD_2" rsync -avz -e "ssh -o StrictHostKeyChecking=no" --delete --exclude 'node_modules' --exclude '.git' --exclude '.env' --exclude 'oss' --exclude 'uploads' --exclude 'backups' "$LOCAL_DIR/backend/" "$REMOTE_USER_2@$REMOTE_HOST_2:$REMOTE_DIR/backend/"

echo "Sync completed successfully!"
