-- 细粒度权限：组内成员/子组管理员按人授权，超级管理员可为任意用户配置全局权限
-- permissions 字段为 JSON 对象（{ "权限键": true/false }），只保存「与默认值不同」的项：
--   * user_group_relations.permissions：该用户在该组内的覆盖项（成员 / 组管理员各自有默认值）
--   * users.permissions：该用户的全局权限覆盖项（用户管理、操作审计等）

ALTER TABLE user_group_relations ADD COLUMN permissions TEXT;
ALTER TABLE users ADD COLUMN permissions TEXT;

-- 记录成员权限调整时间，便于审计与前端展示
ALTER TABLE user_group_relations ADD COLUMN permissions_updated_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_user_group_relations_user_group ON user_group_relations(user_id, group_id);
