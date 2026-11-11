-- IP 维度限流计数（登录失败 / 验证码发送）
-- 用于阻止对验证码、密码的暴力尝试与单 IP 大量发信。
-- bucket_key 形如 'authfail:<ip>' / 'sendip:<ip>'；窗口过期后计数自动重置。
-- 未执行本迁移时，代码会静默降级为不限流（与其余迁移的兼容策略一致）。
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket_key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
