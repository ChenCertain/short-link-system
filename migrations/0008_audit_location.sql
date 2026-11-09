-- 审计日志记录操作发生时的 IP 归属地（由 Cloudflare 边缘节点提供，如 "中国 Zhejiang Hangzhou"）
-- 历史数据该列为空，前端显示为「未知位置」
ALTER TABLE audit_logs ADD COLUMN location TEXT;
