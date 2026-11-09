// 权限与审核归属计算
// 说明：系统只有两种全局角色（super_admin / user），
// 「项目组管理员」由 user_group_relations.role = 'admin' 表达，不再使用 project_admin 角色。

export type ReviewBy = 'auto' | 'parent' | 'super_admin';

/** 用户作为管理员管理的项目组 id 列表（不含父组继承） */
export async function getManagedGroupIds(db: D1Database, userId: number): Promise<number[]> {
  const rows = await db
    .prepare("SELECT group_id FROM user_group_relations WHERE user_id = ? AND role = 'admin'")
    .bind(userId)
    .all<{ group_id: number }>();
  return rows.results.map((r) => r.group_id);
}

/** 用户是否属于该组 */
export async function isGroupMember(db: D1Database, userId: number, groupId: number): Promise<boolean> {
  const row = await db
    .prepare('SELECT id FROM user_group_relations WHERE user_id = ? AND group_id = ?')
    .bind(userId, groupId)
    .first();
  return !!row;
}

/** 用户是否是该组的管理员（含父组管理员，父组管理员可管理子组） */
export async function isGroupAdminOf(db: D1Database, userId: number, groupId: number): Promise<boolean> {
  let current: number | null = groupId;
  for (let i = 0; i < 20 && current; i++) {
    const admin = await db
      .prepare("SELECT id FROM user_group_relations WHERE user_id = ? AND group_id = ? AND role = 'admin'")
      .bind(userId, current)
      .first();
    if (admin) return true;
    const group: { parent_id: number | null } | null = await db
      .prepare('SELECT parent_id FROM project_groups WHERE id = ?')
      .bind(current)
      .first<{ parent_id: number | null }>();
    current = group?.parent_id ?? null;
  }
  return false;
}

/**
 * 用户是否是该组的「直接」管理员（关系记录直接挂在当前组上）。
 * 用于区分「同级管理员」与「上级（父组）管理员」：
 * 同级管理员之间不能互相修改身份 / 权限 / 移出，必须由上级管理员或超级管理员处理。
 */
export async function isDirectGroupAdminOf(db: D1Database, userId: number, groupId: number): Promise<boolean> {
  const row = await db
    .prepare("SELECT id FROM user_group_relations WHERE user_id = ? AND group_id = ? AND role = 'admin'")
    .bind(userId, groupId)
    .first();
  return !!row;
}

/** 把一组项目组 id 展开为「自身 + 所有后代组」 */
export async function expandGroupIdsWithDescendants(db: D1Database, rootIds: number[]): Promise<number[]> {
  if (rootIds.length === 0) return [];

  const all = await db
    .prepare('SELECT id, parent_id FROM project_groups')
    .all<{ id: number; parent_id: number | null }>();

  const result = new Set<number>(rootIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const g of all.results) {
      if (g.parent_id && result.has(g.parent_id) && !result.has(g.id)) {
        result.add(g.id);
        changed = true;
      }
    }
  }
  return [...result];
}

/** 用户可见的项目组：自己加入的组 + 自己管理的组，均包含全部子组 */
export async function getVisibleGroupIds(db: D1Database, userId: number): Promise<number[]> {
  const rels = await db
    .prepare('SELECT group_id, role FROM user_group_relations WHERE user_id = ?')
    .bind(userId)
    .all<{ group_id: number; role: string }>();

  const roots = new Set<number>();
  for (const rel of rels.results) roots.add(rel.group_id);
  if (roots.size === 0) return [];

  return expandGroupIdsWithDescendants(db, [...roots]);
}

/** 用户管理范围内的项目组：担任管理员的组 + 全部子组 */
export async function getManagedScopeIds(db: D1Database, userId: number): Promise<number[]> {
  const managed = await getManagedGroupIds(db, userId);
  return expandGroupIdsWithDescendants(db, managed);
}

