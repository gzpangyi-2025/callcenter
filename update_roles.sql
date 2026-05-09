INSERT INTO roles (id, name, description, isActive, createdAt, updatedAt) VALUES
(1, 'user', '普通用户', 1, NOW(), NOW()),
(2, 'admin', '超级管理员', 1, NOW(), NOW()),
(3, 'director', '技术总监', 1, NOW(), NOW()),
(4, 'expert', '技术专家', 1, NOW(), NOW()),
(5, 'external', '外部用户', 1, NOW(), NOW()),
(6, 'manager', '区域经理', 1, NOW(), NOW()),
(7, 'region_director', '区域总监', 1, NOW(), NOW())
ON DUPLICATE KEY UPDATE name=VALUES(name), description=VALUES(description);
