-- 最高权限账户（站点初始化时创建的超级管理员）
-- 只有该账户可以管理其他超级管理员（编辑 / 降级 / 删除），其他超级管理员不能修改它
ALTER TABLE users ADD COLUMN is_root INTEGER NOT NULL DEFAULT 0;

-- 把最早创建的超级管理员设为最高权限（即网站部署时初始化的那个账户）
UPDATE users SET is_root = 1
WHERE id = (
  SELECT id FROM users
  WHERE role = 'super_admin'
  ORDER BY created_at ASC, id ASC
  LIMIT 1
);
