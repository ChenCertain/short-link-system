// 用户管理路由
// 访问控制：超级管理员，或被授予全局权限 `user.manage` 的账号
// 项目组管理员不具备全局用户管理权限，只能在项目组内管理成员。

import { Hono } from 'hono';
import type { Env, JWTPayload } from '../types';
import { jsonResponse, hashPassword } from '../utils';
import { authMiddleware, requireGlobalPermission, logAudit } from '../middleware';
import {
  GLOBAL_PERMISSION_KEYS,
  getGlobalPermissions,
  getManagedGroupIds,
  resolveReviewGroupId,
  hasGlobalPermission,
  parsePermissionJson,
} from '../permissions';

const users = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();

// 所有路由需要登录
users.use('*', authMiddleware);

/** 当前登录用户能否查看目标用户的完整资料（本人 / 超级管理员 / 拥有 user.manage） */
async function canViewUser(db: D1Database, user: JWTPayload, targetId: number): Promise<boolean> {
  if (user.user_id === targetId) return true;
  if (user.role === 'super_admin') return true;
  return hasGlobalPermission(db, user.user_id, 'user.manage');
}

/**
 * 是否「最高权限账户」（网站初始化时创建的那个超级管理员）。
 * 只有最高权限账户可以编辑 / 降级 / 删除其他超级管理员，避免多个超管因同级而互相无法管理。
 * 迁移 0009 未执行时返回 false（退化为普通规则）。
 */
async function isRootAccount(db: D1Database, userId: number): Promise<boolean> {
  try {
    const row = await db.prepare('SELECT is_root FROM users WHERE id = ?').bind(userId).first<{ is_root: number }>();
    return Number(row?.is_root || 0) === 1;
  } catch {
    return false;
  }
}

/** 把扁平的组列表拼成「父组 / 子组」路径 */
async function loadGroupPaths(db: D1Database): Promise<Map<number, string>> {
  const rows = await db.prepare('SELECT id, name, parent_id FROM project_groups').all<{
    id: number;
    name: string;
    parent_id: number | null;
  }>();
  const byId = new Map(rows.results.map((row) => [row.id, row]));
  const cache = new Map<number, string>();

  const build = (id: number, depth = 0): string => {
    const cached = cache.get(id);
    if (cached) return cached;
    const row = byId.get(id);
    if (!row || depth > 20) return '';
    const parent = row.parent_id ? build(row.parent_id, depth + 1) : '';
    const path = parent ? `${parent} / ${row.name}` : row.name;
    cache.set(id, path);
    return path;
  };

  for (const row of rows.results) build(row.id);
  return cache;
}

