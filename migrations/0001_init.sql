-- 短链管理系统 初始化迁移
-- Cloudflare D1 (SQLite)

-- ========== 用户表 ==========
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('super_admin', 'project_admin', 'user')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ========== 项目组表（支持子组） ==========
CREATE TABLE IF NOT EXISTS project_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  parent_id INTEGER,                          -- NULL 表示顶级组，非 NULL 表示子组
  created_by INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (parent_id) REFERENCES project_groups(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- ========== 项目组-用户关联表 ==========
CREATE TABLE IF NOT EXISTS user_group_relations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  group_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('admin', 'member')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(user_id, group_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (group_id) REFERENCES project_groups(id) ON DELETE CASCADE
);

-- ========== 域名表 ==========
CREATE TABLE IF NOT EXISTS domains (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL UNIQUE,                -- 如 sl.example.com
  type TEXT NOT NULL DEFAULT 'both' CHECK(type IN ('short_link', 'admin', 'both')),
  is_default_short_link INTEGER NOT NULL DEFAULT 0,  -- 1 = 默认短链域名
  status TEXT NOT NULL DEFAULT 'pending_verification' CHECK(status IN ('active', 'disabled', 'pending_verification')),
  added_by INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (added_by) REFERENCES users(id)
);

-- ========== 项目组-域名关联表 ==========
CREATE TABLE IF NOT EXISTS group_domain_relations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  domain_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(group_id, domain_id),
  FOREIGN KEY (group_id) REFERENCES project_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE
);

-- ========== 短链表 ==========
CREATE TABLE IF NOT EXISTS short_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  short_code TEXT NOT NULL UNIQUE,            -- 短码
  target_url TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  custom_alias TEXT,                          -- 用户自定义别名（可空）
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled', 'expired')),
  redirect_type INTEGER NOT NULL DEFAULT 302, -- 301 或 302
  password TEXT,                              -- 访问密码哈希（可空）
  created_by INTEGER NOT NULL,
  group_id INTEGER,                           -- 所属项目组（可空）
  domain_id INTEGER,                          -- 使用的域名（可空则用默认）
  expires_at INTEGER,                         -- 过期时间（可空）
  click_count INTEGER NOT NULL DEFAULT 0,
  is_displayed INTEGER NOT NULL DEFAULT 0,    -- 是否在首页展示
  display_order INTEGER NOT NULL DEFAULT 0,   -- 首页展示排序
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (group_id) REFERENCES project_groups(id) ON DELETE SET NULL,
  FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE SET NULL
);

-- ========== 访问日志表 ==========
CREATE TABLE IF NOT EXISTS access_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  short_link_id INTEGER NOT NULL,
  ip_hash TEXT,                               -- IP 脱敏哈希
  country TEXT,
  city TEXT,
  user_agent TEXT,
  referer TEXT,
  timestamp INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (short_link_id) REFERENCES short_links(id) ON DELETE CASCADE
);

-- ========== 验证码表 ==========
CREATE TABLE IF NOT EXISTS verification_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'login' CHECK(purpose IN ('login', 'init_admin')),
  used INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ========== 系统配置表 ==========
CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- 默认未初始化
INSERT OR IGNORE INTO system_config (key, value) VALUES ('initialized', 'false');
INSERT OR IGNORE INTO system_config (key, value) VALUES ('site_name', '短链管理系统');
INSERT OR IGNORE INTO system_config (key, value) VALUES ('default_redirect_type', '302');

-- ========== 操作审计日志表 ==========
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,                       -- 如 'create_user', 'delete_link', 'update_config'
  target_type TEXT,
  target_id INTEGER,
  detail TEXT,                                -- JSON 格式详情
  ip_hash TEXT,
  timestamp INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- ========== 索引 ==========
CREATE INDEX IF NOT EXISTS idx_short_links_code ON short_links(short_code);
CREATE INDEX IF NOT EXISTS idx_short_links_created_by ON short_links(created_by);
CREATE INDEX IF NOT EXISTS idx_short_links_group_id ON short_links(group_id);
CREATE INDEX IF NOT EXISTS idx_short_links_status ON short_links(status);
CREATE INDEX IF NOT EXISTS idx_short_links_displayed ON short_links(is_displayed);
CREATE INDEX IF NOT EXISTS idx_access_logs_short_link_id ON access_logs(short_link_id);
CREATE INDEX IF NOT EXISTS idx_access_logs_timestamp ON access_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_verification_codes_email ON verification_codes(email);
CREATE INDEX IF NOT EXISTS idx_user_group_relations_user_id ON user_group_relations(user_id);
CREATE INDEX IF NOT EXISTS idx_user_group_relations_group_id ON user_group_relations(group_id);
CREATE INDEX IF NOT EXISTS idx_group_domain_relations_group_id ON group_domain_relations(group_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_project_groups_parent_id ON project_groups(parent_id);
