export type UserRole = 'super_admin' | 'user'
export type UserStatus = 'active' | 'disabled'
export type ReviewStatus = 'approved' | 'pending' | 'rejected'
export type ReviewBy = 'auto' | 'super_admin'

/** 权限键 → 是否开启 */
export type PermissionMap = Record<string, boolean>

export interface AuthUser {
  id: number
  email: string
  name: string
  role: UserRole
  status: UserStatus
  created_at?: number
  require_review?: number
  review_by?: ReviewBy
  last_login_at?: number | null
  last_login_ip?: string | null
  /** 该用户作为管理员的项目组 id 列表（项目组管理员） */
  managed_group_ids?: number[]
  /** 全局权限 + 各项目组内的有效权限 */
  permissions?: {
    global: PermissionMap
    groups: Record<string, PermissionMap>
  }
}

export interface ProjectGroup {
  id: number
  name: string
  description: string | null
  parent_id: number | null
  created_by: number
  created_at: number
  updated_at: number
  created_by_email?: string
  member_count?: number
  link_count?: number
  my_role?: 'admin' | 'member'
  children?: ProjectGroup[]
}

export interface GroupMember {
  id: number
  email: string
  name: string
  role: UserRole
  status: UserStatus
  group_role: 'admin' | 'member'
  joined_at: number
  last_login_ip?: string | null
  last_login_at?: number | null
  /** 组内短链数量 */
  link_count?: number
  /** 与默认值不同的权限覆盖项 */
  permissions_override?: PermissionMap
  /** 该成员在当前组的有效权限 */
  permissions?: PermissionMap
  permissions_updated_at?: number | null
}

export interface Domain {
  id: number
  domain: string
  type: 'short_link' | 'admin' | 'both'
  is_default_short_link: number
  status: 'active' | 'disabled' | 'pending_verification'
  added_by: number
  created_at: number
  updated_at: number
  added_by_email?: string
}

export interface ShortLink {
  id: number
  short_code: string
  target_url: string
  name: string
  custom_alias: string | null
  status: 'active' | 'disabled' | 'expired'
  redirect_type: number
  created_by: number
  group_id: number | null
  domain_id: number | null
  expires_at: number | null
  click_count: number
  created_at: number
  updated_at: number
  domain_name?: string | null
  creator_name?: string
  creator_email?: string
  group_name?: string | null
  review_status: ReviewStatus
  review_note?: string | null
  reviewed_by?: number | null
  reviewed_at?: number | null
  review_group_id?: number | null
  /** 列表接口返回：当前用户是否有权修改/删除 */
  can_manage?: boolean
}

// 待审核短链（审核列表使用）
export interface ReviewLink extends ShortLink {
  creator_name?: string
  creator_email?: string
  review_group_name?: string | null
}

// 项目组内短链（项目组详情中使用，字段与短链管理一致，便于直接复用详情/编辑）
export type GroupLink = ShortLink

export interface GroupDetail {
  group: ProjectGroup
  members: GroupMember[]
  domains: Domain[]
  links: GroupLink[]
  subGroups: { id: number; name: string; description: string | null }[]
  can_manage: boolean
  is_super_admin: boolean
  /** 当前用户在该组的有效权限 */
  permissions?: PermissionMap
}

export interface AccessRecord {
  timestamp: number
  ip: string | null
  country: string | null
  city: string | null
  referer: string | null
  user_agent: string | null
}

export interface LinkStats {
  link: ShortLink
  trend: { date: string; clicks: number }[]
  referers: { referer: string; count: number }[]
  countries: { country: string; count: number }[]
  browsers: { name: string; count: number }[]
  os: { name: string; count: number }[]
  devices: { name: string; count: number }[]
  recent?: AccessRecord[]
}

export interface OverviewStats {
  total_links: number
  active_links: number
  disabled_links: number
  expired_links: number
  total_users: number
  total_groups: number
  today_clicks: number
  total_clicks: number
}

export interface AuditLog {
  id: number
  user_id: number | null
  user_email?: string | null
  user_name?: string | null
  action: string
  target_type: string | null
  target_id: number | null
  detail: string | null
  ip: string | null
  timestamp: number
}

export interface UserItem {
  id: number
  email: string
  name: string
  role: UserRole
  status: UserStatus
  require_review?: number
  review_by?: ReviewBy
  last_login_at?: number | null
  last_login_ip?: string | null
  created_at: number
  /** 1=已设置密码，0=尚未设置（首次登录时自行设置） */
  password_set?: number
  /** 创建的短链数 / 加入的项目组数 */
  link_count?: number
  group_count?: number
  /** 全局权限覆盖项 */
  global_permissions?: PermissionMap
}

/** 用户所在项目组 */
export interface UserGroupItem {
  id: number
  name: string
  parent_id: number | null
  path: string
  group_role: 'admin' | 'member'
  joined_at: number
  group_permissions?: PermissionMap
}

/** 用户详情（超级管理员 / 本人） */
export interface UserDetail {
  user: UserItem & {
    updated_at?: number
    permissions?: string | null
    global_permissions?: PermissionMap
    managed_group_ids?: number[]
  }
  groups: UserGroupItem[]
  link_summary: { total: number; active: number; clicks: number }
  links: (ShortLink & { group_name?: string | null })[]
  logs: AuditLog[]
  ips: { ip: string; count: number; last_seen: number }[]
  is_self: boolean
}

/** 组成员概览（项目组管理员视角） */
export interface MemberOverview {
  user: UserItem & { last_login_ip?: string | null; last_login_at?: number | null }
  groups: UserGroupItem[]
  link_summary: { total: number; active: number; clicks: number }
  links: (ShortLink & { group_name?: string | null })[]
  scope_group_ids: number[] | null
}

export interface InitStatus {
  initialized: boolean
  site_name: string
  turnstile_site_key: string
}