// ========== 获取用户列表（支持按项目组 / 组内身份 / 角色 / 状态筛选） ==========
users.get('/', requireGlobalPermission('user.manage'), async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const search = c.req.query('search') || '';
  const groupId = parseInt(c.req.query('groupId') || '0') || 0;
  const groupRole = c.req.query('groupRole') || '';
  const role = c.req.query('role') || '';
  const status = c.req.query('status') || '';
  const offset = (page - 1) * pageSize;

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (search) {
    conditions.push('(email LIKE ? OR name LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  if (['super_admin', 'user'].includes(role)) {
    conditions.push('role = ?');
    params.push(role);
  }
  if (['active', 'disabled'].includes(status)) {
    conditions.push('status = ?');
    params.push(status);
  }
  if (groupId > 0) {
    if (['admin', 'member'].includes(groupRole)) {
      conditions.push('EXISTS (SELECT 1 FROM user_group_relations r WHERE r.user_id = users.id AND r.group_id = ? AND r.role = ?)');
      params.push(groupId, groupRole);
    } else {
      conditions.push('EXISTS (SELECT 1 FROM user_group_relations r WHERE r.user_id = users.id AND r.group_id = ?)');
      params.push(groupId);
    }
  } else if (groupRole === 'none') {
    // 未加入任何项目组的用户
    conditions.push('NOT EXISTS (SELECT 1 FROM user_group_relations r WHERE r.user_id = users.id)');
  }

  const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';

  let query = `SELECT id, email, name, role, status, require_review, review_by, permissions, is_root,
      last_login_at, last_login_ip, created_at,
      CASE WHEN password_hash IS NULL OR password_hash = '' THEN 0 ELSE 1 END AS password_set,
      (SELECT COUNT(*) FROM short_links WHERE created_by = users.id) AS link_count,
      (SELECT COUNT(*) FROM user_group_relations WHERE user_id = users.id) AS group_count
      FROM users${where}`;
  const countQuery = `SELECT COUNT(*) as total FROM users${where}`;

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  let list: { results: { id: number; role: string; permissions: string | null }[] };
  try {
    list = await c.env.DB.prepare(query).bind(...params, pageSize, offset).all<{
      id: number;
      role: string;
      permissions: string | null;
    }>();
  } catch {
    // 迁移未执行（users.permissions / users.is_root 不存在）时降级
    list = await c.env.DB.prepare(query.replace('permissions, is_root,', 'NULL AS permissions, 0 AS is_root,'))
      .bind(...params, pageSize, offset)
      .all<{ id: number; role: string; permissions: string | null }>();
  }
  const countResult = await c.env.DB.prepare(countQuery).bind(...params).first<{ total: number }>();

  // 附加每个用户所属项目组（按组分类展示 / 筛选时需要）
  const groupPaths = await loadGroupPaths(c.env.DB);
  const userGroups: Record<number, { id: number; name: string; path: string; role: string }[]> = {};
  const ids = list.results.map((u) => u.id);
  if (ids.length > 0) {
    const rels = await c.env.DB.prepare(
      `SELECT ugr.user_id, ugr.group_id, ugr.role, g.name
       FROM user_group_relations ugr JOIN project_groups g ON g.id = ugr.group_id
       WHERE ugr.user_id IN (${ids.map(() => '?').join(',')})`,
    )
      .bind(...ids)
      .all<{ user_id: number; group_id: number; role: string; name: string }>();
    for (const rel of rels.results) {
      (userGroups[rel.user_id] ||= []).push({
        id: rel.group_id,
        name: rel.name,
        path: groupPaths.get(rel.group_id) || rel.name,
        role: rel.role,
      });
    }
  }

  return jsonResponse({
    users: list.results.map((u) => ({
      ...u,
      role: u.role === 'super_admin' ? 'super_admin' : 'user',
      global_permissions: parsePermissionJson(u.permissions),
      groups: userGroups[u.id] || [],
    })),
    total: countResult?.total || 0,
    page,
    pageSize,
  });
});

// ========== 创建用户（仅超级管理员可创建超级管理员） ==========
users.post('/', requireGlobalPermission('user.manage'), async (c) => {
  const currentUser = c.get('user');
  const body = await c.req.json<{
    email: string;
    password?: string;
    name: string;
    role: 'super_admin' | 'user';
    require_review?: boolean;
    review_by?: 'auto' | 'parent' | 'super_admin';
    group_id?: number | null;
    group_role?: 'admin' | 'member';
  }>();

  const email = (body.email || '').trim().toLowerCase();
  const name = (body.name || '').trim();
  const password = body.password || '';

  if (!email || !name) {
    return jsonResponse({ error: '请填写邮箱和用户名' }, 400);
  }
  if (password && password.length < 8) {
    return jsonResponse({ error: '密码长度至少 8 位' }, 400);
  }
  if (!['super_admin', 'user'].includes(body.role)) {
    return jsonResponse({ error: '无效的角色' }, 400);
  }
  // 超级管理员身份只能由超级管理员授予
  if (body.role === 'super_admin' && currentUser.role !== 'super_admin') {
    return jsonResponse({ error: '只有超级管理员可以创建超级管理员' }, 403);
  }

  // 可选：创建时直接加入某个项目组（组内身份 admin / member）
  const groupId = body.group_id ? Number(body.group_id) : null;
  const groupRole: 'admin' | 'member' = body.group_role === 'admin' ? 'admin' : 'member';
  if (groupId !== null) {
    if (!Number.isFinite(groupId)) return jsonResponse({ error: '无效的项目组' }, 400);
    const group = await c.env.DB.prepare('SELECT id FROM project_groups WHERE id = ?').bind(groupId).first();
    if (!group) return jsonResponse({ error: '项目组不存在' }, 404);
    if (body.role === 'super_admin' && groupRole === 'admin') {
      return jsonResponse({ error: '超级管理员无需设置组内身份' }, 400);
    }
  }

  // 检查邮箱是否已存在
  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) {
    return jsonResponse({ error: '该邮箱已被使用' }, 400);
  }

  // 密码可留空：留空时用户凭邮箱验证码在登录页自行设置（password_hash 为空串）
  const passwordHash = password ? await hashPassword(password) : '';
  // 注册的用户默认需要审核（可显式关闭）
  const requireReview = body.require_review === false ? 0 : 1;
  const reviewBy =
    body.review_by === 'super_admin' ? 'super_admin' : body.review_by === 'parent' ? 'parent' : 'auto';

  const result = await c.env.DB.prepare(
    'INSERT INTO users (email, password_hash, name, role, status, require_review, review_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(email, passwordHash, name, body.role, 'active', requireReview, reviewBy).run();

  const userId = result.meta.last_row_id;

  if (groupId !== null) {
    await c.env.DB.prepare('INSERT INTO user_group_relations (user_id, group_id, role) VALUES (?, ?, ?)')
      .bind(userId, groupId, groupRole)
      .run();
  }

  await logAudit(c.env.DB, currentUser.user_id, 'create_user', c.req.raw, 'user', userId as number, JSON.stringify({
    email: body.email,
    role: body.role,
    require_review: requireReview,
    review_by: reviewBy,
    group_id: groupId,
    group_role: groupId !== null ? groupRole : null,
  }));

  return jsonResponse({
    success: true,
    user: {
      id: userId,
      email,
      name,
      role: body.role,
      status: 'active',
      require_review: requireReview,
      review_by: reviewBy,
      group_id: groupId,
      group_role: groupId !== null ? groupRole : null,
      password_set: password ? 1 : 0,
    },
  }, 201);
});

