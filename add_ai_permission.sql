-- ─────────────────────────────────────────────────────────────────────────────
--  Phase 3: Insert ai:access permission and assign to admin role
--  Run on the callcenter MySQL database (both intranet and Shanghai)
-- ─────────────────────────────────────────────────────────────────────────────

USE callcenter;

-- 1. Insert the ai:access permission (idempotent)
INSERT IGNORE INTO permissions (resource, action, description, createdAt)
VALUES ('ai', 'access', 'AI 协作 — 访问 Codex Worker 任务系统', NOW());

-- 2. Assign it to the admin role
--    (admin role bypasses guard anyway, but explicit is better for UI display)
INSERT IGNORE INTO role_permissions (roleId, permissionId)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'admin'
  AND p.resource = 'ai' AND p.action = 'access';

-- 3. Also assign to any existing 'engineer' or 'staff' roles if present
INSERT IGNORE INTO role_permissions (roleId, permissionId)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name IN ('engineer', 'staff', 'operator')
  AND p.resource = 'ai' AND p.action = 'access';

-- Verify
SELECT p.id, p.resource, p.action, p.description, r.name AS role
FROM permissions p
LEFT JOIN role_permissions rp ON rp.permissionId = p.id
LEFT JOIN roles r ON r.id = rp.roleId
WHERE p.resource = 'ai';
