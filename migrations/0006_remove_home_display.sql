-- 移除「首页展示短链」功能：清理不再使用的展示字段与索引
-- 注意：该迁移不会自动执行，需手动运行 wrangler d1 migrations apply

DROP INDEX IF EXISTS idx_short_links_displayed;

ALTER TABLE short_links DROP COLUMN is_displayed;
ALTER TABLE short_links DROP COLUMN display_order;
