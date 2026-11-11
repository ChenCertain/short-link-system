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
  // 本 Worker 的 workers.dev 域名（不含协议），用于域名管理里的 CNAME 目标指引
  WORKER_HOST?: string;
  // 允许跨域访问的来源白名单（逗号分隔）。默认不放开跨域；同源部署无需配置
  CORS_ALLOWED_ORIGINS?: string;
  // IP 限流阈值（可选，运维调优用）：
  // 同一 IP 窗口内认证失败次数上限 / 窗口秒数（默认 10 次 / 900 秒）
  RATE_LIMIT_LOGIN_FAIL_MAX?: string;
  RATE_LIMIT_LOGIN_FAIL_WINDOW?: string;
  // 同一 IP 窗口内验证码发送次数上限 / 窗口秒数（默认 20 次 / 600 秒）
  RATE_LIMIT_SEND_IP_MAX?: string;
  RATE_LIMIT_SEND_IP_WINDOW?: string;
}

// 用户角色（项目组管理员由 user_group_relations.role = 'admin' 表达）
export type UserRole = 'super_admin' | 'user';

// 数据表结构以 migrations/*.sql 为准；路由内按需声明行类型，
// 不再维护与表结构易漂移的实体接口（历史上的 User/ShortLink 等已移除）。

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