/** 用户管理范围内已经绑定的短链域名 id（父组已有的域名，子组管理员可继续授权给子组） */
export async function getManageableDomainIds(db: D1Database, userId: number): Promise<number[]> {
  const groupIds = await getManagedScopeIds(db, userId);
  if (groupIds.length === 0) return [];
  const rows = await db
    .prepare(
      `SELECT DISTINCT domain_id FROM group_domain_relations
       WHERE group_id IN (${groupIds.map(() => '?').join(',')})`,
    )
    .bind(...groupIds)
    .all<{ domain_id: number }>();
  return rows.results.map((r) => r.domain_id);
}

/** 读取项目组的父组 id */
export async function getParentId(db: D1Database, groupId: number): Promise<number | null> {
  const group = await db
    .prepare('SELECT parent_id FROM project_groups WHERE id = ?')
    .bind(groupId)
    .first<{ parent_id: number | null }>();
  return group?.parent_id ?? null;
}

/** 域名是否绑定在某个严格祖先组上（继承来的域名不应由子组管理员直接解绑） */
export async function isDomainBoundToAncestor(
  db: D1Database,
  groupId: number,
  domainId: number,
): Promise<boolean> {
  let current = await getParentId(db, groupId);
  for (let i = 0; i < 20 && current; i++) {
    const bound = await db
      .prepare('SELECT id FROM group_domain_relations WHERE group_id = ? AND domain_id = ?')
      .bind(current, domainId)
      .first();
    if (bound) return true;
    current = await getParentId(db, current);
  }
  return false;
}

/**
 * 用户是否能查看某个项目组：超级管理员、该组成员，
 * 或任一祖先组的成员 / 管理员（父组可见子组）
 */
export async function isGroupVisibleToUser(db: D1Database, userId: number, groupId: number): Promise<boolean> {
  let current: number | null = groupId;
  for (let i = 0; i < 20 && current; i++) {
    const rel = await db
      .prepare('SELECT id FROM user_group_relations WHERE user_id = ? AND group_id = ?')
      .bind(userId, current)
      .first();
    if (rel) return true;
    const group: { parent_id: number | null } | null = await db
      .prepare('SELECT parent_id FROM project_groups WHERE id = ?')
      .bind(current)
      .first<{ parent_id: number | null }>();
    current = group?.parent_id ?? null;
  }
  return false;
}

/** 组内是否存在「具备审核权限」的管理员（组管理员默认拥有 link.review，可被单独关闭） */
async function groupHasReviewer(db: D1Database, groupId: number): Promise<boolean> {
  const admins = await db
    .prepare("SELECT user_id FROM user_group_relations WHERE group_id = ? AND role = 'admin'")
    .bind(groupId)
    .all<{ user_id: number }>();
  for (const admin of admins.results) {
    if (await hasGroupPermission(db, admin.user_id, groupId, 'link.review')) return true;
  }
  return false;
}

/**
 * 计算短链的审核归属项目组：
 * 按 review_by 模式从所属组（或父组）向上找第一个「存在有审核权限管理员」的组；
 * 找不到则返回 null，表示由超级管理员审核。
 */
export async function resolveReviewGroupId(
  db: D1Database,
  groupId: number | null,
  mode: 'auto' | 'parent' = 'auto',
): Promise<number | null> {
  if (!groupId) return null;
  let current: number | null = mode === 'parent' ? await getParentId(db, groupId) : groupId;
  for (let i = 0; i < 20 && current; i++) {
    if (await groupHasReviewer(db, current)) return current;
    current = await getParentId(db, current);
  }
  return null;
}

