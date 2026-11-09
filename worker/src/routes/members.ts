// 成员管理（组管理员的「用户管理」视图）
//
// 权限约定：
// - 超级管理员：可见全部项目组
// - 项目组管理员：仅可见「自己担任管理员的组 + 全部子组」，不包含上级组与兄弟组
// - 同级组管理员之间不能互相修改身份 / 权限 / 移出（需上级管理员或超管处理）

import { Hono } from 'hono';
import type { Env, JWTPayload } from '../types';
import { jsonResponse, hashPassword } from '../utils';
import { authMiddleware, logAudit } from '../middleware';
import {
  getManagedGroupIds,
  expandGroupIdsWithDescendants,
  hasGroupPermission,
  getGroupPermissionRole,
  parsePermissionJson,
  resolveReviewGroupId,
} from '../permissions';

const members = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();

members.use('*', authMiddleware);

interface GroupRow {
  id: number;
  name: string;
  parent_id: number | null;
}

interface MemberRow {
  group_id: number;
  group_role: 'admin' | 'member';
  permissions_override: string | null;
  joined_at: number;
  id: number;
  email: string;
  name: string;
  role: string;
  status: string;
  last_login_at: number | null;
  last_login_ip: string | null;
  link_count: number;
  require_review: number;
  review_by: string;
}

// ========== 管理范围内的组成员（按组分类） ==========
members.get('/scope', async (c) => {
  const currentUser = c.get('user');
  const isSuperAdmin = currentUser.role === 'super_admin';

  const allGroups = await c.env.DB.prepare('SELECT id, name, parent_id FROM project_groups').all<GroupRow>();
  const byId = new Map(allGroups.results.map((g) => [g.id, g]));

  const pathOf = (id: number, depth = 0): string => {
    const row = byId.get(id);
    if (!row || depth > 20) return '';
    const parent = row.parent_id ? pathOf(row.parent_id, depth + 1) : '';
    return parent ? `${parent} / ${row.name}` : row.name;
  };

  let scopeIds: number[];
  if (isSuperAdmin) {
    scopeIds = allGroups.results.map((g) => g.id);
  } else {
    const managed = await getManagedGroupIds(c.env.DB, currentUser.user_id);
    if (managed.length === 0) {
      return jsonResponse({ is_super_admin: false, groups: [] });
    }
    scopeIds = await expandGroupIdsWithDescendants(c.env.DB, managed);
  }

  if (scopeIds.length === 0) {
    return jsonResponse({ is_super_admin: isSuperAdmin, groups: [] });
  }

  const placeholders = scopeIds.map(() => '?').join(',');
  const rows = await c.env.DB.prepare(
    `SELECT ugr.group_id, ugr.role as group_role, ugr.permissions as permissions_override, ugr.created_at as joined_at,
      u.id, u.email, u.name, u.role, u.status, u.last_login_at, u.last_login_ip,
      u.require_review, u.review_by,
      (SELECT COUNT(*) FROM short_links WHERE created_by = u.id AND group_id = ugr.group_id) AS link_count
     FROM user_group_relations ugr
     JOIN users u ON ugr.user_id = u.id
     WHERE ugr.group_id IN (${placeholders})
     ORDER BY CASE ugr.role WHEN 'admin' THEN 0 ELSE 1 END, ugr.created_at ASC`,
  )
    .bind(...scopeIds)
    .all<MemberRow>();

  const byGroup = new Map<number, MemberRow[]>();
  for (const row of rows.results) {
    const list = byGroup.get(row.group_id) || [];
    list.push(row);
    byGroup.set(row.group_id, list);
  }

  // 批量计算：当前用户在哪些组是「直接管理员」，用于同级判断
  const directAdminGroups = new Set<number>();
  if (!isSuperAdmin) {
    const rels = await c.env.DB.prepare(
      "SELECT group_id FROM user_group_relations WHERE user_id = ? AND role = 'admin'",
    )
      .bind(currentUser.user_id)
      .all<{ group_id: number }>();
    for (const rel of rels.results) directAdminGroups.add(rel.group_id);
  }

  const result = [];
  for (const gid of scopeIds) {
    const group = byId.get(gid);
    if (!group) continue;

    const canConfigPermission =
      isSuperAdmin || (await hasGroupPermission(c.env.DB, currentUser.user_id, gid, 'group.member.permission'));
    const canSetRole =
      isSuperAdmin || (await hasGroupPermission(c.env.DB, currentUser.user_id, gid, 'group.member.role'));
    const canRemoveMember =
      isSuperAdmin || (await hasGroupPermission(c.env.DB, currentUser.user_id, gid, 'group.member.remove'));
    const isDirect = directAdminGroups.has(gid);

    const groupMembers = [];
    for (const row of byGroup.get(gid) || []) {
      const permissionRole = await getGroupPermissionRole(c.env.DB, row.id, gid);
      const isSelf = row.id === currentUser.user_id;
      // 同级管理员（我直接管这个组，对方也是管理员）之间不能互相操作
      const sameLevelAdmin = isDirect && row.group_role === 'admin' && !isSuperAdmin;
      groupMembers.push({
        id: row.id,
        email: row.email,
        name: row.name,
        role: row.role,
        status: row.status,
        group_role: row.group_role,
        permission_role: permissionRole || row.group_role,
        permissions_override: parsePermissionJson(row.permissions_override),
        joined_at: row.joined_at,
        last_login_at: row.last_login_at,
        last_login_ip: row.last_login_ip,
        link_count: row.link_count,
        is_self: isSelf,
        require_review: !!row.require_review,
        review_by: row.review_by || 'auto',
        can_edit_permission: canConfigPermission && !sameLevelAdmin && (!isSelf || isSuperAdmin),
        can_edit_role: canSetRole && !sameLevelAdmin && !isSelf,
        can_remove: canRemoveMember && !sameLevelAdmin && (!isSelf || isSuperAdmin),
        // 审核方式是该用户的全局设置；普通用户不能改自己，同级管理员需上级处理
        can_config_review:
          canConfigPermission &&
          !sameLevelAdmin &&
          (!isSelf || isSuperAdmin) &&
          row.role !== 'super_admin',
      });
    }

    result.push({
      id: gid,
      name: group.name,
      parent_id: group.parent_id,
      path: pathOf(gid) || group.name,
      member_count: groupMembers.length,
      is_direct: isDirect,
      can_config_permission: canConfigPermission,
      can_set_role: canSetRole,
      can_remove_member: canRemoveMember,
      can_create_user:
        isSuperAdmin || (await hasGroupPermission(c.env.DB, currentUser.user_id, gid, 'group.user.create')),
      members: groupMembers,
    });
  }

  // 按组路径排序，保证父子组顺序稳定
  result.sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'));

  return jsonResponse({ is_super_admin: isSuperAdmin, groups: result });
});

