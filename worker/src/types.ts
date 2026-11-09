// Cloudflare Workers 类型定义

export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  ASSETS: Fetcher;
  // 环境变量
  JWT_SECRET: string;
  TURNSTILE_SITE_KEY: string;
  TURNSTILE_SECRET_KEY: string;
  SMTP_HOST: string;
  SMTP_PORT: string;
  SMTP_USER: string;
  SMTP_PASS: string;
  SMTP_FROM: string;
  // 本实例的默认访问域名（workers.dev / 自定义域名），用于展示短链地址与 DNS 指引
  PAGES_DOMAIN?: string;
}

// 用户角色（项目组管理员由 user_group_relations.role = 'admin' 表达）
export type UserRole = 'super_admin' | 'user';
export type UserStatus = 'active' | 'disabled';
// 审核方式：auto = 组管理员优先；super_admin = 始终由超级管理员审核
export type ReviewBy = 'auto' | 'super_admin';

export interface User {
  id: number;
  email: string;
  password_hash: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  require_review: number;
  review_by: ReviewBy;
  last_login_at: number | null;
  last_login_ip: string | null;
  created_at: number;
  updated_at: number;
}

// 不含密码的公开用户信息
export interface PublicUser {
  id: number;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  created_at: number;
}

export interface ProjectGroup {
  id: number;
  name: string;
  description: string | null;
  parent_id: number | null;
  created_by: number;
  created_at: number;
  updated_at: number;
}

export interface UserGroupRelation {
  id: number;
  user_id: number;
  group_id: number;
  role: 'admin' | 'member';
  created_at: number;
}

export interface Domain {
  id: number;
  domain: string;
  type: 'short_link' | 'admin' | 'both';
  is_default_short_link: number;
  status: 'active' | 'disabled' | 'pending_verification';
  added_by: number;
  created_at: number;
  updated_at: number;
}

export interface ShortLink {
  id: number;
  short_code: string;
  target_url: string;
  name: string;
  custom_alias: string | null;
  status: 'active' | 'disabled' | 'expired';
  redirect_type: number;
  password: string | null;
  created_by: number;
  group_id: number | null;
  domain_id: number | null;
  expires_at: number | null;
  click_count: number;
  is_displayed: number;
  display_order: number;
  review_status: 'approved' | 'pending' | 'rejected';
  review_note: string | null;
  reviewed_by: number | null;
  reviewed_at: number | null;
  review_group_id: number | null;
  created_at: number;
  updated_at: number;
}

export interface AccessLog {
  id: number;
  short_link_id: number;
  ip: string | null;
  ip_hash: string | null;
  country: string | null;
  city: string | null;
  user_agent: string | null;
  referer: string | null;
  timestamp: number;
}

export interface VerificationCode {
  id: number;
  email: string;
  code: string;
  purpose: 'login' | 'init_admin';
  used: number;
  expires_at: number;
  created_at: number;
}

export interface AuditLog {
  id: number;
  user_id: number | null;
  user_email?: string | null;
  user_name?: string | null;
  action: string;
  target_type: string | null;
  target_id: number | null;
  detail: string | null;
  ip: string | null;
  ip_hash: string | null;
  timestamp: number;
}

// JWT Payload
export interface JWTPayload {
  user_id: number;
  email: string;
  role: UserRole;
  exp: number;
  iat: number;
  // 运行时附加：该用户作为管理员的项目组 id（登录态下由中间件注入）
  managed_group_ids?: number[];
}