/** 收集某个项目组的审核人邮箱（该组及祖先组中「具备审核权限」的管理员），去重 */
export async function getGroupReviewerEmails(db: D1Database, groupId: number): Promise<string[]> {
  const emails = new Set<string>();
  let current: number | null = groupId;
  for (let i = 0; i < 20 && current; i++) {
    const admins = await db
      .prepare(
        `SELECT u.id, u.email FROM user_group_relations ugr
         JOIN users u ON ugr.user_id = u.id
         WHERE ugr.group_id = ? AND ugr.role = 'admin' AND u.status = 'active'`
      )
      .bind(current)
      .all<{ id: number; email: string }>();
    for (const admin of admins.results) {
      if (await hasGroupPermission(db, admin.id, current, 'link.review')) emails.add(admin.email);
    }
    current = await getParentId(db, current);
  }
  return [...emails];
}

/** 超级管理员邮箱列表 */
export async function getSuperAdminEmails(db: D1Database): Promise<string[]> {
  const rows = await db
    .prepare("SELECT email FROM users WHERE role = 'super_admin' AND status = 'active'")
    .all<{ email: string }>();
  return rows.results.map((r) => r.email);
}

// ==========================================================
// 细粒度权限
// 组内权限（scope = group）：作用域为「某个项目组」，成员 / 组管理员有不同默认值
// 全局权限（scope = global）：由超级管理员为单个用户在「用户管理」中配置
// ==========================================================

export type PermissionScope = 'group' | 'global';

export interface PermissionDef {
  key: string;
  label: string;
  description: string;
  scope: PermissionScope;
  category: string;
}

export const PERMISSION_DEFS: PermissionDef[] = [
  // ---- 短链 ----
  { key: 'link.create', label: '创建短链', description: '在组内创建短链', scope: 'group', category: '短链' },
  { key: 'link.view.group', label: '查看组内短链', description: '查看项目组内全部短链与详情', scope: 'group', category: '短链' },
  { key: 'link.view.data', label: '查看短链数据', description: '查看组内短链的点击趋势、来源、地区与访问明细（含访问者 IP）', scope: 'group', category: '短链' },
  { key: 'link.update.own', label: '编辑自己的短链', description: '编辑自己创建的短链', scope: 'group', category: '短链' },
  { key: 'link.delete.own', label: '删除自己的短链', description: '删除自己创建的短链', scope: 'group', category: '短链' },
  { key: 'link.update.any', label: '编辑组内任意短链', description: '编辑组内他人创建的短链', scope: 'group', category: '短链' },
  { key: 'link.delete.any', label: '删除组内任意短链', description: '删除组内他人创建的短链', scope: 'group', category: '短链' },
  { key: 'link.review', label: '审核组内短链', description: '通过 / 驳回组内待审核短链', scope: 'group', category: '短链' },
  // ---- 项目组管理 ----
  { key: 'group.create_child', label: '创建子组', description: '在该组下创建子项目组', scope: 'group', category: '项目组管理' },
  { key: 'group.delete', label: '删除子组', description: '删除自己管理组下的子项目组（组内需已清空）', scope: 'group', category: '项目组管理' },
  { key: 'group.domain.manage', label: '管理组域名', description: '为组绑定 / 解绑可用域名', scope: 'group', category: '项目组管理' },
  { key: 'group.member.add', label: '添加成员', description: '向组内添加成员', scope: 'group', category: '成员管理' },
  { key: 'group.member.remove', label: '移除成员', description: '将成员移出项目组', scope: 'group', category: '成员管理' },
  { key: 'group.member.role', label: '设置成员身份', description: '设置成员为组管理员（含子组管理员）', scope: 'group', category: '成员管理' },
  { key: 'group.member.permission', label: '配置成员权限', description: '为组内 / 子组成员单独开关权限', scope: 'group', category: '成员管理' },
  { key: 'group.user.create', label: '创建用户', description: '在组内 / 子组内创建新用户', scope: 'group', category: '成员管理' },
  // ---- 全局 ----
  { key: 'user.manage', label: '用户管理', description: '查看用户列表、用户详情与操作记录，配置全局权限', scope: 'global', category: '全局管理' },
  { key: 'audit.view', label: '操作审计', description: '查看全站操作审计日志', scope: 'global', category: '全局管理' },
];

