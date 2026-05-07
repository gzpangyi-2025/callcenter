#!/bin/bash
# Controlled deployment script for the CallCenter project.
#
# Required order:
#   1. Validate and commit local changes.
#   2. Push the commit to GitHub.
#   3. Run this script to sync both production nodes.
#   4. Build/reload on each remote node.

set -euo pipefail

LOCAL_DIR="/Users/yipang/Documents/Antigravity/callcenter"
REMOTE_DIR="/var/www/callcenter"
BACKEND_SERVICE="callcenter-backend"

# Set RUN_NPM_INSTALL=1 when package.json/package-lock.json changed.
RUN_NPM_INSTALL="${RUN_NPM_INSTALL:-0}"

# 192.168.50.51 (local production node)
REMOTE_USER_1="root"
REMOTE_HOST_1="192.168.50.51"
REMOTE_PASSWORD_1=""

# 101.43.59.206 (Shanghai production node)
REMOTE_USER_2="root"
REMOTE_HOST_2="101.43.59.206"
REMOTE_PASSWORD_2=""

SSH_OPTS=(-o StrictHostKeyChecking=no)

FRONTEND_EXCLUDES=(
  --exclude 'node_modules'
  --exclude '.git'
  --exclude '.env'
  --exclude 'dist'
)

BACKEND_EXCLUDES=(
  --exclude 'node_modules'
  --exclude '.git'
  --exclude '.env'
  --exclude 'dist'
  --exclude 'oss'
  --exclude 'uploads'
  --exclude 'backups'
)

log() {
  echo
  echo "==> $*"
}

fail() {
  echo
  echo "ERROR: $*" >&2
  exit 1
}

ensure_git_synced() {
  log "Checking local Git state"
  cd "$LOCAL_DIR"

  if [[ -n "$(git status --porcelain)" ]]; then
    git status --short
    fail "Working tree is not clean. Commit and push changes before deployment."
  fi

  local upstream
  upstream="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"
  if [[ -z "$upstream" ]]; then
    fail "Current branch has no upstream. Push with: git push -u origin <branch>"
  fi

  git fetch --quiet origin

  local local_head remote_head
  local_head="$(git rev-parse HEAD)"
  remote_head="$(git rev-parse "$upstream")"

  if [[ "$local_head" != "$remote_head" ]]; then
    fail "Local HEAD is not synchronized with $upstream. Push or pull before deployment."
  fi

  log "Git is clean and synchronized with $upstream at $local_head"
}

run_tests() {
  log "Running frontend tests"
  cd "$LOCAL_DIR/frontend"
  if ! npm run test; then
    fail "Frontend tests failed. Deployment aborted."
  fi

  log "Running backend tests"
  cd "$LOCAL_DIR/backend"
  if ! npm run test; then
    fail "Backend tests failed. Deployment aborted."
  fi

  cd "$LOCAL_DIR"
}

run_ssh() {
  local user="$1"
  local host="$2"
  local password="$3"
  local command="$4"

  if [[ -n "$password" ]]; then
    sshpass -p "$password" ssh "${SSH_OPTS[@]}" "$user@$host" "$command"
  else
    ssh "${SSH_OPTS[@]}" "$user@$host" "$command"
  fi
}

run_rsync() {
  local label="$1"
  local user="$2"
  local host="$3"
  local password="$4"
  local source="$5"
  local target="$6"
  shift 6
  local excludes=("$@")

  log "Syncing $label to $host"
  if [[ -n "$password" ]]; then
    sshpass -p "$password" rsync -avz --delete -e "ssh -o StrictHostKeyChecking=no" \
      "${excludes[@]}" "$source" "$user@$host:$target"
  else
    rsync -avz --delete -e "ssh -o StrictHostKeyChecking=no" \
      "${excludes[@]}" "$source" "$user@$host:$target"
  fi
}

sync_sources() {
  local user="$1"
  local host="$2"
  local password="$3"

  run_rsync "frontend source" "$user" "$host" "$password" \
    "$LOCAL_DIR/frontend/" "$REMOTE_DIR/frontend/" "${FRONTEND_EXCLUDES[@]}"

  run_rsync "backend source" "$user" "$host" "$password" \
    "$LOCAL_DIR/backend/" "$REMOTE_DIR/backend/" "${BACKEND_EXCLUDES[@]}"
}

remote_build_and_reload() {
  local user="$1"
  local host="$2"
  local password="$3"
  local install_prefix=""

  if [[ "$RUN_NPM_INSTALL" == "1" ]]; then
    install_prefix="npm install && "
  fi

  # 先停止 PM2 进程，避免 build 期间 dist 被清空导致疯狂 restart
  log "Stopping backend on $host before build"
  run_ssh "$user" "$host" "$password" \
    "pm2 stop '$BACKEND_SERVICE' 2>/dev/null || true"

  log "Building backend on $host"
  run_ssh "$user" "$host" "$password" \
    "cd '$REMOTE_DIR/backend' && ${install_prefix}npm run build"

  log "Starting backend on $host"
  run_ssh "$user" "$host" "$password" \
    "if pm2 show '$BACKEND_SERVICE' > /dev/null 2>&1; then pm2 restart '$BACKEND_SERVICE' --update-env; else pm2 start dist/main.js --name '$BACKEND_SERVICE' --max-memory-restart 250M --node-args='--max-old-space-size=200' --cwd '$REMOTE_DIR/backend'; fi && pm2 save"

  log "Building frontend on $host"
  run_ssh "$user" "$host" "$password" \
    "cd '$REMOTE_DIR/frontend' && ${install_prefix}npm run build"
}

deploy_node() {
  local label="$1"
  local user="$2"
  local host="$3"
  local password="$4"

  log "Deploying $label ($host)"
  sync_sources "$user" "$host" "$password"
  remote_build_and_reload "$user" "$host" "$password"
}

ensure_git_synced
run_tests
deploy_node "local production node" "$REMOTE_USER_1" "$REMOTE_HOST_1" "$REMOTE_PASSWORD_1"
deploy_node "Shanghai production node" "$REMOTE_USER_2" "$REMOTE_HOST_2" "$REMOTE_PASSWORD_2"

log "Deployment completed successfully."
