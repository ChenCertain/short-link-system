import type { PermissionMap } from './types'

export type PermissionScope = 'group' | 'global'

export interface PermissionDef {
  key: string
  label: string
  description: string
  scope: PermissionScope
  category: string
}

// 与 worker/src/permissions.ts 中的 PERMISSION_DEFS 保持一致
export const PERMISSION_DEFS: PermissionDef[] = [
  // ---- 短链 ----
  { key: 'link.create', label: '创建短链', description: '在组内创建短链', scope: 'group', category: '短链' },
  { key: 'link.view.group', label: '查看组内短链', description: '查看项目组内全部短链与详情', scope: 'group', category: '短链' },
  { key: 'link.update.own', label: '编辑自己的短链', description: '编辑自己创建的短链', scope: 'group', category: '短链' },
  { key: 'link.delete.own', label: '删除自己的短链', description: '删除自己创建的短链', scope: 'group', category: '短链' },
  { key: 'link.update.any', label: '编辑组内任意短链', description: '编辑组内他人创建的短链', scope: 'group', category: '短链' },
  { key: 'link.delete.any', label: '删除组内任意短链', description: '删除组内他人创建的短链', scope: 'group', category: '短链' },
  { key: 'link.review', label: '审核组内短链', description: '通过 / 驳回组内待审核短链', scope: 'group', category: '短链' },
  // ---- 项目组管理 ----
  { key: 'group.create_child', label: '创建子组', description: '在该组下创建子项目组', scope: 'group', category: '项目组管理' },
  { key: 'group.delete', label: '删除子组', description: '删除自己管理组下的子项目组（组内需已清空）', scope: 'group', category: '项目组管理' },
  { key: 'group.domain.manage', label: '管理组域名', description: '为组绑定 / 解绑可用域名', scope: 'group', category: '项目组管理' },
  // ---- 成员管理 ----
  { key: 'group.member.add', label: '添加成员', description: '向组内添加成员', scope: 'group', category: '成员管理' },
  { key: 'group.member.remove', label: '移除成员', description: '将成员移出项目组', scope: 'group', category: '成员管理' },
  { key: 'group.member.role', label: '设置成员身份', description: '设置成员为组管理员（含子组管理员）', scope: 'group', category: '成员管理' },
  { key: 'group.member.permission', label: '配置成员权限', description: '为组内 / 子组成员单独开关权限', scope: 'group', category: '成员管理' },
  { key: 'group.user.create', label: '创建用户', description: '在组内 / 子组内创建新用户', scope: 'group', category: '成员管理' },
  // ---- 全局 ----
  { key: 'user.manage', label: '用户管理', description: '查看用户列表、用户详情与操作记录，配置全局权限', scope: 'global', category: '全局管理' },
  { key: 'audit.view', label: '操作审计', description: '查看全站操作审计日志', scope: 'global', category: '全局管理' },
]

export const GROUP_PERMISSION_DEFS = PERMISSION_DEFS.filter((p) => p.scope === 'group')
export const GLOBAL_PERMISSION_DEFS = PERMISSION_DEFS.filter((p) => p.scope === 'global')
export const GROUP_PERMISSION_KEYS = GROUP_PERMISSION_DEFS.map((p) => p.key)
export const GLOBAL_PERMISSION_KEYS = GLOBAL_PERMISSION_DEFS.map((p) => p.key)

/** 普通成员默认权限（与后端 MEMBER_DEFAULT_PERMISSIONS 一致） */
export const MEMBER_DEFAULT_KEYS = ['link.create', 'link.view.group', 'link.update.own', 'link.delete.own']

/** 组管理员默认拥有全部组内权限 */
export const ADMIN_DEFAULT_KEYS = GROUP_PERMISSION_KEYS

/** 按分类分组，便于渲染权限勾选列表 */
export function groupByCategory(defs: PermissionDef[]): { category: string; items: PermissionDef[] }[] {
  const order: string[] = []
  const bucket = new Map<string, PermissionDef[]>()
  for (const def of defs) {
    if (!bucket.has(def.category)) {
      bucket.set(def.category, [])
      order.push(def.category)
    }
    bucket.get(def.category)!.push(def)
  }
  return order.map((category) => ({ category, items: bucket.get(category)! }))
}

/** 某身份的默认权限表 */
export function defaultPermissionMap(role: 'admin' | 'member', scope: PermissionScope = 'group'): PermissionMap {
  if (scope === 'global') return {}
  const defaults = role === 'admin' ? ADMIN_DEFAULT_KEYS : MEMBER_DEFAULT_KEYS
  const map: PermissionMap = {}
  for (const key of GROUP_PERMISSION_KEYS) map[key] = defaults.includes(key)
  return map
}

/** 安全读取某项权限 */
export function can(map: PermissionMap | undefined | null, key: string): boolean {
  return map?.[key] === true
}

/** 从权限表里提取与默认值不同的项（用于提交覆盖项） */
export function diffFromDefaults(map: PermissionMap, role: 'admin' | 'member'): PermissionMap {
  const defaults = defaultPermissionMap(role)
  const overrides: PermissionMap = {}
  for (const key of GROUP_PERMISSION_KEYS) {
    if ((map[key] === true) !== (defaults[key] === true)) overrides[key] = map[key] === true
  }
  return overrides
}