export const GROUP_PERMISSION_KEYS: string[] = PERMISSION_DEFS.filter((p) => p.scope === 'group').map((p) => p.key);
export const GLOBAL_PERMISSION_KEYS: string[] = PERMISSION_DEFS.filter((p) => p.scope === 'global').map((p) => p.key);

/** 普通成员默认权限 */
export const MEMBER_DEFAULT_PERMISSIONS: string[] = [
  'link.create',
  'link.view.group',
  'link.update.own',
  'link.delete.own',
];
/** 组管理员默认拥有全部组内权限 */
export const ADMIN_DEFAULT_PERMISSIONS: string[] = GROUP_PERMISSION_KEYS;

/** 解析 JSON 权限字段，非法内容按空对象处理 */
export function parsePermissionJson(raw: string | null | undefined): Record<string, boolean> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'boolean') result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
}

/** 默认值 + 覆盖项 → 完整权限表 */
export function buildPermissionMap(
  keys: string[],
  defaults: string[],
  overrides: Record<string, boolean>,
): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const key of keys) {
    map[key] = overrides[key] !== undefined ? overrides[key] : defaults.includes(key);
  }
  return map;
}

/**
 * 用户在指定项目组内的有效权限。
 * 组管理员（含父组管理员）的权限沿祖链生效：子组内没有直接关系时，向上找最近的关联记录。
 */
export async function getGroupPermissions(
  db: D1Database,
  userId: number,
  groupId: number | null,
): Promise<Record<string, boolean>> {
  if (!groupId) {
    return buildPermissionMap(GROUP_PERMISSION_KEYS, [], {});
  }

  // 沿父组链向上扫描：最近的一条关联记录提供权限覆盖项，
  // 只要链上任意一层是管理员，就按管理员默认权限（与 isGroupAdminOf 保持一致，
  // 避免父组管理员同时是子组普通成员时丢失管理权限）。
  let nearest: { role: 'admin' | 'member'; permissions: string | null } | null = null;
  let isAdmin = false;
  let current: number | null = groupId;
  for (let i = 0; i < 20 && current; i++) {
    let row: { role: 'admin' | 'member'; permissions: string | null } | null = null;
    try {
      row = await db
        .prepare('SELECT role, permissions FROM user_group_relations WHERE user_id = ? AND group_id = ?')
        .bind(userId, current)
        .first<{ role: 'admin' | 'member'; permissions: string | null }>();
    } catch {
      // 迁移未执行（缺少 permissions 列）时降级为仅按身份使用默认权限
      const basic = await db
        .prepare('SELECT role FROM user_group_relations WHERE user_id = ? AND group_id = ?')
        .bind(userId, current)
        .first<{ role: 'admin' | 'member' }>();
      row = basic ? { role: basic.role, permissions: null } : null;
    }
    if (row) {
      if (!nearest) nearest = row;
      if (row.role === 'admin') isAdmin = true;
    }
    current = await getParentId(db, current);
  }

  if (nearest) {
    const defaults = isAdmin ? ADMIN_DEFAULT_PERMISSIONS : MEMBER_DEFAULT_PERMISSIONS;
    return buildPermissionMap(GROUP_PERMISSION_KEYS, defaults, parsePermissionJson(nearest.permissions));
  }

  return buildPermissionMap(GROUP_PERMISSION_KEYS, [], {});
}

/**
 * 用户在组内的生效身份：只要父组链上任意一层是管理员，即视为管理员（与 getGroupPermissions 一致）。
 * 用于前端判断「默认权限基线」，未加入该组返回 null。
 */
export async function getGroupPermissionRole(
  db: D1Database,
  userId: number,
  groupId: number | null,
): Promise<'admin' | 'member' | null> {
  if (!groupId) return null;
  let current: number | null = groupId;
  let found = false;
  for (let i = 0; i < 20 && current; i++) {
    const row = await db
      .prepare('SELECT role FROM user_group_relations WHERE user_id = ? AND group_id = ?')
      .bind(userId, current)
      .first<{ role: 'admin' | 'member' }>();
    if (row) {
      found = true;
      if (row.role === 'admin') return 'admin';
    }
    current = await getParentId(db, current);
  }
  return found ? 'member' : null;
}

