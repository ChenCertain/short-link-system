-- 权限体系收敛、审核归属与 IP 记录

-- 1) 角色收敛：项目管理员统一由「项目组管理员」表达
UPDATE users SET role = 'user' WHERE role = 'project_admin';

-- 2) 审核策略
-- review_by: auto（组管理员优先，无组或组无管理员则超管）/ super_admin（始终由超管审核）
ALTER TABLE users ADD COLUMN review_by TEXT NOT NULL DEFAULT 'auto';
-- 最近登录信息（用于用户管理展示登录地址）
ALTER TABLE users ADD COLUMN last_login_at INTEGER;
ALTER TABLE users ADD COLUMN last_login_ip TEXT;

-- 3) 短链审核归属：非空表示由该组的管理员审核，空表示由超级管理员审核
ALTER TABLE short_links ADD COLUMN review_group_id INTEGER;

-- 4) 明文 IP 记录（用于审计与访问明细展示）
ALTER TABLE audit_logs ADD COLUMN ip TEXT;
ALTER TABLE access_logs ADD COLUMN ip TEXT;

CREATE INDEX IF NOT EXISTS idx_short_links_review_group ON short_links(review_group_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);
