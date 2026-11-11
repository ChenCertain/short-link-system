// 认证与权限中间件

import { createMiddleware } from 'hono/factory';
import type { Env, JWTPayload, UserRole } from './types';
import {
  verifyJWT,
  getRequestIP,
  getRequestLocation,
  hashIP,
  jsonResponse,
  assertJwtSecret,
  redactAuditDetail,
} from './utils';
import { getManagedGroupIds, hasGlobalPermission } from './permissions';

// 从 Authorization header 提取并验证 JWT
export const authMiddleware = createMiddleware<{
  Bindings: Env;
  Variables: { user: JWTPayload };
}>(async (c, next) => {
  // 密钥缺失或仍是占位符时直接拒绝服务，避免空密钥签发/校验被伪造的令牌
  try {
    assertJwtSecret(c.env.JWT_SECRET);
  } catch (err) {
    console.error('[auth] JWT_SECRET 配置错误：', err);
    return jsonResponse({ error: '服务端未正确配置 JWT_SECRET，暂时无法提供服务' }, 500);
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return jsonResponse({ error: '未登录' }, 401);
  }
  const token = authHeader.substring(7);
  const payload = await verifyJWT(token, c.env.JWT_SECRET);
  if (!payload) {
    return jsonResponse({ error: '登录已过期，请重新登录' }, 401);
  }

  // 每次请求都读取账号状态与最新角色：
  // - 禁用账号后旧 JWT 立即失效，不能继续调用接口；
  // - 角色被调整后以数据库为准，避免旧 token 保留超级管理员权限直到过期。
  const account = await c.env.DB.prepare('SELECT email, role, status FROM users WHERE id = ?')
    .bind(payload.user_id)
    .first<{ email: string; role: string; status: string }>();
  if (!account) {
    return jsonResponse({ error: '账户不存在，请重新登录' }, 401);
  }
  if (account.status === 'disabled') {
    // 用 401 让前端清理本地令牌并回到登录页（登录接口本身仍会返回 403）
    return jsonResponse({ error: '账户已被禁用', code: 'ACCOUNT_DISABLED' }, 401);
  }

  // 兼容历史 token：project_admin 角色已废弃，统一按普通用户处理
  // （其管理能力由项目组管理员身份决定）
  const role: UserRole = account.role === 'super_admin' ? 'super_admin' : 'user';

  // 注入用户管理的项目组，便于后续权限判断
  const managedGroupIds = role === 'super_admin' ? [] : await getManagedGroupIds(c.env.DB, payload.user_id);

  c.set('user', {
    ...payload,
    email: account.email || payload.email,
    role,
    managed_group_ids: managedGroupIds,
  });
  await next();
});

// 角色检查中间件
export function requireRole(...roles: UserRole[]) {
  return createMiddleware<{
    Bindings: Env;
    Variables: { user: JWTPayload };
  }>(async (c, next) => {
    const user = c.get('user');
    if (!user || !roles.includes(user.role)) {
      return jsonResponse({ error: '权限不足' }, 403);
    }
    await next();
  });
}

// 全局权限检查中间件（超级管理员默认拥有全部全局权限，其余用户按 users.permissions 配置）
export function requireGlobalPermission(key: string) {
  return createMiddleware<{
    Bindings: Env;
    Variables: { user: JWTPayload };
  }>(async (c, next) => {
    const user = c.get('user');
    if (!user) return jsonResponse({ error: '未登录' }, 401);
    if (user.role === 'super_admin') return next();
    if (!(await hasGlobalPermission(c.env.DB, user.user_id, key))) {
      return jsonResponse({ error: '权限不足' }, 403);
    }
    return next();
  });
}

// 记录审计日志（同时记录明文 IP 与脱敏哈希）
export async function logAudit(
  db: D1Database,
  user_id: number | null,
  action: string,
  request: Request,
  target_type?: string,
  target_id?: number,
  detail?: string
): Promise<void> {
  const ip = getRequestIP(request);
  const ip_hash = await hashIP(ip, 'audit-salt');
  const location = getRequestLocation(request);
  // 统一脱敏：密码 / 验证码 / 令牌不写入审计日志
  const safeDetail = redactAuditDetail(detail);
  try {
    await db.prepare(
      'INSERT INTO audit_logs (user_id, action, target_type, target_id, detail, ip, ip_hash, location) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(user_id, action, target_type || null, target_id || null, safeDetail, ip, ip_hash, location).run();
  } catch {
    // 迁移 0008 未执行时降级为不含地理位置的写入
    await db.prepare(
      'INSERT INTO audit_logs (user_id, action, target_type, target_id, detail, ip, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(user_id, action, target_type || null, target_id || null, safeDetail, ip, ip_hash).run();
  }
}