/**
 * 批量计算多个用户在指定项目组内的有效权限与生效身份。
 * 组详情页需要为每个成员展示权限，逐成员调用 getGroupPermissions 会产生
 * 「成员数 × 祖链层数」次串行查询，这里统一为两次查询。
 */
export async function getGroupPermissionsForMembers(
  db: D1Database,
  userIds: number[],
  groupId: number | null,
): Promise<Record<number, { permissions: Record<string, boolean>; role: 'admin' | 'member' | null }>> {
  const result: Record<number, { permissions: Record<string, boolean>; role: 'admin' | 'member' | null }> = {};
  if (!groupId || userIds.length === 0) {
    for (const userId of userIds) {
      result[userId] = { permissions: buildPermissionMap(GROUP_PERMISSION_KEYS, [], {}), role: null };
    }
    return result;
  }

  // 祖链（含自身，最多 20 层）
  const groups = await db
    .prepare('SELECT id, parent_id FROM project_groups')
    .all<{ id: number; parent_id: number | null }>();
  const parentOf = new Map<number, number | null>();
  for (const group of groups.results) parentOf.set(group.id, group.parent_id);

  const chain: number[] = [];
  let current: number | null = groupId;
  for (let i = 0; i < 20 && current; i++) {
    chain.push(current);
    current = parentOf.get(current) ?? null;
  }

  type RelationRow = { user_id: number; group_id: number; role: 'admin' | 'member'; permissions: string | null };
  let relations: RelationRow[] = [];
  const placeholders = chain.map(() => '?').join(',');
  try {
    const rows = await db
      .prepare(
        `SELECT user_id, group_id, role, permissions FROM user_group_relations WHERE group_id IN (${placeholders})`,
      )
      .bind(...chain)
      .all<RelationRow>();
    relations = rows.results;
  } catch {
    // 迁移未执行（缺少 permissions 列）时降级为仅按身份使用默认权限
    const rows = await db
      .prepare(`SELECT user_id, group_id, role FROM user_group_relations WHERE group_id IN (${placeholders})`)
      .bind(...chain)
      .all<{ user_id: number; group_id: number; role: 'admin' | 'member' }>();
    relations = rows.results.map((row) => ({ ...row, permissions: null }));
  }

  const relationOf = new Map<string, RelationRow>();
  for (const relation of relations) relationOf.set(`${relation.user_id}:${relation.group_id}`, relation);

  const depthOf = new Map<number, number>();
  chain.forEach((id, index) => depthOf.set(id, index));

  for (const userId of userIds) {
    let nearest: RelationRow | null = null;
    let isAdmin = false;
    let found = false;
    for (const id of chain) {
      const relation = relationOf.get(`${userId}:${id}`);
      if (!relation) continue;
      found = true;
      if (!nearest || (depthOf.get(id) ?? 0) < (depthOf.get(nearest.group_id) ?? 0)) nearest = relation;
      if (relation.role === 'admin') isAdmin = true;
    }

    if (!found || !nearest) {
      result[userId] = { permissions: buildPermissionMap(GROUP_PERMISSION_KEYS, [], {}), role: null };
      continue;
    }
    const defaults = isAdmin ? ADMIN_DEFAULT_PERMISSIONS : MEMBER_DEFAULT_PERMISSIONS;
    result[userId] = {
      permissions: buildPermissionMap(GROUP_PERMISSION_KEYS, defaults, parsePermissionJson(nearest.permissions)),
      role: isAdmin ? 'admin' : 'member',
    };
  }

  return result;
}