// ========== 创建用户（组管理员在自己的管理范围内创建） ==========
members.post('/users', async (c) => {
  const currentUser = c.get('user');
  const isSuperAdmin = currentUser.role === 'super_admin';
  const body = await c.req.json<{
    name: string;
    email: string;
    password?: string;
    group_id: number;
    group_role?: 'admin' | 'member';
    require_review?: boolean;
    review_by?: 'auto' | 'parent' | 'super_admin';
  }>();

  const name = (body.name || '').trim();
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  const groupId = Number(body.group_id);
  const groupRole: 'admin' | 'member' = body.group_role === 'admin' ? 'admin' : 'member';
  const requireReview = body.require_review === false ? 0 : 1;
  const reviewBy =
    body.review_by === 'super_admin' ? 'super_admin' : body.review_by === 'parent' ? 'parent' : 'auto';

  if (!name || !email) return jsonResponse({ error: '请填写姓名和邮箱' }, 400);
  if (password && password.length < 8) return jsonResponse({ error: '密码长度至少 8 位' }, 400);
  if (!Number.isFinite(groupId)) return jsonResponse({ error: '请选择目标项目组' }, 400);

  const group = await c.env.DB.prepare('SELECT id, name FROM project_groups WHERE id = ?')
    .bind(groupId)
    .first<{ id: number; name: string }>();
  if (!group) return jsonResponse({ error: '项目组不存在' }, 404);

  if (!isSuperAdmin) {
    const managed = await getManagedGroupIds(c.env.DB, currentUser.user_id);
    const scope = await expandGroupIdsWithDescendants(c.env.DB, managed);
    if (!scope.includes(groupId)) {
      return jsonResponse({ error: '只能在自己管理的项目组或子组内创建用户' }, 403);
    }
    if (!(await hasGroupPermission(c.env.DB, currentUser.user_id, groupId, 'group.user.create'))) {
      return jsonResponse({ error: '你没有创建用户的权限' }, 403);
    }
    // 同级组（自己直接管理的组）只能创建普通成员；组管理员只能在子组内设置
    if (managed.includes(groupId) && groupRole === 'admin') {
      return jsonResponse({ error: '同级组内只能创建普通成员，组管理员请在子组内设置' }, 403);
    }
  }

  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return jsonResponse({ error: '该邮箱已被使用' }, 400);

  const passwordHash = password ? await hashPassword(password) : '';
  const result = await c.env.DB.prepare(
    'INSERT INTO users (email, password_hash, name, role, status, require_review, review_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).bind(email, passwordHash, name, 'user', 'active', requireReview, reviewBy).run();

  const userId = result.meta.last_row_id;
  await c.env.DB.prepare('INSERT INTO user_group_relations (user_id, group_id, role) VALUES (?, ?, ?)')
    .bind(userId, groupId, groupRole)
    .run();

  await logAudit(c.env.DB, currentUser.user_id, 'create_user', c.req.raw, 'user', userId as number, JSON.stringify({
    email,
    name,
    group_id: groupId,
    group_role: groupRole,
    require_review: requireReview,
    review_by: reviewBy,
  }));

  return jsonResponse({
    success: true,
    user: {
      id: userId,
      email,
      name,
      role: 'user',
      status: 'active',
      group_id: groupId,
      group_role: groupRole,
      require_review: requireReview,
      review_by: reviewBy,
      password_set: password ? 1 : 0,
    },
  }, 201);
});

// ========== 设置成员短链的审核方式（子组管理员审核 / 父组管理员审核 / 超级管理员审核） ==========
members.put('/groups/:groupId/members/:userId/review', async (c) => {
  const groupId = parseInt(c.req.param('groupId'));
  const userId = parseInt(c.req.param('userId'));
  if (!Number.isFinite(groupId) || !Number.isFinite(userId)) {
    return jsonResponse({ error: '无效的 ID' }, 400);
  }

  const currentUser = c.get('user');
  const isSuperAdmin = currentUser.role === 'super_admin';
  const body = await c.req.json<{
    require_review?: boolean;
    review_by?: 'auto' | 'parent' | 'super_admin';
  }>();

  if (!isSuperAdmin) {
    const managed = await getManagedGroupIds(c.env.DB, currentUser.user_id);
    const scope = await expandGroupIdsWithDescendants(c.env.DB, managed);
    if (!scope.includes(groupId)) {
      return jsonResponse({ error: '只能配置自己管理范围内的成员' }, 403);
    }
    if (!(await hasGroupPermission(c.env.DB, currentUser.user_id, groupId, 'group.member.permission'))) {
      return jsonResponse({ error: '你没有配置成员审核方式的权限' }, 403);
    }
  }

  const relation = await c.env.DB.prepare('SELECT role FROM user_group_relations WHERE user_id = ? AND group_id = ?')
    .bind(userId, groupId)
    .first<{ role: 'admin' | 'member' }>();
  if (!relation) return jsonResponse({ error: '该用户不属于此项目组' }, 404);

  const target = await c.env.DB.prepare('SELECT role FROM users WHERE id = ?')
    .bind(userId)
    .first<{ role: string }>();
  if (!target) return jsonResponse({ error: '用户不存在' }, 404);
  if (target.role === 'super_admin') {
    return jsonResponse({ error: '超级管理员创建的短链无需审核' }, 400);
  }

  // 同级管理员之间不能互相配置审核方式（需上级管理员或超级管理员）
  if (!isSuperAdmin && relation.role === 'admin') {
    const managed = await getManagedGroupIds(c.env.DB, currentUser.user_id);
    if (managed.includes(groupId) && userId !== currentUser.user_id) {
      return jsonResponse({ error: '同级组管理员的审核方式需由上级管理员或超级管理员配置' }, 403);
    }
  }

  const updates: string[] = [];
  const params: (string | number)[] = [];
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
  if (updates.length === 0) return jsonResponse({ error: '没有需要更新的字段' }, 400);

  await c.env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...params, userId)
    .run();

  // 配置变更后立即同步该用户「待审核短链」的审核归属
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

  await logAudit(c.env.DB, currentUser.user_id, 'update_member_review', c.req.raw, 'user', userId, JSON.stringify({
    group_id: groupId,
    ...body,
  }));

  return jsonResponse({ success: true });
});

export default members;
