-- 访问日志补充「地区」维度（Cloudflare 提供的省份/州），用于地区分布统计
ALTER TABLE access_logs ADD COLUMN region TEXT;

-- 统计按时间窗口查询较频繁，补充时间索引（已存在时跳过）
CREATE INDEX IF NOT EXISTS idx_access_logs_timestamp ON access_logs(timestamp);
