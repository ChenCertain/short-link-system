// 项目组路由（支持子组、域名分配、成员管理）
//
// 权限约定：
// - 超级管理员：可创建/修改/删除项目组、添加成员、绑定域名
// - 项目组管理员（user_group_relations.role = 'admin'）：可查看组内域名/成员/短链，
//   可移除组内普通成员、审核组内短链；不能添加成员、不能绑定域名、不能创建/删除项目组
// - 普通成员：可查看自己所在项目组的信息与短链

import { Hono } from 'hono';
import type { Env, JWTPayload } from '../types';
import { jsonResponse } from '../utils';
import { authMiddleware, requireRole, logAudit } from '../middleware';
import { isGroupAdminOf, isGroupVisibleToUser } from '../permissions';

const groups = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();

groups.use('*', authMiddleware);

interface GroupRow {
  id: number;
  name: string;
  description: string | null;
  parent_id: number | null;
  created_by: number;
  created_at: number;
  updated_at: number;
  created_by_email?: string;
  member_count?: number;
  link_count?: number;
  my_role?: 'admin' | 'member';
}

// ========== 获取项目组树（含子组） ==========
groups.get('/', async (c) => {
  const currentUser = c.get('user');

  const allGroups = await c.env.DB.prepare(
    `SELECT pg.*, u.email as created_by_email,
      (SELECT COUNT(*) FROM user_group_relations WHERE group_id = pg.id) as member_count,
      (SELECT COUNT(*) FROM short_links WHERE group_id = pg.id) as link_count
     FROM project_groups pg
     JOIN users u ON pg.created_by = u.id
     ORDER BY COALESCE(pg.parent_id, 0) ASC, pg.created_at ASC`
  ).all<GroupRow>();

  const rows = allGroups.results;

  // 超级管理员：看到全部
  if (currentUser.role === 'super_admin') {
    return jsonResponse({ groups: buildGroupTree(rows) });
  }

  // 普通用户 / 组管理员：自己所在组 + 自己管理组的后代 + 所有祖先
  const rels = await c.env.DB.prepare(
    'SELECT group_id, role FROM user_group_relations WHERE user_id = ?'
  ).bind(currentUser.user_id).all<{ group_id: number; role: 'admin' | 'member' }>();

  const byId = new Map(rows.map((g) => [g.id, g]));
  const visible = new Set<number>();
  const myRoleByGroup = new Map<number, 'admin' | 'member'>();

  for (const rel of rels.results) {
    myRoleByGroup.set(rel.group_id, rel.role);
    visible.add(rel.group_id);

    // 父组级（无论成员还是管理员）都能看到全部子组：向下展开所有后代
    let queue = [rel.group_id];
    const seen = new Set<number>();
    while (queue.length) {
      const next: number[] = [];
      for (const gid of queue) {
        if (seen.has(gid)) continue;
        seen.add(gid);
        visible.add(gid);
        for (const g of rows) if (g.parent_id === gid) next.push(g.id);
      }
      queue = next;
    }

    // 添加所有祖先，保证树结构可展示
    let cur = byId.get(rel.group_id)?.parent_id ?? null;
    for (let i = 0; i < 20 && cur; i++) {
      visible.add(cur);
      cur = byId.get(cur)?.parent_id ?? null;
    }
  }

  const filtered = rows
    .filter((g) => visible.has(g.id))
    .map((g) => ({ ...g, my_role: myRoleByGroup.get(g.id) }));

  return jsonResponse({ groups: buildGroupTree(filtered) });
});

