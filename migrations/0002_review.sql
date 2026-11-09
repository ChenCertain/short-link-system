-- 短链审核功能
-- 1) 用户级开关：该用户新建短链是否需要管理员审核
-- 2) 短链审核状态：approved（默认通过）/ pending（待审核）/ rejected（已驳回）

ALTER TABLE users ADD COLUMN require_review INTEGER NOT NULL DEFAULT 0;

ALTER TABLE short_links ADD COLUMN review_status TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE short_links ADD COLUMN review_note TEXT;
ALTER TABLE short_links ADD COLUMN reviewed_by INTEGER;
ALTER TABLE short_links ADD COLUMN reviewed_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_short_links_review_status ON short_links(review_status);
CREATE INDEX IF NOT EXISTS idx_users_require_review ON users(require_review);