// ========== 更新用户 ==========
users.put('/:id', requireGlobalPermission('user.manage'), async (c) => {
  const userId = parseInt(c.req.param('id'));
  if (!Number.isFinite(userId)) return jsonResponse({ error: '无效的用户 ID' }, 400);

  const body = await c.req.json<{
    name?: string;
    role?: 'super_admin' | 'user';
    status?: 'active' | 'disabled';
    password?: string;
    require_review?: boolean;
    review_by?: 'auto' | 'parent' | 'super_admin';
  }>();
  const currentUser = c.get('user');

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<{ id: number; role: string; is_root?: number }>();
  if (!user) {
    return jsonResponse({ error: '用户不存在' }, 404);
  }

  // 最高权限账户：只有它自己能维护，且不能被降级或禁用
  if (Number(user.is_root || 0) === 1) {
    if (!(await isRootAccount(c.env.DB, currentUser.user_id))) {
      return jsonResponse({ error: '最高权限账户只能由该账户本人修改' }, 403);
    }
    if ((body.role && body.role !== 'super_admin') || body.status === 'disabled') {
      return jsonResponse({ error: '最高权限账户不能被降级或禁用' }, 400);
    }
  }

  if (body.role && !['super_admin', 'user'].includes(body.role)) {
    return jsonResponse({ error: '无效的角色' }, 400);
  }
  // 角色调整仅超级管理员可执行，避免 user.manage 授权者自我提权
  if (body.role && body.role !== user.role && currentUser.role !== 'super_admin') {
    return jsonResponse({ error: '只有超级管理员可以调整用户角色' }, 403);
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
    params.push(
      body.review_by === 'super_admin' ? 'super_admin' : body.review_by === 'parent' ? 'parent' : 'auto',
    );
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

  // 审核配置变更后，同步该用户「待审核短链」的审核归属
  if (body.require_review !== undefined || body.review_by) {
    const latest = await c.env.DB.prepare('SELECT require_review, review_by FROM users WHERE id = ?')
      .bind(userId)
      .first<{ require_review: number; review_by: string }>();
    if (latest) {
      const pending = await c.env.DB.prepare(
        "SELECT id, group_id FROM short_links WHERE created_by = ? AND review_status = 'pending'",
      )
        .bind(userId)
        .all<{ id: number; group_id: number | null }>();
      for (const item of pending.results) {
        let nextGroupId: number | null = null;
        if (latest.require_review && latest.review_by !== 'super_admin') {
          nextGroupId = await resolveReviewGroupId(
            c.env.DB,
            item.group_id || null,
            latest.review_by === 'parent' ? 'parent' : 'auto',
          );
        }
        await c.env.DB.prepare('UPDATE short_links SET review_group_id = ? WHERE id = ?')
          .bind(nextGroupId, item.id)
          .run();
      }
    }
  }

  await logAudit(c.env.DB, currentUser.user_id, 'update_user', c.req.raw, 'user', userId, JSON.stringify(body));

  return jsonResponse({ success: true });
});

// ========== 配置用户的全局权限（仅超级管理员） ==========
users.put('/:id/permissions', async (c) => {
  const targetId = parseInt(c.req.param('id'));
  if (!Number.isFinite(targetId)) return jsonResponse({ error: '无效的用户 ID' }, 400);
  const currentUser = c.get('user');
  if (currentUser.role !== 'super_admin') {
    return jsonResponse({ error: '只有超级管理员可以配置全局权限' }, 403);
  }

  const body = await c.req.json<{ permissions?: Record<string, boolean> }>();
  const incoming = body.permissions || {};

  const overrides: Record<string, boolean> = {};
  for (const key of GLOBAL_PERMISSION_KEYS) {
    if (incoming[key] !== undefined) overrides[key] = incoming[key] === true;
  }

  const target = await c.env.DB.prepare('SELECT id, role, is_root FROM users WHERE id = ?').bind(targetId).first<{ role: string; is_root?: number }>();
  if (!target) return jsonResponse({ error: '用户不存在' }, 404);
  if (Number(target.is_root || 0) === 1 && !(await isRootAccount(c.env.DB, currentUser.user_id))) {
    return jsonResponse({ error: '最高权限账户的权限只能由该账户本人调整' }, 403);
  }
  if (target.role === 'super_admin' && Object.values(overrides).some((v) => v === false)) {
    return jsonResponse({ error: '超级管理员始终拥有全部全局权限' }, 400);
  }

  await c.env.DB.prepare('UPDATE users SET permissions = ?, updated_at = ? WHERE id = ?')
    .bind(JSON.stringify(overrides), Math.floor(Date.now() / 1000), targetId)
    .run();

  await logAudit(
    c.env.DB,
    currentUser.user_id,
    'update_user_permissions',
    c.req.raw,
    'user',
    targetId,
    JSON.stringify(overrides),
  );

  const effective = await getGlobalPermissions(c.env.DB, targetId);
  return jsonResponse({ success: true, permissions: overrides, effective });
});

// ========== 删除用户 ==========
users.delete('/:id', requireGlobalPermission('user.manage'), async (c) => {
  const userId = parseInt(c.req.param('id'));
  if (!Number.isFinite(userId)) return jsonResponse({ error: '无效的用户 ID' }, 400);
  const currentUser = c.get('user');

  if (userId === currentUser.user_id) {
    return jsonResponse({ error: '不能删除自己' }, 400);
  }

  const user = await c.env.DB.prepare('SELECT id, role, is_root FROM users WHERE id = ?').bind(userId).first<{ role: string; is_root?: number }>();
  if (!user) {
    return jsonResponse({ error: '用户不存在' }, 404);
  }
  if (Number(user.is_root || 0) === 1) {
    return jsonResponse({ error: '最高权限账户不能被删除' }, 400);
  }
  // 其他超级管理员只能由最高权限账户删除（避免同级超管互相无法管理）
  if (user.role === 'super_admin') {
    if (!(await isRootAccount(c.env.DB, currentUser.user_id))) {
      return jsonResponse({ error: '只有最高权限账户可以删除超级管理员' }, 403);
    }
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

  await logAudit(c.env.DB, currentUser.user_id, 'delete_user', c.req.raw, 'user', userId);

  return jsonResponse({ success: true });
});

// ========== 用户详情：基本信息 + 所在组 + 短链概览 + 操作记录 + 登录 IP ==========
users.get('/:id', async (c) => {
  const userId = parseInt(c.req.param('id'));
  if (!Number.isFinite(userId)) return jsonResponse({ error: '无效的用户 ID' }, 400);
  const currentUser = c.get('user');

  if (!(await canViewUser(c.env.DB, currentUser, userId))) {
    return jsonResponse({ error: '权限不足' }, 403);
  }

  const detailSql = `SELECT id, email, name, role, status, require_review, review_by, permissions, is_root,
      last_login_at, last_login_ip, created_at, updated_at,
      CASE WHEN password_hash IS NULL OR password_hash = '' THEN 0 ELSE 1 END AS password_set
     FROM users WHERE id = ?`;
  let user: { id: number; role: string; permissions: string | null } | null = null;
  try {
    user = await c.env.DB.prepare(detailSql).bind(userId).first<{ id: number; role: string; permissions: string | null }>();
  } catch {
    // 迁移未执行（users.permissions / users.is_root 不存在）时降级
    user = await c.env.DB.prepare(detailSql.replace('permissions, is_root,', 'NULL AS permissions, 0 AS is_root,'))
      .bind(userId)
      .first<{ id: number; role: string; permissions: string | null }>();
  }

  if (!user) {
    return jsonResponse({ error: '用户不存在' }, 404);
  }

  // 所在项目组（含继承关系产生的可见组不在此列，只展示直接加入的组）
  const groupsSql = `SELECT pg.id, pg.name, pg.parent_id, ugr.role as group_role, ugr.created_at as joined_at,
      ugr.permissions as group_permissions, ugr.permissions_updated_at
     FROM user_group_relations ugr
     JOIN project_groups pg ON ugr.group_id = pg.id
     WHERE ugr.user_id = ?
     ORDER BY pg.id ASC`;
  let groups: { results: { id: number; name: string; group_permissions: string | null }[] } = { results: [] };
  try {
    groups = await c.env.DB.prepare(groupsSql).bind(userId).all<{
      id: number;
      name: string;
      group_permissions: string | null;
    }>();
  } catch {
    groups = await c.env.DB.prepare(
      groupsSql.replace(
        'ugr.permissions as group_permissions, ugr.permissions_updated_at',
        'NULL AS group_permissions, NULL AS permissions_updated_at',
      ),
    ).bind(userId).all<{ id: number; name: string; group_permissions: string | null }>();
  }

  const paths = await loadGroupPaths(c.env.DB);

  const linkSummary = await c.env.DB.prepare(
    `SELECT COUNT(*) as total,
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
      SUM(click_count) as clicks
     FROM short_links WHERE created_by = ?`
  ).bind(userId).first<{ total: number; active: number; clicks: number }>();

  const links = await c.env.DB.prepare(
    `SELECT sl.id, sl.short_code, sl.target_url, sl.name, sl.status, sl.click_count, sl.created_at,
      sl.custom_alias, sl.redirect_type, sl.expires_at, sl.domain_id,
      sl.group_id, d.domain as domain_name, pg.name as group_name
     FROM short_links sl
     LEFT JOIN domains d ON sl.domain_id = d.id
     LEFT JOIN project_groups pg ON sl.group_id = pg.id
     WHERE sl.created_by = ?
     ORDER BY sl.created_at DESC LIMIT 10`
  ).bind(userId).all();

  const logSql = `SELECT id, action, target_type, target_id, detail, ip, timestamp, location
     FROM audit_logs WHERE user_id = ?
     ORDER BY timestamp DESC, id DESC LIMIT 20`;
  let logs: { results: unknown[] } = { results: [] };
  try {
    logs = await c.env.DB.prepare(logSql).bind(userId).all();
  } catch {
    // 迁移 0008 未执行时降级
    logs = await c.env.DB.prepare(logSql.replace(', location', ', NULL AS location')).bind(userId).all();
  }

  const ipSql = `SELECT ip, COUNT(*) as count, MAX(timestamp) as last_seen,
      (SELECT a2.location FROM audit_logs a2
        WHERE a2.user_id = audit_logs.user_id AND a2.ip = audit_logs.ip AND a2.location IS NOT NULL
        ORDER BY a2.timestamp DESC, a2.id DESC LIMIT 1) as location
     FROM audit_logs WHERE user_id = ? AND ip IS NOT NULL AND ip <> ''
     GROUP BY ip ORDER BY last_seen DESC LIMIT 10`;
  let ips: { results: unknown[] } = { results: [] };
  try {
    ips = await c.env.DB.prepare(ipSql).bind(userId).all();
  } catch {
    // 迁移 0008 未执行时降级
    ips = await c.env.DB.prepare(
      `SELECT ip, COUNT(*) as count, MAX(timestamp) as last_seen, NULL AS location
       FROM audit_logs WHERE user_id = ? AND ip IS NOT NULL AND ip <> ''
       GROUP BY ip ORDER BY last_seen DESC LIMIT 10`,
    ).bind(userId).all();
  }

  const managedGroupIds = await getManagedGroupIds(c.env.DB, userId);

  // 最后登录 IP 的归属地（取该用户该 IP 最近一条带归属地的审计记录）
  const lastLoginIp = (user as unknown as { last_login_ip?: string | null }).last_login_ip;
  let lastLoginLocation: string | null = null;
  if (lastLoginIp) {
    try {
      const row = await c.env.DB.prepare(
        `SELECT location FROM audit_logs WHERE user_id = ? AND ip = ? AND location IS NOT NULL
         ORDER BY timestamp DESC, id DESC LIMIT 1`,
      )
        .bind(userId, lastLoginIp)
        .first<{ location: string }>();
      lastLoginLocation = row?.location ?? null;
    } catch {
      // 迁移 0008 未执行时无归属地
    }
  }

  return jsonResponse({
    user: {
      ...user,
      role: user.role === 'super_admin' ? 'super_admin' : 'user',
      global_permissions: parsePermissionJson(user.permissions),
      managed_group_ids: managedGroupIds,
      last_login_location: lastLoginLocation,
    },
    groups: groups.results.map((row) => ({
      ...row,
      group_permissions: parsePermissionJson(row.group_permissions),
      path: paths.get(row.id) || row.name,
    })),
    link_summary: {
      total: linkSummary?.total || 0,
      active: linkSummary?.active || 0,
      clicks: linkSummary?.clicks || 0,
    },
    links: links.results,
    logs: logs.results,
    ips: ips.results,
    is_self: currentUser.user_id === userId,
  });
});

// ========== 用户操作记录（分页） ==========
users.get('/:id/logs', async (c) => {
  const userId = parseInt(c.req.param('id'));
  if (!Number.isFinite(userId)) return jsonResponse({ error: '无效的用户 ID' }, 400);
  const currentUser = c.get('user');

  if (!(await canViewUser(c.env.DB, currentUser, userId))) {
    return jsonResponse({ error: '权限不足' }, 403);
  }

  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const action = (c.req.query('action') || '').trim();
  const offset = (page - 1) * pageSize;

  const conditions = ['user_id = ?'];
  const params: (string | number)[] = [userId];
  if (action) {
    conditions.push('action = ?');
    params.push(action);
  }
  const where = ` WHERE ${conditions.join(' AND ')}`;

  const logsSql = `SELECT id, action, target_type, target_id, detail, ip, location, timestamp FROM audit_logs
     ${where} ORDER BY timestamp DESC, id DESC LIMIT ? OFFSET ?`;
  let rows: { results: unknown[] };
  try {
    rows = await c.env.DB.prepare(logsSql).bind(...params, pageSize, offset).all();
  } catch {
    // 迁移 0008 未执行时降级为不含归属地的查询
    rows = await c.env.DB.prepare(logsSql.replace(', location,', ', NULL AS location,'))
      .bind(...params, pageSize, offset)
      .all();
  }

  const total = await c.env.DB.prepare(`SELECT COUNT(*) as total FROM audit_logs${where}`)
    .bind(...params)
    .first<{ total: number }>();

  return jsonResponse({
    logs: rows.results,
    total: total?.total || 0,
    page,
    pageSize,
  });
});

// ========== 用户创建的短链（分页） ==========
users.get('/:id/links', async (c) => {
  const userId = parseInt(c.req.param('id'));
  if (!Number.isFinite(userId)) return jsonResponse({ error: '无效的用户 ID' }, 400);
  const currentUser = c.get('user');

  if (!(await canViewUser(c.env.DB, currentUser, userId))) {
    return jsonResponse({ error: '权限不足' }, 403);
  }

  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const offset = (page - 1) * pageSize;

  const rows = await c.env.DB.prepare(
    `SELECT sl.id, sl.short_code, sl.target_url, sl.name, sl.status, sl.click_count, sl.created_at,
      sl.group_id, d.domain as domain_name, pg.name as group_name
     FROM short_links sl
     LEFT JOIN domains d ON sl.domain_id = d.id
     LEFT JOIN project_groups pg ON sl.group_id = pg.id
     WHERE sl.created_by = ?
     ORDER BY sl.created_at DESC LIMIT ? OFFSET ?`
  ).bind(userId, pageSize, offset).all();

  const total = await c.env.DB.prepare('SELECT COUNT(*) as total FROM short_links WHERE created_by = ?')
    .bind(userId)
    .first<{ total: number }>();

  return jsonResponse({
    links: rows.results,
    total: total?.total || 0,
    page,
    pageSize,
  });
});

export default users;
