// 项目组路由（支持子组、域名分配、成员管理）
//
// 权限约定：
// - 超级管理员：拥有全部权限
// - 项目组管理员（user_group_relations.role = 'admin'）：默认拥有该组全部组内权限，
//   可在自己管理的组下创建子组、为子组绑定父组已有域名、添加/移除成员、
//   设置子组管理员（授予 admin 身份）、为组内/子组成员单独配置权限；
//   继承自父组的域名不能在子组解绑
// - 普通成员：默认可创建短链、查看组内短链、编辑/删除自己的短链
// - 以上默认值均可在「成员权限」中被单独覆盖（user_group_relations.permissions）

import { Hono } from 'hono';
import type { Env, JWTPayload } from '../types';
import { jsonResponse } from '../utils';
import { authMiddleware, requireRole, logAudit } from '../middleware';
import {
  isGroupAdminOf,
  isDirectGroupAdminOf,
  isGroupVisibleToUser,
  getManageableDomainIds,
  isDomainBoundToAncestor,
  getGroupPermissions,
  getGroupPermissionRole,
  hasGroupPermission,
  getManagedGroupIds,
  getManagedScopeIds,
  parsePermissionJson,
  buildPermissionMap,
  GROUP_PERMISSION_KEYS,
} from '../permissions';

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

  // 当前用户在该组的有效权限（前端据此显示按钮）
  const permissions = isSuperAdmin
    ? buildPermissionMap(GROUP_PERMISSION_KEYS, GROUP_PERMISSION_KEYS, {})
    : await getGroupPermissions(c.env.DB, currentUser.user_id, groupId);

  // 成员（附带最后登录 IP、组内权限覆盖项、组内短链数量）
  const membersSql = `SELECT u.id, u.email, u.name, u.role, u.status, u.last_login_ip, u.last_login_at,
      ugr.role as group_role, ugr.created_at as joined_at,
      ugr.permissions as permissions_override, ugr.permissions_updated_at,
      (SELECT COUNT(*) FROM short_links WHERE created_by = u.id AND group_id = ugr.group_id) AS link_count
     FROM user_group_relations ugr
     JOIN users u ON ugr.user_id = u.id
     WHERE ugr.group_id = ?
     ORDER BY CASE ugr.role WHEN 'admin' THEN 0 ELSE 1 END, ugr.created_at ASC`;
  type MemberRow = { id: number; group_role: 'admin' | 'member'; permissions_override: string | null };
  let members: { results: MemberRow[] };
  try {
    members = await c.env.DB.prepare(membersSql).bind(groupId).all<MemberRow>();
  } catch {
    // 迁移未执行（permissions 列不存在）时降级
    members = await c.env.DB.prepare(
      membersSql.replace(
        'ugr.permissions as permissions_override, ugr.permissions_updated_at',
        'NULL AS permissions_override, NULL AS permissions_updated_at',
      ),
    ).bind(groupId).all<MemberRow>();
  }

  // 每个成员在该组的有效权限与生效身份（用于前端显示与配置弹窗初始值 / 默认基线）
  const memberPermissions: Record<number, Record<string, boolean>> = {};
  const memberPermissionRole: Record<number, 'admin' | 'member' | null> = {};
  if (canManage) {
    for (const member of members.results) {
      memberPermissions[member.id] = await getGroupPermissions(c.env.DB, member.id, groupId);
      memberPermissionRole[member.id] = await getGroupPermissionRole(c.env.DB, member.id, groupId);
    }
  }

  // 项目组可用域名（短链类型且启用）
  const domains = await c.env.DB.prepare(
    `SELECT d.id, d.domain, d.type, d.status, d.is_default_short_link
     FROM domains d
     JOIN group_domain_relations gdr ON d.id = gdr.domain_id
     WHERE gdr.group_id = ? AND d.type IN ('short_link', 'both')
     ORDER BY d.is_default_short_link DESC, d.id ASC`
  ).bind(groupId).all();

  // 项目组内的短链（返回编辑所需字段，并标记当前用户是否可操作）
  const links = await c.env.DB.prepare(
    `SELECT sl.id, sl.short_code, sl.target_url, sl.name, sl.custom_alias, sl.status,
      sl.redirect_type, sl.created_by, sl.group_id, sl.domain_id, sl.expires_at,
      sl.click_count, sl.created_at, sl.updated_at, sl.review_status, sl.review_note,
      sl.review_group_id, d.domain as domain_name,
      u.name as creator_name, u.email as creator_email
     FROM short_links sl
     LEFT JOIN domains d ON sl.domain_id = d.id
     LEFT JOIN users u ON sl.created_by = u.id
     WHERE sl.group_id = ?
     ORDER BY sl.created_at DESC
     LIMIT 200`
  ).bind(groupId).all<{ created_by: number }>();

  // 子组：父组级（成员或管理员）都可查看全部子组
  const subGroups = await c.env.DB.prepare(
    'SELECT id, name, description FROM project_groups WHERE parent_id = ?'
  ).bind(groupId).all();

  return jsonResponse({
    group,
    members: members.results.map((member) => ({
      ...member,
      permissions_override: parsePermissionJson(member.permissions_override),
      permissions: memberPermissions[member.id] || {},
      permission_role: memberPermissionRole[member.id] ?? member.group_role,
    })),
    domains: domains.results,
    links: links.results.map((row) => {
      const own = row.created_by === currentUser.user_id;
      const canEditAny = isSuperAdmin || permissions['link.update.any'] === true;
      const canEditOwn = isSuperAdmin || permissions['link.update.own'] === true;
      return { ...row, can_manage: canEditAny || (own && canEditOwn) };
    }),
    subGroups: subGroups.results,
    can_manage: canManage,
    // 是否该组的「直接」管理员（用于前端区分同级管理员：同级之间不能互相改身份/权限/移除）
    is_direct_admin: !isSuperAdmin && (await isDirectGroupAdminOf(c.env.DB, currentUser.user_id, groupId)),
    permissions,
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

// ========== 可绑定到该组的域名（超管：全部短链域名；组管理员：自己管理范围内已绑定的域名） ==========
groups.get('/:id/bindable-domains', async (c) => {
  const groupId = parseInt(c.req.param('id'));
  if (!Number.isFinite(groupId)) return jsonResponse({ error: '无效的项目组 ID' }, 400);
  const currentUser = c.get('user');
  const isSuperAdmin = currentUser.role === 'super_admin';

  const group = await c.env.DB.prepare('SELECT id FROM project_groups WHERE id = ?').bind(groupId).first();
  if (!group) {
    return jsonResponse({ error: '项目组不存在' }, 404);
  }

  if (!isSuperAdmin) {
    if (!(await isGroupAdminOf(c.env.DB, currentUser.user_id, groupId))) {
      return jsonResponse({ error: '权限不足，只有项目组管理员可以绑定域名' }, 403);
    }
    if (!(await hasGroupPermission(c.env.DB, currentUser.user_id, groupId, 'group.domain.manage'))) {
      return jsonResponse({ error: '你没有管理组域名的权限' }, 403);
    }
  }

  // 已绑定到该组的域名不再返回
  const notBoundHere = 'd.id NOT IN (SELECT domain_id FROM group_domain_relations WHERE group_id = ?)';

  if (isSuperAdmin) {
    const rows = await c.env.DB.prepare(
      `SELECT d.id, d.domain, d.status FROM domains d
       WHERE d.type IN ('short_link', 'both') AND ${notBoundHere}
       ORDER BY CASE WHEN d.status = 'active' THEN 0 ELSE 1 END, d.domain ASC`,
    ).bind(groupId).all();

    return jsonResponse({ domains: rows.results });
  }

  // 组管理员只能复用「自己管理范围内已经绑定过」的域名（父组已有的域名）
  const allowedIds = await getManageableDomainIds(c.env.DB, currentUser.user_id);
  if (allowedIds.length === 0) {
    return jsonResponse({ domains: [] });
  }

  const placeholders = allowedIds.map(() => '?').join(',');
  const rows = await c.env.DB.prepare(
    `SELECT d.id, d.domain, d.status FROM domains d
     WHERE d.id IN (${placeholders}) AND d.type IN ('short_link', 'both') AND d.status = 'active'
       AND ${notBoundHere}
     ORDER BY d.domain ASC`,
  ).bind(...allowedIds, groupId).all();

  return jsonResponse({ domains: rows.results });
});

// ========== 创建项目组（超级管理员可建顶级组，项目组管理员仅可在自己管理的组下建子组） ==========
groups.post('/', async (c) => {
  const currentUser = c.get('user');
  const isSuperAdmin = currentUser.role === 'super_admin';
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

  // 非超管只能在「自己担任管理员的组」下创建子组，避免越权建组
  if (!isSuperAdmin) {
    if (!body.parent_id) {
      return jsonResponse({ error: '只有超级管理员可以创建顶级项目组' }, 403);
    }
    if (!(await isGroupAdminOf(c.env.DB, currentUser.user_id, body.parent_id))) {
      return jsonResponse({ error: '只能在自己管理的项目组下创建子组' }, 403);
    }
    if (!(await hasGroupPermission(c.env.DB, currentUser.user_id, body.parent_id, 'group.create_child'))) {
      return jsonResponse({ error: '你没有在该项目组下创建子组的权限' }, 403);
    }
  }

  const result = await c.env.DB.prepare(
    'INSERT INTO project_groups (name, description, parent_id, created_by) VALUES (?, ?, ?, ?)'
  ).bind(body.name, body.description || null, body.parent_id || null, currentUser.user_id).run();

  const groupId = result.meta.last_row_id;

  await logAudit(c.env.DB, currentUser.user_id, 'create_group', c.req.raw, 'group', groupId as number, JSON.stringify(body));

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

  await logAudit(c.env.DB, currentUser.user_id, 'update_group', c.req.raw, 'group', groupId, JSON.stringify(body));

  return jsonResponse({ success: true });
});

// ========== 删除项目组（超级管理员；组管理员可删除自己管理组下的子组） ==========
groups.delete('/:id', async (c) => {
  const groupId = parseInt(c.req.param('id'));
  if (!Number.isFinite(groupId)) return jsonResponse({ error: '无效的项目组 ID' }, 400);
  const currentUser = c.get('user');
  const isSuperAdmin = currentUser.role === 'super_admin';

  const group = await c.env.DB.prepare('SELECT id, name, parent_id FROM project_groups WHERE id = ?')
    .bind(groupId)
    .first<{ id: number; name: string; parent_id: number | null }>();
  if (!group) return jsonResponse({ error: '项目组不存在' }, 404);

  if (!isSuperAdmin) {
    // 组管理员：只能删除「自己管理组的严格下级组」，且需要该组内具备删除子组权限
    const directManaged = await getManagedGroupIds(c.env.DB, currentUser.user_id);
    if (directManaged.includes(groupId)) {
      return jsonResponse({ error: '不能删除自己直接管理的项目组，请联系超级管理员' }, 403);
    }
    const scopeIds = await getManagedScopeIds(c.env.DB, currentUser.user_id);
    if (!scopeIds.includes(groupId)) {
      return jsonResponse({ error: '只能删除自己管理的项目组下的子组' }, 403);
    }
    if (!(await hasGroupPermission(c.env.DB, currentUser.user_id, groupId, 'group.delete'))) {
      return jsonResponse({ error: '没有删除子组的权限' }, 403);
    }
  }

  const subGroups = await c.env.DB.prepare('SELECT COUNT(*) as count FROM project_groups WHERE parent_id = ?').bind(groupId).first<{ count: number }>();
  if (subGroups && subGroups.count > 0) {
    return jsonResponse({ error: '请先删除子项目组' }, 400);
  }

  const linkCount = await c.env.DB.prepare('SELECT COUNT(*) as count FROM short_links WHERE group_id = ?')
    .bind(groupId)
    .first<{ count: number }>();
  if (linkCount && linkCount.count > 0) {
    return jsonResponse({ error: `组内还有 ${linkCount.count} 条短链，请先转移或删除后再删除项目组` }, 400);
  }

  await c.env.DB.prepare('DELETE FROM project_groups WHERE id = ?').bind(groupId).run();

  await logAudit(c.env.DB, currentUser.user_id, 'delete_group', c.req.raw, 'group', groupId, group.name);

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
  if (!isSuperAdmin && !(await hasGroupPermission(c.env.DB, currentUser.user_id, groupId, 'group.member.add'))) {
    return jsonResponse({ error: '你没有添加成员的权限' }, 403);
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

  // 组管理员默认只能添加普通成员；拥有「设置成员身份」权限时可以直接添加子组管理员
  const canGrantAdmin =
    isSuperAdmin || (await hasGroupPermission(c.env.DB, currentUser.user_id, groupId, 'group.member.role'));
  if (body.role === 'admin' && !canGrantAdmin) {
    return jsonResponse({ error: '你没有设置组管理员的权限' }, 403);
  }
  const role: 'admin' | 'member' = body.role === 'admin' ? 'admin' : 'member';

  try {
    await c.env.DB.prepare(
      'INSERT INTO user_group_relations (user_id, group_id, role) VALUES (?, ?, ?)'
    ).bind(body.user_id, groupId, role).run();
  } catch {
    return jsonResponse({ error: '用户已在项目组中' }, 400);
  }

  await logAudit(c.env.DB, currentUser.user_id, 'add_group_member', c.req.raw, 'group', groupId, JSON.stringify(body));

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
  const isSuperAdmin = currentUser.role === 'super_admin';

  if (!isSuperAdmin) {
    if (!(await isGroupAdminOf(c.env.DB, currentUser.user_id, groupId))) {
      return jsonResponse({ error: '权限不足，只有超级管理员或项目组管理员可以调整成员身份' }, 403);
    }
    if (!(await hasGroupPermission(c.env.DB, currentUser.user_id, groupId, 'group.member.role'))) {
      return jsonResponse({ error: '你没有设置成员身份的权限' }, 403);
    }
    if (userId === currentUser.user_id) {
      return jsonResponse({ error: '不能修改自己的组内身份' }, 400);
    }
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

  // 同级组管理员之间不能互相调整身份（升/降都不行），需由上级管理员或超级管理员处理
  if (!isSuperAdmin && target.role === 'admin') {
    if (await isDirectGroupAdminOf(c.env.DB, currentUser.user_id, groupId)) {
      return jsonResponse({ error: '同级组管理员的身份需要由上级管理员或超级管理员调整' }, 403);
    }
  }

  if (target.role === body.role) {
    return jsonResponse({ success: true });
  }

  await c.env.DB.prepare(
    'UPDATE user_group_relations SET role = ? WHERE user_id = ? AND group_id = ?'
  ).bind(body.role, userId, groupId).run();

  await logAudit(
    c.env.DB,
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
  if (!isSuperAdmin && !(await hasGroupPermission(c.env.DB, currentUser.user_id, groupId, 'group.member.remove'))) {
    return jsonResponse({ error: '你没有移除成员的权限' }, 403);
  }

  // 组管理员不能移除自己（避免误操作丢管理权）；超级管理员可以把自己移出组
  if (userId === currentUser.user_id && !isSuperAdmin) {
    return jsonResponse({ error: '不能移除自己，请联系上级管理员或超级管理员' }, 400);
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

  await logAudit(c.env.DB, currentUser.user_id, 'remove_group_member', c.req.raw, 'group', groupId, JSON.stringify({ user_id: userId }));

  return jsonResponse({ success: true });
});

// ========== 绑定域名到项目组（超管任意；组管理员仅限自己管理范围内已有的域名） ==========
groups.post('/:id/domains', async (c) => {
  const groupId = parseInt(c.req.param('id'));
  if (!Number.isFinite(groupId)) return jsonResponse({ error: '无效的项目组 ID' }, 400);
  const currentUser = c.get('user');
  const isSuperAdmin = currentUser.role === 'super_admin';
  const body = await c.req.json<{ domain_id: number }>();

  if (!body.domain_id) {
    return jsonResponse({ error: '请指定域名' }, 400);
  }

  const group = await c.env.DB.prepare('SELECT id FROM project_groups WHERE id = ?').bind(groupId).first();
  if (!group) {
    return jsonResponse({ error: '项目组不存在' }, 404);
  }

  if (!isSuperAdmin) {
    if (!(await isGroupAdminOf(c.env.DB, currentUser.user_id, groupId))) {
      return jsonResponse({ error: '权限不足，只有项目组管理员可以绑定域名' }, 403);
    }
    if (!(await hasGroupPermission(c.env.DB, currentUser.user_id, groupId, 'group.domain.manage'))) {
      return jsonResponse({ error: '你没有管理组域名的权限' }, 403);
    }
    // 只能复用自己管理范围内已绑定的域名，不能凭空绑定全站域名
    const allowedIds = await getManageableDomainIds(c.env.DB, currentUser.user_id);
    if (!allowedIds.includes(body.domain_id)) {
      return jsonResponse({ error: '只能为子组添加自己管理范围内已绑定的域名' }, 403);
    }
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

  await logAudit(c.env.DB, currentUser.user_id, 'bind_group_domain', c.req.raw, 'group', groupId, JSON.stringify(body));

  return jsonResponse({ success: true });
});

// ========== 解绑域名（超管任意；组管理员仅可解绑非继承自父组的域名） ==========
groups.delete('/:id/domains/:domainId', async (c) => {
  const groupId = parseInt(c.req.param('id'));
  const domainId = parseInt(c.req.param('domainId'));
  if (!Number.isFinite(groupId) || !Number.isFinite(domainId)) {
    return jsonResponse({ error: '无效的 ID' }, 400);
  }
  const currentUser = c.get('user');
  const isSuperAdmin = currentUser.role === 'super_admin';

  if (!isSuperAdmin) {
    if (!(await isGroupAdminOf(c.env.DB, currentUser.user_id, groupId))) {
      return jsonResponse({ error: '权限不足，只有项目组管理员可以解绑域名' }, 403);
    }
    if (!(await hasGroupPermission(c.env.DB, currentUser.user_id, groupId, 'group.domain.manage'))) {
      return jsonResponse({ error: '你没有管理组域名的权限' }, 403);
    }
    // 继承自父组的域名由父组统一管理，子组管理员不能直接移除
    if (await isDomainBoundToAncestor(c.env.DB, groupId, domainId)) {
      return jsonResponse({ error: '该域名继承自父组，请在父组解除绑定' }, 403);
    }
  }

  await c.env.DB.prepare('DELETE FROM group_domain_relations WHERE group_id = ? AND domain_id = ?').bind(groupId, domainId).run();

  await logAudit(c.env.DB, currentUser.user_id, 'unbind_group_domain', c.req.raw, 'group', groupId, JSON.stringify({ domain_id: domainId }));

  return jsonResponse({ success: true });
});

// ========== 成员资料概览（超级管理员，或该项目组管理员） ==========
groups.get('/:id/members/:userId/overview', async (c) => {
  const groupId = parseInt(c.req.param('id'));
  const userId = parseInt(c.req.param('userId'));
  if (!Number.isFinite(groupId) || !Number.isFinite(userId)) {
    return jsonResponse({ error: '无效的 ID' }, 400);
  }
  const currentUser = c.get('user');
  const isSuperAdmin = currentUser.role === 'super_admin';

  if (!isSuperAdmin) {
    if (!(await isGroupAdminOf(c.env.DB, currentUser.user_id, groupId))) {
      return jsonResponse({ error: '权限不足' }, 403);
    }
    const allowed =
      (await hasGroupPermission(c.env.DB, currentUser.user_id, groupId, 'group.member.permission')) ||
      (await hasGroupPermission(c.env.DB, currentUser.user_id, groupId, 'link.view.group'));
    if (!allowed) {
      return jsonResponse({ error: '你没有查看成员资料的权限' }, 403);
    }
  }

  const member = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.role, u.status, u.last_login_ip, u.last_login_at, u.created_at,
      ugr.role as group_role, ugr.created_at as joined_at
     FROM user_group_relations ugr
     JOIN users u ON ugr.user_id = u.id
     WHERE ugr.group_id = ? AND ugr.user_id = ?`
  ).bind(groupId, userId).first();

  if (!member) {
    return jsonResponse({ error: '该用户不在项目组中' }, 404);
  }

  // 可见范围：超管为全部组，组管理员为自己管理的组及子组
  const scopeIds = isSuperAdmin ? null : await getManagedScopeIds(c.env.DB, currentUser.user_id);
  const scopePlaceholders = scopeIds ? scopeIds.map(() => '?').join(',') : '';
  const scopeFilter = scopeIds ? ` AND pg.id IN (${scopePlaceholders})` : '';
  const scopeParams: number[] = scopeIds || [];

  const groups = await c.env.DB.prepare(
    `SELECT pg.id, pg.name, pg.parent_id, ugr.role as group_role, ugr.created_at as joined_at
     FROM user_group_relations ugr
     JOIN project_groups pg ON ugr.group_id = pg.id
     WHERE ugr.user_id = ?${scopeFilter}
     ORDER BY pg.id ASC`
  ).bind(userId, ...scopeParams).all<{ id: number; name: string; parent_id: number | null }>();

  // 组路径
  const allGroups = await c.env.DB.prepare('SELECT id, name, parent_id FROM project_groups').all<{
    id: number;
    name: string;
    parent_id: number | null;
  }>();
  const groupMap = new Map(allGroups.results.map((g) => [g.id, g]));
  const pathOf = (id: number, depth = 0): string => {
    const row = groupMap.get(id);
    if (!row || depth > 20) return '';
    const parent = row.parent_id ? pathOf(row.parent_id, depth + 1) : '';
    return parent ? `${parent} / ${row.name}` : row.name;
  };

  const summary = await c.env.DB.prepare(
    `SELECT COUNT(*) as total,
      SUM(CASE WHEN sl.status = 'active' THEN 1 ELSE 0 END) as active,
      SUM(sl.click_count) as clicks
     FROM short_links sl
     JOIN project_groups pg ON sl.group_id = pg.id
     WHERE sl.created_by = ?${scopeFilter}`
  ).bind(userId, ...scopeParams).first<{ total: number; active: number; clicks: number }>();

  const links = await c.env.DB.prepare(
    `SELECT sl.id, sl.short_code, sl.target_url, sl.name, sl.status, sl.click_count, sl.created_at,
      sl.group_id, d.domain as domain_name, pg.name as group_name
     FROM short_links sl
     JOIN project_groups pg ON sl.group_id = pg.id
     LEFT JOIN domains d ON sl.domain_id = d.id
     WHERE sl.created_by = ?${scopeFilter}
     ORDER BY sl.created_at DESC LIMIT 10`
  ).bind(userId, ...scopeParams).all();

  // 最后登录 IP 的归属地（取该用户该 IP 最近一条带归属地的审计记录）
  const lastLoginIp = (member as unknown as { last_login_ip?: string | null }).last_login_ip;
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
    user: { ...(member as Record<string, unknown>), last_login_location: lastLoginLocation },
    groups: groups.results.map((row) => ({ ...row, path: pathOf(row.id) || row.name })),
    link_summary: {
      total: summary?.total || 0,
      active: summary?.active || 0,
      clicks: summary?.clicks || 0,
    },
    links: links.results,
    scope_group_ids: scopeIds,
  });
});

// ========== 配置成员在该组的权限（超级管理员，或具备 group.member.permission 的组管理员） ==========
groups.put('/:id/members/:userId/permissions', async (c) => {
  const groupId = parseInt(c.req.param('id'));
  const userId = parseInt(c.req.param('userId'));
  if (!Number.isFinite(groupId) || !Number.isFinite(userId)) {
    return jsonResponse({ error: '无效的 ID' }, 400);
  }
  const currentUser = c.get('user');
  const isSuperAdmin = currentUser.role === 'super_admin';

  if (!isSuperAdmin) {
    if (!(await isGroupAdminOf(c.env.DB, currentUser.user_id, groupId))) {
      return jsonResponse({ error: '权限不足' }, 403);
    }
    if (!(await hasGroupPermission(c.env.DB, currentUser.user_id, groupId, 'group.member.permission'))) {
      return jsonResponse({ error: '你没有配置成员权限的权限' }, 403);
    }
    if (userId === currentUser.user_id) {
      return jsonResponse({ error: '不能修改自己的权限' }, 400);
    }
  }

  const body = await c.req.json<{ permissions?: Record<string, boolean> }>();
  const incoming = body.permissions || {};

  const target = await c.env.DB.prepare(
    'SELECT role FROM user_group_relations WHERE user_id = ? AND group_id = ?'
  ).bind(userId, groupId).first<{ role: string }>();
  if (!target) {
    return jsonResponse({ error: '该用户不在项目组中' }, 404);
  }

  // 同级组管理员之间不能互相修改权限（上级管理员与超管可以）
  if (!isSuperAdmin && target.role === 'admin') {
    if (await isDirectGroupAdminOf(c.env.DB, currentUser.user_id, groupId)) {
      return jsonResponse({ error: '同级组管理员的权限需要由上级管理员或超级管理员调整' }, 403);
    }
  }

  const overrides: Record<string, boolean> = {};
  for (const key of GROUP_PERMISSION_KEYS) {
    if (incoming[key] !== undefined) overrides[key] = incoming[key] === true;
  }

  await c.env.DB.prepare(
    'UPDATE user_group_relations SET permissions = ?, permissions_updated_at = ? WHERE user_id = ? AND group_id = ?'
  ).bind(JSON.stringify(overrides), Math.floor(Date.now() / 1000), userId, groupId).run();

  await logAudit(
    c.env.DB,
    currentUser.user_id,
    'update_group_member_permissions',
    c.req.raw,
    'group',
    groupId,
    JSON.stringify({ user_id: userId, permissions: overrides }),
  );

  const effective = await getGroupPermissions(c.env.DB, userId, groupId);
  return jsonResponse({ success: true, permissions: overrides, effective });
});

export default groups;
