// 成员管理（组管理员的「用户管理」视图）
//
// 权限约定：
// - 超级管理员：可见全部项目组
// - 项目组管理员：仅可见「自己担任管理员的组 + 全部子组」，不包含上级组与兄弟组
// - 同级组管理员之间不能互相修改身份 / 权限 / 移出（需上级管理员或超管处理）

import { Hono } from 'hono';
import type { Env, JWTPayload } from '../types';
import { jsonResponse } from '../utils';
import { authMiddleware } from '../middleware';
import {
  getManagedGroupIds,
  expandGroupIdsWithDescendants,
  hasGroupPermission,
  getGroupPermissionRole,
  parsePermissionJson,
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
        can_edit_permission: canConfigPermission && !sameLevelAdmin && (!isSelf || isSuperAdmin),
        can_edit_role: canSetRole && !sameLevelAdmin && !isSelf,
        can_remove: canRemoveMember && !sameLevelAdmin && (!isSelf || isSuperAdmin),
      });
    }

    result.push({
      id: gid,
      name: group.name,
      parent_id: group.parent_id,
      path: pathOf(gid) || group.name,
      member_count: groupMembers.length,
      can_config_permission: canConfigPermission,
      can_set_role: canSetRole,
      can_remove_member: canRemoveMember,
      members: groupMembers,
    });
  }

  // 按组路径排序，保证父子组顺序稳定
  result.sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'));

  return jsonResponse({ is_super_admin: isSuperAdmin, groups: result });
});

export default members;
