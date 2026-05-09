SET FOREIGN_KEY_CHECKS=0;

-- Temporary mapping
UPDATE users SET roleId = 999 WHERE roleId = 1;
UPDATE users SET roleId = 888 WHERE roleId = 5;

DELETE FROM roles;

INSERT INTO roles (id, name, description, isActive, createdAt, updatedAt) VALUES
(1, 'user', '普通用户', 1, NOW(), NOW()),
(2, 'admin', '超级管理员', 1, NOW(), NOW()),
(3, 'director', '技术总监', 1, NOW(), NOW()),
(4, 'tech', '技术支持工程师(二线)', 1, NOW(), NOW()),
(5, 'external', '外部共享用户', 1, NOW(), NOW()),
(6, '区域经理', '各大区区域经理', 1, NOW(), NOW());

-- Final mapping
UPDATE users SET roleId = 2 WHERE roleId = 999;
UPDATE users SET roleId = 1 WHERE roleId = 888;

SET FOREIGN_KEY_CHECKS=1;
