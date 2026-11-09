// 权限与审核归属计算
// 说明：系统只有两种全局角色（super_admin / user），
// 「项目组管理员」由 user_group_relations.role = 'admin' 表达，不再使用 project_admin 角色。

export type ReviewBy = 'auto' | 'super_admin';

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

/** 用户是否为任意项目组的管理员 */
export async function isAnyGroupAdmin(db: D1Database, userId: number): Promise<boolean> {
  const row = await db
    .prepare("SELECT id FROM user_group_relations WHERE user_id = ? AND role = 'admin' LIMIT 1")
    .bind(userId)
    .first();
  return !!row;
}

/**
 * 计算短链的审核归属项目组：
 * 从所属组向上找第一个「存在管理员」的组，作为由组管理员审核的依据；
 * 找不到则返回 null，表示由超级管理员审核。
 */
export async function resolveReviewGroupId(db: D1Database, groupId: number | null): Promise<number | null> {
  if (!groupId) return null;
  let current: number | null = groupId;
  for (let i = 0; i < 20 && current; i++) {
    const admin = await db
      .prepare("SELECT group_id FROM user_group_relations WHERE group_id = ? AND role = 'admin' LIMIT 1")
      .bind(current)
      .first();
    if (admin) return current;
    const group: { parent_id: number | null } | null = await db
      .prepare('SELECT parent_id FROM project_groups WHERE id = ?')
      .bind(current)
      .first<{ parent_id: number | null }>();
    current = group?.parent_id ?? null;
  }
  return null;
}

/** 收集某个项目组的审核人邮箱（该组管理员 + 其父组管理员），去重 */
export async function getGroupReviewerEmails(db: D1Database, groupId: number): Promise<string[]> {
  const emails = new Set<string>();
  let current: number | null = groupId;
  for (let i = 0; i < 20 && current; i++) {
    const admins = await db
      .prepare(
        `SELECT u.email FROM user_group_relations ugr
         JOIN users u ON ugr.user_id = u.id
         WHERE ugr.group_id = ? AND ugr.role = 'admin' AND u.status = 'active'`
      )
      .bind(current)
      .all<{ email: string }>();
    for (const row of admins.results) emails.add(row.email);
    const group: { parent_id: number | null } | null = await db
      .prepare('SELECT parent_id FROM project_groups WHERE id = ?')
      .bind(current)
      .first<{ parent_id: number | null }>();
    current = group?.parent_id ?? null;
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