/** 判断用户在组内是否具备某项权限（超管由调用方先行短路） */
export async function hasGroupPermission(
  db: D1Database,
  userId: number,
  groupId: number | null,
  key: string,
): Promise<boolean> {
  const perms = await getGroupPermissions(db, userId, groupId);
  return perms[key] === true;
}

/**
 * 批量筛出用户具备某项权限的项目组（语义与 getGroupPermissions 一致，沿父组链继承）。
 * 列表查询时一次性完成过滤，避免逐组发起多次查询。
 */
export async function filterGroupsWithPermission(
  db: D1Database,
  userId: number,
  groupIds: number[],
  key: string,
): Promise<number[]> {
  if (groupIds.length === 0) return [];

  const groups = await db
    .prepare('SELECT id, parent_id FROM project_groups')
    .all<{ id: number; parent_id: number | null }>();
  const parentOf = new Map<number, number | null>();
  for (const group of groups.results) parentOf.set(group.id, group.parent_id);

  type RelationRow = { group_id: number; role: 'admin' | 'member'; permissions: string | null };
  let relations: RelationRow[] = [];
  try {
    const rows = await db
      .prepare('SELECT group_id, role, permissions FROM user_group_relations WHERE user_id = ?')
      .bind(userId)
      .all<RelationRow>();
    relations = rows.results;
  } catch {
    // 迁移未执行（缺少 permissions 列）时降级为仅按身份使用默认权限
    const rows = await db
      .prepare('SELECT group_id, role FROM user_group_relations WHERE user_id = ?')
      .bind(userId)
      .all<{ group_id: number; role: 'admin' | 'member' }>();
    relations = rows.results.map((row) => ({ ...row, permissions: null }));
  }
  const relationOf = new Map<number, RelationRow>();
  for (const relation of relations) relationOf.set(relation.group_id, relation);

  const result: number[] = [];
  for (const groupId of groupIds) {
    let nearest: RelationRow | null = null;
    let isAdmin = false;
    let current: number | null = groupId;
    for (let i = 0; i < 20 && current; i++) {
      const relation = relationOf.get(current) ?? null;
      if (relation) {
        if (!nearest) nearest = relation;
        if (relation.role === 'admin') isAdmin = true;
      }
      current = parentOf.get(current) ?? null;
    }
    if (!nearest) continue;

    const defaults = isAdmin ? ADMIN_DEFAULT_PERMISSIONS : MEMBER_DEFAULT_PERMISSIONS;
    const perms = buildPermissionMap(GROUP_PERMISSION_KEYS, defaults, parsePermissionJson(nearest.permissions));
    if (perms[key] === true) result.push(groupId);
  }
  return result;
}

/** 用户全局权限（超级管理员全开） */
export async function getGlobalPermissions(db: D1Database, userId: number): Promise<Record<string, boolean>> {
  let user: { role: string; permissions: string | null } | null = null;
  try {
    user = await db
      .prepare('SELECT role, permissions FROM users WHERE id = ?')
      .bind(userId)
      .first<{ role: string; permissions: string | null }>();
  } catch {
    // 迁移未执行（缺少 permissions 列）时降级为无全局权限
    const basic = await db
      .prepare('SELECT role FROM users WHERE id = ?')
      .bind(userId)
      .first<{ role: string }>();
    user = basic ? { role: basic.role, permissions: null } : null;
  }
  if (!user) return buildPermissionMap(GLOBAL_PERMISSION_KEYS, [], {});
  if (user.role === 'super_admin') {
    return buildPermissionMap(GLOBAL_PERMISSION_KEYS, GLOBAL_PERMISSION_KEYS, {});
  }
  return buildPermissionMap(GLOBAL_PERMISSION_KEYS, [], parsePermissionJson(user.permissions));
}

/** 判断用户是否具备某项全局权限 */
export async function hasGlobalPermission(db: D1Database, userId: number, key: string): Promise<boolean> {
  const perms = await getGlobalPermissions(db, userId);
  return perms[key] === true;
}
