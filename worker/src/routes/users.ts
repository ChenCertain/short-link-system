// 用户管理路由（仅超级管理员可访问）
// 项目组管理员不具备全局用户管理权限，只能在项目组内管理成员。

import { Hono } from 'hono';
import type { Env, JWTPayload } from '../types';
import { jsonResponse, hashPassword } from '../utils';
import { authMiddleware, requireRole, logAudit } from '../middleware';
import { getManagedGroupIds } from '../permissions';

const users = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();

// 所有路由需要登录
users.use('*', authMiddleware);

// ========== 获取用户列表（仅超级管理员） ==========
users.get('/', requireRole('super_admin'), async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const search = c.req.query('search') || '';
  const offset = (page - 1) * pageSize;

  let query = `SELECT id, email, name, role, status, require_review, review_by,
      last_login_at, last_login_ip, created_at FROM users`;
  let countQuery = 'SELECT COUNT(*) as total FROM users';
  const params: (string | number)[] = [];

  if (search) {
    query += ' WHERE email LIKE ? OR name LIKE ?';
    countQuery += ' WHERE email LIKE ? OR name LIKE ?';
    params.push(`%${search}%`, `%${search}%`);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  const list = await c.env.DB.prepare(query).bind(...params, pageSize, offset).all<{ id: number; role: string }>();
  const countResult = await c.env.DB.prepare(countQuery).bind(...params).first<{ total: number }>();

  return jsonResponse({
    users: list.results.map((u) => ({ ...u, role: u.role === 'super_admin' ? 'super_admin' : 'user' })),
    total: countResult?.total || 0,
    page,
    pageSize,
  });
});

