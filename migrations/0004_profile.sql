-- 个人中心：扩展邮箱验证码用途（设置密码 / 更换邮箱）
-- SQLite 不支持直接修改 CHECK 约束，这里重建表并保留原有数据

CREATE TABLE IF NOT EXISTS verification_codes_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'login'
    CHECK(purpose IN ('login', 'init_admin', 'set_password', 'change_email')),
  used INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT INTO verification_codes_new (id, email, code, purpose, used, expires_at, created_at)
  SELECT id, email, code, purpose, used, expires_at, created_at FROM verification_codes;

DROP TABLE verification_codes;

ALTER TABLE verification_codes_new RENAME TO verification_codes;

CREATE INDEX IF NOT EXISTS idx_verification_codes_email ON verification_codes(email);
