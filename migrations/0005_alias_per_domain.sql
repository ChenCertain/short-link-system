-- 自定义别名唯一性：从「全局唯一」调整为「同一域名内唯一」
-- 这样删除短链后别名立即释放，且不同域名之间可以复用同一别名、互不干扰。

CREATE TABLE short_links_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  short_code TEXT NOT NULL,
  target_url TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  custom_alias TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled', 'expired')),
  redirect_type INTEGER NOT NULL DEFAULT 302,
  password TEXT,
  created_by INTEGER NOT NULL,
  group_id INTEGER,
  domain_id INTEGER,
  expires_at INTEGER,
  click_count INTEGER NOT NULL DEFAULT 0,
  is_displayed INTEGER NOT NULL DEFAULT 0,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  review_status TEXT NOT NULL DEFAULT 'approved',
  review_note TEXT,
  reviewed_by INTEGER,
  reviewed_at INTEGER,
  review_group_id INTEGER,
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (group_id) REFERENCES project_groups(id) ON DELETE SET NULL,
  FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE SET NULL
);

INSERT INTO short_links_new (
  id, short_code, target_url, name, custom_alias, status, redirect_type, password,
  created_by, group_id, domain_id, expires_at, click_count, is_displayed, display_order,
  created_at, updated_at, review_status, review_note, reviewed_by, reviewed_at, review_group_id
)
SELECT
  id, short_code, target_url, name, custom_alias, status, redirect_type, password,
  created_by, group_id, domain_id, expires_at, click_count, is_displayed, display_order,
  created_at, updated_at, review_status, review_note, reviewed_by, reviewed_at, review_group_id
FROM short_links;

CREATE TABLE access_logs_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  short_link_id INTEGER NOT NULL,
  ip_hash TEXT,
  country TEXT,
  city TEXT,
  user_agent TEXT,
  referer TEXT,
  timestamp INTEGER NOT NULL DEFAULT (unixepoch()),
  ip TEXT,
  FOREIGN KEY (short_link_id) REFERENCES short_links_new(id) ON DELETE CASCADE
);

INSERT INTO access_logs_new (id, short_link_id, ip_hash, country, city, user_agent, referer, timestamp, ip)
SELECT id, short_link_id, ip_hash, country, city, user_agent, referer, timestamp, ip FROM access_logs;

DROP TABLE access_logs;
DROP TABLE short_links;

ALTER TABLE short_links_new RENAME TO short_links;
ALTER TABLE access_logs_new RENAME TO access_logs;

CREATE INDEX IF NOT EXISTS idx_short_links_code ON short_links(short_code);
CREATE INDEX IF NOT EXISTS idx_short_links_created_by ON short_links(created_by);
CREATE INDEX IF NOT EXISTS idx_short_links_group_id ON short_links(group_id);
CREATE INDEX IF NOT EXISTS idx_short_links_status ON short_links(status);
CREATE INDEX IF NOT EXISTS idx_short_links_displayed ON short_links(is_displayed);
CREATE INDEX IF NOT EXISTS idx_short_links_review_status ON short_links(review_status);
CREATE INDEX IF NOT EXISTS idx_short_links_review_group ON short_links(review_group_id);

-- 同一域名内别名唯一（domain_id 为空视为同一组）
CREATE UNIQUE INDEX IF NOT EXISTS idx_short_links_domain_code
  ON short_links(COALESCE(domain_id, 0), short_code);

CREATE INDEX IF NOT EXISTS idx_access_logs_short_link_id ON access_logs(short_link_id);
CREATE INDEX IF NOT EXISTS idx_access_logs_timestamp ON access_logs(timestamp);