// ========== 创建用户（仅超级管理员） ==========
users.post('/', requireRole('super_admin'), async (c) => {
  const body = await c.req.json<{
    email: string;
    password: string;
    name: string;
    role: 'super_admin' | 'user';
    require_review?: boolean;
    review_by?: 'auto' | 'super_admin';
  }>();

  if (!body.email || !body.password || !body.name) {
    return jsonResponse({ error: '请填写所有必填字段' }, 400);
  }
  if (body.password.length < 8) {
    return jsonResponse({ error: '密码长度至少 8 位' }, 400);
  }
  if (!['super_admin', 'user'].includes(body.role)) {
    return jsonResponse({ error: '无效的角色' }, 400);
  }

  // 检查邮箱是否已存在
  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(body.email).first();
  if (existing) {
    return jsonResponse({ error: '该邮箱已被使用' }, 400);
  }

  const passwordHash = await hashPassword(body.password);
  // 注册的用户默认需要审核（可显式关闭）
  const requireReview = body.require_review === false ? 0 : 1;
  const reviewBy = body.review_by === 'super_admin' ? 'super_admin' : 'auto';

  const result = await c.env.DB.prepare(
    'INSERT INTO users (email, password_hash, name, role, status, require_review, review_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(body.email, passwordHash, body.name, body.role, 'active', requireReview, reviewBy).run();

  const userId = result.meta.last_row_id;

  await logAudit(c.env.DB, c.env.KV, c.get('user').user_id, 'create_user', c.req.raw, 'user', userId as number, JSON.stringify({
    email: body.email,
    role: body.role,
    require_review: requireReview,
    review_by: reviewBy,
  }));

  return jsonResponse({
    success: true,
    user: {
      id: userId,
      email: body.email,
      name: body.name,
      role: body.role,
      status: 'active',
      require_review: requireReview,
      review_by: reviewBy,
    },
  }, 201);
});

// ========== 更新用户（仅超级管理员） ==========
users.put('/:id', requireRole('super_admin'), async (c) => {
  const userId = parseInt(c.req.param('id'));
  if (!Number.isFinite(userId)) return jsonResponse({ error: '无效的用户 ID' }, 400);

  const body = await c.req.json<{
    name?: string;
    role?: 'super_admin' | 'user';
    status?: 'active' | 'disabled';
    password?: string;
    require_review?: boolean;
    review_by?: 'auto' | 'super_admin';
  }>();
  const currentUser = c.get('user');

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<{ id: number; role: string }>();
  if (!user) {
    return jsonResponse({ error: '用户不存在' }, 404);
  }
  if (body.role && !['super_admin', 'user'].includes(body.role)) {
    return jsonResponse({ error: '无效的角色' }, 400);
  }

  // 不允许禁用自己的账户
  if (body.status === 'disabled' && userId === currentUser.user_id) {
    return jsonResponse({ error: '不能禁用自己的账户' }, 400);
  }

  // 不允许把系统中最后一个超级管理员降级或禁用
  if (user.role === 'super_admin' && ((body.role && body.role !== 'super_admin') || body.status === 'disabled')) {
    const superAdmins = await c.env.DB.prepare(
      "SELECT COUNT(*) as total FROM users WHERE role = 'super_admin' AND status = 'active'"
    ).first<{ total: number }>();
    if ((superAdmins?.total || 0) <= 1) {
      return jsonResponse({ error: '系统至少需要保留一个启用状态的超级管理员' }, 400);
    }
  }

  const updates: string[] = [];
  const params: (string | number)[] = [];

  if (body.name) {
    updates.push('name = ?');
    params.push(body.name);
  }
  if (body.role) {
    updates.push('role = ?');
    params.push(body.role);
  }
  if (body.status) {
    updates.push('status = ?');
    params.push(body.status);
  }
  if (body.require_review !== undefined) {
    updates.push('require_review = ?');
    params.push(body.require_review ? 1 : 0);
  }
  if (body.review_by) {
    updates.push('review_by = ?');
    params.push(body.review_by === 'super_admin' ? 'super_admin' : 'auto');
  }
  if (body.password) {
    if (body.password.length < 8) {
      return jsonResponse({ error: '密码长度至少 8 位' }, 400);
    }
    const hash = await hashPassword(body.password);
    updates.push('password_hash = ?');
    params.push(hash);
  }

  if (updates.length === 0) {
    return jsonResponse({ error: '没有需要更新的字段' }, 400);
  }

  updates.push('updated_at = ?');
  params.push(Math.floor(Date.now() / 1000));
  params.push(userId);

  await c.env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run();

  await logAudit(c.env.DB, c.env.KV, currentUser.user_id, 'update_user', c.req.raw, 'user', userId, JSON.stringify(body));

  return jsonResponse({ success: true });
});

// ========== 删除用户（仅超级管理员） ==========
users.delete('/:id', requireRole('super_admin'), async (c) => {
  const userId = parseInt(c.req.param('id'));
  if (!Number.isFinite(userId)) return jsonResponse({ error: '无效的用户 ID' }, 400);
  const currentUser = c.get('user');

  if (userId === currentUser.user_id) {
    return jsonResponse({ error: '不能删除自己' }, 400);
  }

  const user = await c.env.DB.prepare('SELECT id, role FROM users WHERE id = ?').bind(userId).first<{ role: string }>();
  if (!user) {
    return jsonResponse({ error: '用户不存在' }, 404);
  }
  if (user.role === 'super_admin') {
    return jsonResponse({ error: '不能删除超级管理员' }, 400);
  }

  // 先清理关联数据，避免外键约束导致删除失败
  await c.env.DB.batch([
    c.env.DB.prepare(
      'DELETE FROM access_logs WHERE short_link_id IN (SELECT id FROM short_links WHERE created_by = ?)'
    ).bind(userId),
    c.env.DB.prepare('DELETE FROM short_links WHERE created_by = ?').bind(userId),
    c.env.DB.prepare('DELETE FROM user_group_relations WHERE user_id = ?').bind(userId),
    c.env.DB.prepare('UPDATE domains SET added_by = ? WHERE added_by = ?').bind(currentUser.user_id, userId),
    c.env.DB.prepare('UPDATE project_groups SET created_by = ? WHERE created_by = ?').bind(currentUser.user_id, userId),
    c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId),
  ]);

  await logAudit(c.env.DB, c.env.KV, currentUser.user_id, 'delete_user', c.req.raw, 'user', userId);

  return jsonResponse({ success: true });
});

// ========== 获取用户详情（本人或超级管理员） ==========
users.get('/:id', async (c) => {
  const userId = parseInt(c.req.param('id'));
  if (!Number.isFinite(userId)) return jsonResponse({ error: '无效的用户 ID' }, 400);
  const currentUser = c.get('user');

  // 普通用户只能查看自己
  if (currentUser.role !== 'super_admin' && currentUser.user_id !== userId) {
    return jsonResponse({ error: '权限不足' }, 403);
  }

  const user = await c.env.DB.prepare(
    `SELECT id, email, name, role, status, require_review, review_by,
      last_login_at, last_login_ip, created_at FROM users WHERE id = ?`
  ).bind(userId).first<{ id: number; role: string }>();

  if (!user) {
    return jsonResponse({ error: '用户不存在' }, 404);
  }

  // 获取用户所在的项目组
  const groups = await c.env.DB.prepare(
    `SELECT pg.id, pg.name, pg.parent_id, ugr.role as group_role
     FROM user_group_relations ugr
     JOIN project_groups pg ON ugr.group_id = pg.id
     WHERE ugr.user_id = ?`
  ).bind(userId).all();

  const managedGroupIds = await getManagedGroupIds(c.env.DB, userId);

  return jsonResponse({
    user: { ...user, role: user.role === 'super_admin' ? 'super_admin' : 'user', managed_group_ids: managedGroupIds },
    groups: groups.results,
  });
});

export default users;
