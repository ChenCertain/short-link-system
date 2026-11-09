// 认证与权限中间件

import { createMiddleware } from 'hono/factory';
import type { Env, JWTPayload, UserRole } from './types';
import { verifyJWT, getRequestIP, hashIP, jsonResponse } from './utils';
import { getManagedGroupIds } from './permissions';

// 从 Authorization header 提取并验证 JWT
export const authMiddleware = createMiddleware<{
  Bindings: Env;
  Variables: { user: JWTPayload };
}>(async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return jsonResponse({ error: '未登录' }, 401);
  }
  const token = authHeader.substring(7);
  const payload = await verifyJWT(token, c.env.JWT_SECRET);
  if (!payload) {
    return jsonResponse({ error: '登录已过期，请重新登录' }, 401);
  }

  // 兼容历史 token：project_admin 角色已废弃，统一按普通用户处理
  // （其管理能力由项目组管理员身份决定）
  const role: UserRole = payload.role === 'super_admin' ? 'super_admin' : 'user';

  // 注入用户管理的项目组，便于后续权限判断
  const managedGroupIds = role === 'super_admin' ? [] : await getManagedGroupIds(c.env.DB, payload.user_id);

  c.set('user', { ...payload, role, managed_group_ids: managedGroupIds });
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

// 登录用户快捷访问
export function getCurrentUser(c: { var: { user?: JWTPayload } }): JWTPayload | null {
  return c.var.user || null;
}

// 记录审计日志（同时记录明文 IP 与脱敏哈希）
export async function logAudit(
  db: D1Database,
  kv: KVNamespace,
  user_id: number | null,
  action: string,
  request: Request,
  target_type?: string,
  target_id?: number,
  detail?: string
): Promise<void> {
  const ip = getRequestIP(request);
  const ip_hash = await hashIP(ip, 'audit-salt');
  await db.prepare(
    'INSERT INTO audit_logs (user_id, action, target_type, target_id, detail, ip, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(user_id, action, target_type || null, target_id || null, detail || null, ip, ip_hash).run();
}