// 构建项目组树
function buildGroupTree(flatList: GroupRow[]): Record<string, unknown>[] {
  const map = new Map<number, Record<string, unknown> & { children: Record<string, unknown>[] }>();
  const roots: Record<string, unknown>[] = [];

  for (const item of flatList) {
    map.set(item.id, { ...item, children: [] });
  }

  for (const item of flatList) {
    const node = map.get(item.id)!;
    const parentId = item.parent_id;
    if (parentId && map.has(parentId)) {
      map.get(parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

// ========== 获取项目组详情（成员、域名、短链） ==========
groups.get('/:id', async (c) => {
  const groupId = parseInt(c.req.param('id'));
  if (!Number.isFinite(groupId)) return jsonResponse({ error: '无效的项目组 ID' }, 400);
  const currentUser = c.get('user');

  const group = await c.env.DB.prepare(
    `SELECT pg.*, u.email as created_by_email FROM project_groups pg
     JOIN users u ON pg.created_by = u.id WHERE pg.id = ?`
  ).bind(groupId).first();

  if (!group) {
    return jsonResponse({ error: '项目组不存在' }, 404);
  }

  // 可见性：超管 / 本组成员 / 祖先组成员（父组可见子组）
  const isSuperAdmin = currentUser.role === 'super_admin';
  if (!isSuperAdmin) {
    const member = await c.env.DB.prepare(
      'SELECT id FROM user_group_relations WHERE user_id = ? AND group_id = ?'
    ).bind(currentUser.user_id, groupId).first();
    if (!member && !(await isGroupVisibleToUser(c.env.DB, currentUser.user_id, groupId))) {
      return jsonResponse({ error: '权限不足' }, 403);
    }
  }

  const canManage = isSuperAdmin || await isGroupAdminOf(c.env.DB, currentUser.user_id, groupId);

  // 成员
  const members = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.role, u.status,
      ugr.role as group_role, ugr.created_at as joined_at
     FROM user_group_relations ugr
     JOIN users u ON ugr.user_id = u.id
     WHERE ugr.group_id = ?
     ORDER BY CASE ugr.role WHEN 'admin' THEN 0 ELSE 1 END, ugr.created_at ASC`
  ).bind(groupId).all();

  // 项目组可用域名（短链类型且启用）
  const domains = await c.env.DB.prepare(
    `SELECT d.id, d.domain, d.type, d.status, d.is_default_short_link
     FROM domains d
     JOIN group_domain_relations gdr ON d.id = gdr.domain_id
     WHERE gdr.group_id = ? AND d.type IN ('short_link', 'both')
     ORDER BY d.is_default_short_link DESC, d.id ASC`
  ).bind(groupId).all();

  // 项目组内的短链
  const links = await c.env.DB.prepare(
    `SELECT sl.id, sl.short_code, sl.target_url, sl.name, sl.status, sl.review_status,
      sl.click_count, sl.created_at, sl.expires_at, d.domain as domain_name,
      u.name as creator_name, u.email as creator_email
     FROM short_links sl
     LEFT JOIN domains d ON sl.domain_id = d.id
     LEFT JOIN users u ON sl.created_by = u.id
     WHERE sl.group_id = ?
     ORDER BY sl.created_at DESC
     LIMIT 200`
  ).bind(groupId).all();

  // 子组：父组级（成员或管理员）都可查看全部子组
  const subGroups = await c.env.DB.prepare(
    'SELECT id, name, description FROM project_groups WHERE parent_id = ?'
  ).bind(groupId).all();

  return jsonResponse({
    group,
    members: members.results,
    domains: domains.results,
    links: links.results,
    subGroups: subGroups.results,
    can_manage: canManage,
    is_super_admin: isSuperAdmin,
  });
});

// ========== 项目组可用短链域名（创建短链时选择用） ==========
groups.get('/:id/available-domains', async (c) => {
  const groupId = parseInt(c.req.param('id'));
  if (!Number.isFinite(groupId)) return jsonResponse({ error: '无效的项目组 ID' }, 400);
  const currentUser = c.get('user');

  const group = await c.env.DB.prepare('SELECT id FROM project_groups WHERE id = ?').bind(groupId).first();
  if (!group) {
    return jsonResponse({ error: '项目组不存在' }, 404);
  }

  // 可见性：超管 / 本组成员 / 祖先组成员（父组可见子组）
  if (currentUser.role !== 'super_admin') {
    const isMember = await c.env.DB.prepare(
      'SELECT id FROM user_group_relations WHERE user_id = ? AND group_id = ?'
    ).bind(currentUser.user_id, groupId).first();
    if (!isMember && !(await isGroupVisibleToUser(c.env.DB, currentUser.user_id, groupId))) {
      return jsonResponse({ error: '权限不足' }, 403);
    }
  }

  const domains = await c.env.DB.prepare(
    `SELECT d.id, d.domain, d.is_default_short_link
     FROM domains d
     JOIN group_domain_relations gdr ON d.id = gdr.domain_id
     WHERE gdr.group_id = ? AND d.type IN ('short_link', 'both') AND d.status = 'active'
     ORDER BY d.is_default_short_link DESC, d.id ASC`
  ).bind(groupId).all();

  return jsonResponse({ domains: domains.results });
});

// ========== 创建项目组（仅超级管理员） ==========
groups.post('/', requireRole('super_admin'), async (c) => {
  const currentUser = c.get('user');
  const body = await c.req.json<{
    name: string;
    description?: string;
    parent_id?: number;
  }>();

  if (!body.name) {
    return jsonResponse({ error: '请填写项目组名称' }, 400);
  }

  if (body.parent_id) {
    const parent = await c.env.DB.prepare('SELECT id FROM project_groups WHERE id = ?').bind(body.parent_id).first();
    if (!parent) {
      return jsonResponse({ error: '父项目组不存在' }, 400);
    }
  }

  const result = await c.env.DB.prepare(
    'INSERT INTO project_groups (name, description, parent_id, created_by) VALUES (?, ?, ?, ?)'
  ).bind(body.name, body.description || null, body.parent_id || null, currentUser.user_id).run();

  const groupId = result.meta.last_row_id;

  await logAudit(c.env.DB, c.env.KV, currentUser.user_id, 'create_group', c.req.raw, 'group', groupId as number, JSON.stringify(body));

  return jsonResponse({ success: true, id: groupId }, 201);
});

// ========== 更新项目组（仅超级管理员） ==========
groups.put('/:id', requireRole('super_admin'), async (c) => {
  const groupId = parseInt(c.req.param('id'));
  if (!Number.isFinite(groupId)) return jsonResponse({ error: '无效的项目组 ID' }, 400);
  const currentUser = c.get('user');
  const body = await c.req.json<{ name?: string; description?: string }>();

  const group = await c.env.DB.prepare('SELECT id FROM project_groups WHERE id = ?').bind(groupId).first();
  if (!group) {
    return jsonResponse({ error: '项目组不存在' }, 404);
  }

  const updates: string[] = [];
  const params: (string | number)[] = [];

  if (body.name) { updates.push('name = ?'); params.push(body.name); }
  if (body.description !== undefined) { updates.push('description = ?'); params.push(body.description); }

  if (updates.length === 0) {
    return jsonResponse({ error: '没有需要更新的字段' }, 400);
  }

  updates.push('updated_at = ?');
  params.push(Math.floor(Date.now() / 1000), groupId);

  await c.env.DB.prepare(`UPDATE project_groups SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run();

  await logAudit(c.env.DB, c.env.KV, currentUser.user_id, 'update_group', c.req.raw, 'group', groupId, JSON.stringify(body));

  return jsonResponse({ success: true });
});

// ========== 删除项目组（仅超级管理员） ==========
groups.delete('/:id', requireRole('super_admin'), async (c) => {
  const groupId = parseInt(c.req.param('id'));
  if (!Number.isFinite(groupId)) return jsonResponse({ error: '无效的项目组 ID' }, 400);

  const subGroups = await c.env.DB.prepare('SELECT COUNT(*) as count FROM project_groups WHERE parent_id = ?').bind(groupId).first<{ count: number }>();
  if (subGroups && subGroups.count > 0) {
    return jsonResponse({ error: '请先删除子项目组' }, 400);
  }

  await c.env.DB.prepare('DELETE FROM project_groups WHERE id = ?').bind(groupId).run();

  await logAudit(c.env.DB, c.env.KV, c.get('user').user_id, 'delete_group', c.req.raw, 'group', groupId);

  return jsonResponse({ success: true });
});

// ========== 可添加成员候选列表（超级管理员或项目组管理员） ==========
groups.get('/:id/member-candidates', async (c) => {
  const groupId = parseInt(c.req.param('id'));
  if (!Number.isFinite(groupId)) return jsonResponse({ error: '无效的项目组 ID' }, 400);
  const currentUser = c.get('user');

  const isSuperAdmin = currentUser.role === 'super_admin';
  if (!isSuperAdmin && !(await isGroupAdminOf(c.env.DB, currentUser.user_id, groupId))) {
    return jsonResponse({ error: '权限不足' }, 403);
  }

  const keyword = (c.req.query('search') || '').trim();

  // 项目组管理员不允许浏览全站用户：必须输入对方完整邮箱做精确匹配，且最多返回这一条。
  // 这样既能完成「把某人加进组」，又杜绝枚举/浏览全部用户的越权行为。
  if (!isSuperAdmin) {
    if (!keyword || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(keyword)) {
      return jsonResponse({ users: [], exact_email_required: true });
    }

    const row = await c.env.DB.prepare(
      `SELECT u.id, u.name, u.email FROM users u
       WHERE u.status = 'active'
         AND u.email = ? COLLATE NOCASE
         AND u.id NOT IN (SELECT user_id FROM user_group_relations WHERE group_id = ?)
       LIMIT 1`
    ).bind(keyword, groupId).first<{ id: number; name: string; email: string }>();

    return jsonResponse({ users: row ? [row] : [], exact_email_required: true });
  }

  const like = `%${keyword}%`;

  const rows = await c.env.DB.prepare(
    `SELECT u.id, u.name, u.email FROM users u
     WHERE u.status = 'active'
       AND u.id NOT IN (SELECT user_id FROM user_group_relations WHERE group_id = ?)
       AND (? = '' OR u.name LIKE ? OR u.email LIKE ?)
     ORDER BY u.name ASC
     LIMIT 50`
  ).bind(groupId, keyword, like, like).all<{ id: number; name: string; email: string }>();

  return jsonResponse({ users: rows.results });
});

// ========== 添加成员（超级管理员，或该项目组/其父组的管理员） ==========
groups.post('/:id/members', async (c) => {
  const groupId = parseInt(c.req.param('id'));
  if (!Number.isFinite(groupId)) return jsonResponse({ error: '无效的项目组 ID' }, 400);
  const currentUser = c.get('user');
  const body = await c.req.json<{ user_id: number; role?: 'admin' | 'member' }>();

  const isSuperAdmin = currentUser.role === 'super_admin';
  const isGroupAdmin = isSuperAdmin ? false : await isGroupAdminOf(c.env.DB, currentUser.user_id, groupId);
  if (!isSuperAdmin && !isGroupAdmin) {
    return jsonResponse({ error: '权限不足，只有超级管理员或项目组管理员可以添加成员' }, 403);
  }

  if (!body.user_id) {
    return jsonResponse({ error: '请指定用户' }, 400);
  }

  const group = await c.env.DB.prepare('SELECT id FROM project_groups WHERE id = ?').bind(groupId).first();
  if (!group) {
    return jsonResponse({ error: '项目组不存在' }, 404);
  }

  const user = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(body.user_id).first();
  if (!user) {
    return jsonResponse({ error: '用户不存在' }, 404);
  }

  // 项目组管理员只能添加普通成员，管理员身份需由超级管理员授予
  const role = isSuperAdmin && body.role === 'admin' ? 'admin' : 'member';

  try {
    await c.env.DB.prepare(
      'INSERT INTO user_group_relations (user_id, group_id, role) VALUES (?, ?, ?)'
    ).bind(body.user_id, groupId, role).run();
  } catch {
    return jsonResponse({ error: '用户已在项目组中' }, 400);
  }

  await logAudit(c.env.DB, c.env.KV, currentUser.user_id, 'add_group_member', c.req.raw, 'group', groupId, JSON.stringify(body));

  return jsonResponse({ success: true });
});

// ========== 修改成员组内身份（仅超级管理员） ==========
groups.put('/:id/members/:userId', async (c) => {
  const groupId = parseInt(c.req.param('id'));
  const userId = parseInt(c.req.param('userId'));
  if (!Number.isFinite(groupId) || !Number.isFinite(userId)) {
    return jsonResponse({ error: '无效的 ID' }, 400);
  }

  const currentUser = c.get('user');
  if (currentUser.role !== 'super_admin') {
    return jsonResponse({ error: '权限不足，成员身份需由超级管理员调整' }, 403);
  }

  const body = await c.req.json<{ role?: 'admin' | 'member' }>();
  if (body.role !== 'admin' && body.role !== 'member') {
    return jsonResponse({ error: '身份只能是 admin 或 member' }, 400);
  }

  const target = await c.env.DB.prepare(
    'SELECT role FROM user_group_relations WHERE user_id = ? AND group_id = ?'
  ).bind(userId, groupId).first<{ role: string }>();
  if (!target) {
    return jsonResponse({ error: '该用户不在项目组中' }, 404);
  }

  if (target.role === body.role) {
    return jsonResponse({ success: true });
  }

  await c.env.DB.prepare(
    'UPDATE user_group_relations SET role = ? WHERE user_id = ? AND group_id = ?'
  ).bind(body.role, userId, groupId).run();

  await logAudit(
    c.env.DB,
    c.env.KV,
    currentUser.user_id,
    'update_group_member_role',
    c.req.raw,
    'group',
    groupId,
    JSON.stringify({ user_id: userId, from: target.role, to: body.role }),
  );

  return jsonResponse({ success: true });
});

// ========== 移除成员（超级管理员或该项目组管理员） ==========
groups.delete('/:id/members/:userId', async (c) => {
  const groupId = parseInt(c.req.param('id'));
  const userId = parseInt(c.req.param('userId'));
  if (!Number.isFinite(groupId) || !Number.isFinite(userId)) {
    return jsonResponse({ error: '无效的 ID' }, 400);
  }
  const currentUser = c.get('user');
  const isSuperAdmin = currentUser.role === 'super_admin';
  const isGroupAdmin = isSuperAdmin ? false : await isGroupAdminOf(c.env.DB, currentUser.user_id, groupId);

  if (!isSuperAdmin && !isGroupAdmin) {
    return jsonResponse({ error: '权限不足' }, 403);
  }

  // 不能移除自己
  if (userId === currentUser.user_id) {
    return jsonResponse({ error: '不能移除自己' }, 400);
  }

  const target = await c.env.DB.prepare(
    'SELECT role FROM user_group_relations WHERE user_id = ? AND group_id = ?'
  ).bind(userId, groupId).first<{ role: string }>();
  if (!target) {
    return jsonResponse({ error: '该用户不在项目组中' }, 404);
  }

  // 组管理员不能移除其他管理员（避免互相踢人），只能由超级管理员处理
  if (!isSuperAdmin && target.role === 'admin') {
    return jsonResponse({ error: '项目组管理员成员需由超级管理员移除' }, 403);
  }

  await c.env.DB.prepare('DELETE FROM user_group_relations WHERE user_id = ? AND group_id = ?').bind(userId, groupId).run();

  await logAudit(c.env.DB, c.env.KV, currentUser.user_id, 'remove_group_member', c.req.raw, 'group', groupId, JSON.stringify({ user_id: userId }));

  return jsonResponse({ success: true });
});

// ========== 绑定域名到项目组（仅超级管理员） ==========
groups.post('/:id/domains', requireRole('super_admin'), async (c) => {
  const groupId = parseInt(c.req.param('id'));
  if (!Number.isFinite(groupId)) return jsonResponse({ error: '无效的项目组 ID' }, 400);
  const currentUser = c.get('user');
  const body = await c.req.json<{ domain_id: number }>();

  if (!body.domain_id) {
    return jsonResponse({ error: '请指定域名' }, 400);
  }

  const domain = await c.env.DB.prepare(
    "SELECT id FROM domains WHERE id = ? AND type IN ('short_link', 'both') AND status = 'active'"
  ).bind(body.domain_id).first<{ id: number }>();
  if (!domain) {
    return jsonResponse({ error: '域名不存在、类型不匹配或尚未验证通过' }, 404);
  }

  try {
    await c.env.DB.prepare(
      'INSERT INTO group_domain_relations (group_id, domain_id) VALUES (?, ?)'
    ).bind(groupId, body.domain_id).run();
  } catch {
    return jsonResponse({ error: '域名已绑定到该项目组' }, 400);
  }

  await logAudit(c.env.DB, c.env.KV, currentUser.user_id, 'bind_group_domain', c.req.raw, 'group', groupId, JSON.stringify(body));

  return jsonResponse({ success: true });
});

// ========== 解绑域名（仅超级管理员） ==========
groups.delete('/:id/domains/:domainId', requireRole('super_admin'), async (c) => {
  const groupId = parseInt(c.req.param('id'));
  const domainId = parseInt(c.req.param('domainId'));
  if (!Number.isFinite(groupId) || !Number.isFinite(domainId)) {
    return jsonResponse({ error: '无效的 ID' }, 400);
  }
  const currentUser = c.get('user');

  await c.env.DB.prepare('DELETE FROM group_domain_relations WHERE group_id = ? AND domain_id = ?').bind(groupId, domainId).run();

  await logAudit(c.env.DB, c.env.KV, currentUser.user_id, 'unbind_group_domain', c.req.raw, 'group', groupId, JSON.stringify({ domain_id: domainId }));

  return jsonResponse({ success: true });
});

export default groups;
