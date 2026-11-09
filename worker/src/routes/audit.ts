// 操作审计路由（仅超级管理员）
import { Hono } from 'hono';
import type { Env, JWTPayload } from '../types';
import { jsonResponse } from '../utils';
import { authMiddleware, requireRole } from '../middleware';

const audit = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();

audit.use('*', authMiddleware);

// 审计日志列表
audit.get('/', requireRole('super_admin'), async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query('pageSize') || '30')));
  const action = c.req.query('action') || '';
  const offset = (page - 1) * pageSize;

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (action) {
    conditions.push('al.action = ?');
    params.push(action);
  }

  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';

  const list = await c.env.DB.prepare(
    `SELECT al.id, al.user_id, al.action, al.target_type, al.target_id, al.detail,
      al.ip, al.timestamp, u.email as user_email, u.name as user_name
     FROM audit_logs al
     LEFT JOIN users u ON al.user_id = u.id
     ${where}
     ORDER BY al.timestamp DESC, al.id DESC
     LIMIT ? OFFSET ?`
  ).bind(...params, pageSize, offset).all();

  const countResult = await c.env.DB.prepare(
    `SELECT COUNT(*) as total FROM audit_logs al${where}`
  ).bind(...params).first<{ total: number }>();

  return jsonResponse({
    logs: list.results,
    total: countResult?.total || 0,
    page,
    pageSize,
  });
});

export default audit;
