import type {
  AuditLog,
  AuthUser,
  Domain,
  GroupDetail,
  InitStatus,
  LinkStats,
  MemberOverview,
  OverviewStats,
  PermissionMap,
  ProjectGroup,
  ReviewLink,
  ShortLink,
  StatsGeo,
  StatsScopeInfo,
  TopLinkItem,
  UserDetail,
  UserItem,
} from './types'

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) || ''
const TOKEN_KEY = 'sl_token'

export class ApiError extends Error {
  status: number
  // 后端返回的业务错误码，如 PASSWORD_NOT_SET，用于前端切换对应流程
  code?: string
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

// 登录失效事件，供 AuthContext 监听
export const AUTH_EXPIRED_EVENT = 'sl:auth-expired'

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  if (!(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const resp = await fetch(`${API_BASE}${path}`, { ...options, headers })

  let data: unknown = null
  const text = await resp.text()
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }

  if (!resp.ok) {
    const message =
      (data as { error?: string } | null)?.error ||
      (typeof data === 'string' ? data : `请求失败 (${resp.status})`)
    if (resp.status === 401 && getToken()) {
      clearToken()
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT))
    }
    throw new ApiError(message, resp.status, (data as { code?: string } | null)?.code)
  }

  return data as T
}

const get = <T>(path: string) => request<T>(path)
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
const put = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) })
const del = <T>(path: string) => request<T>(path, { method: 'DELETE' })

// ============ 认证 ============
export const authApi = {
  initStatus: () => get<InitStatus>('/api/auth/init-status'),
  sendCode: (payload: {
    email: string
    password?: string
    purpose?: 'login' | 'init_admin' | 'set_password'
    turnstile_token: string
  }) => post<{ success: boolean; message: string; dev_code?: string }>('/api/auth/send-code', payload),
  init: (payload: { email: string; password: string; name: string; turnstile_token: string; verify_code: string }) =>
    post<{ success: boolean; token: string; user: AuthUser }>('/api/auth/init', payload),
  verifyLogin: (payload: { email: string; password: string; verify_code: string }) =>
    post<{ success: boolean; token: string; user: AuthUser }>('/api/auth/verify-login', payload),
  setupPassword: (payload: { email: string; password: string; verify_code: string }) =>
    post<{ success: boolean; token: string; user: AuthUser }>('/api/auth/setup-password', payload),
  me: () => get<{ user: AuthUser }>('/api/auth/me'),
}

// ============ 个人中心 ============
export interface ProfileUser {
  id: number
  email: string
  name: string
  role: 'super_admin' | 'user'
  status: string
  last_login_at: number | null
  last_login_ip: string | null
  created_at: number
}

export const profileApi = {
  me: () => get<{ user: ProfileUser; password_set: boolean }>('/api/profile'),
  update: (payload: { name?: string; email?: string; verify_code?: string }) =>
    put<{ success: boolean; token?: string; user: ProfileUser }>('/api/profile', payload),
  sendEmailCode: (email: string) =>
    post<{ success: boolean; message: string; dev_code?: string }>('/api/profile/email-code', { email }),
  updatePassword: (payload: { old_password?: string; new_password: string }) =>
    put<{ success: boolean; password_set: boolean }>('/api/profile/password', payload),
}

// ============ 公开 ============
export const publicApi = {
  config: () =>
    get<{ site_name: string; default_redirect_type?: '301' | '302'; turnstile_site_key: string }>(
      '/api/config/public',
    ),
}

// ============ 用户管理 ============
export const usersApi = {
  list: (
    params: {
      page?: number
      pageSize?: number
      search?: string
      /** 按项目组筛选（组及其子组成员都算） */
      groupId?: number
      /** 组内身份：admin / member / none（未加入任何项目组） */
      groupRole?: 'admin' | 'member' | 'none' | ''
      role?: 'super_admin' | 'user' | ''
      status?: 'active' | 'disabled' | ''
    } = {},
  ) => {
    const q = new URLSearchParams()
    if (params.page) q.set('page', String(params.page))
    if (params.pageSize) q.set('pageSize', String(params.pageSize))
    if (params.search) q.set('search', params.search)
    if (params.groupId) q.set('groupId', String(params.groupId))
    if (params.groupRole) q.set('groupRole', params.groupRole)
    if (params.role) q.set('role', params.role)
    if (params.status) q.set('status', params.status)
    return get<{ users: UserItem[]; total: number; page: number; pageSize: number }>(`/api/users?${q}`)
  },
  detail: (id: number) => get<UserDetail>(`/api/users/${id}`),
  logs: (id: number, params: { page?: number; pageSize?: number; action?: string } = {}) => {
    const q = new URLSearchParams()
    if (params.page) q.set('page', String(params.page))
    if (params.pageSize) q.set('pageSize', String(params.pageSize))
    if (params.action) q.set('action', params.action)
    return get<{ logs: AuditLog[]; total: number; page: number; pageSize: number }>(`/api/users/${id}/logs?${q}`)
  },
  links: (id: number, params: { page?: number; pageSize?: number } = {}) => {
    const q = new URLSearchParams()
    if (params.page) q.set('page', String(params.page))
    if (params.pageSize) q.set('pageSize', String(params.pageSize))
    return get<{ links: ShortLink[]; total: number; page: number; pageSize: number }>(`/api/users/${id}/links?${q}`)
  },
  updatePermissions: (id: number, permissions: PermissionMap) =>
    put<{ success: boolean; permissions: PermissionMap; effective: PermissionMap }>(
      `/api/users/${id}/permissions`,
      { permissions },
    ),
  create: (payload: {
    email: string
    password?: string
    name: string
    role: 'super_admin' | 'user'
    require_review?: boolean
    review_by?: 'auto' | 'parent' | 'super_admin'
    /** 可选：创建时直接加入某个项目组 */
    group_id?: number | null
    group_role?: 'admin' | 'member'
  }) => post<{ success: boolean; user: AuthUser }>('/api/users', payload),
  update: (
    id: number,
    payload: {
      name?: string
      role?: 'super_admin' | 'user'
      status?: 'active' | 'disabled'
      password?: string
      require_review?: boolean
      review_by?: 'auto' | 'parent' | 'super_admin'
      },
      ) => put<{ success: boolean }>(`/api/users/${id}`, payload),
  remove: (id: number) => del<{ success: boolean }>(`/api/users/${id}`),
}

// ============ 项目组 ============
export const groupsApi = {
  list: () => get<{ groups: ProjectGroup[] }>('/api/groups'),
  detail: (id: number) => get<GroupDetail>(`/api/groups/${id}`),
  availableDomains: (id: number) =>
    get<{ domains: { id: number; domain: string; is_default_short_link: number }[] }>(
      `/api/groups/${id}/available-domains`,
    ),
  bindableDomains: (id: number) =>
    get<{ domains: { id: number; domain: string; status?: string }[] }>(`/api/groups/${id}/bindable-domains`),
  create: (payload: { name: string; description?: string; parent_id?: number }) =>
    post<{ success: boolean; id: number }>('/api/groups', payload),
  update: (id: number, payload: { name?: string; description?: string }) =>
    put<{ success: boolean }>(`/api/groups/${id}`, payload),
  remove: (id: number) => del<{ success: boolean }>(`/api/groups/${id}`),
  memberCandidates: (id: number, search?: string) =>
    get<{ users: { id: number; name: string; email: string }[] }>(
      `/api/groups/${id}/member-candidates${search ? `?search=${encodeURIComponent(search)}` : ''}`,
    ),
  addMember: (id: number, payload: { user_id: number; role?: 'admin' | 'member' }) =>
    post<{ success: boolean }>(`/api/groups/${id}/members`, payload),
  updateMemberRole: (id: number, userId: number, role: 'admin' | 'member') =>
    put<{ success: boolean }>(`/api/groups/${id}/members/${userId}`, { role }),
  removeMember: (id: number, userId: number) =>
    del<{ success: boolean }>(`/api/groups/${id}/members/${userId}`),
  memberOverview: (id: number, userId: number) =>
    get<MemberOverview>(`/api/groups/${id}/members/${userId}/overview`),
  updateMemberPermissions: (id: number, userId: number, permissions: PermissionMap) =>
    put<{ success: boolean; permissions: PermissionMap; effective: PermissionMap }>(
      `/api/groups/${id}/members/${userId}/permissions`,
      { permissions },
    ),
  bindDomain: (id: number, domainId: number) =>
    post<{ success: boolean }>(`/api/groups/${id}/domains`, { domain_id: domainId }),
  unbindDomain: (id: number, domainId: number) =>
    del<{ success: boolean }>(`/api/groups/${id}/domains/${domainId}`),
}

// ============ 成员管理（组管理员视角：管理范围内的全部组成员） ============
export interface ScopedMember {
  id: number
  email: string
  name: string
  role: string
  status: string
  group_role: 'admin' | 'member'
  permission_role: 'admin' | 'member'
  permissions_override: PermissionMap
  joined_at: number
  last_login_at: number | null
  last_login_ip: string | null
  link_count: number
  is_self: boolean
  /** 该用户创建的短链是否需要审核 */
  require_review: boolean
  /** 审核归属：auto=向上找管理员 / parent=父组管理员 / super_admin=超级管理员 */
  review_by: 'auto' | 'parent' | 'super_admin'
  can_edit_permission: boolean
  can_edit_role: boolean
  can_remove: boolean
  can_config_review: boolean
}

export interface ScopedMemberGroup {
  id: number
  name: string
  parent_id: number | null
  path: string
  member_count: number
  /** 是否为自己直接管理的组（同级组）；子组为 false */
  is_direct: boolean
  can_config_permission: boolean
  can_set_role: boolean
  can_remove_member: boolean
  can_create_user: boolean
  members: ScopedMember[]
}

export const membersApi = {
  scope: () => get<{ is_super_admin: boolean; groups: ScopedMemberGroup[] }>('/api/members/scope'),
  /** 在管理范围内创建用户（同级组只能创建普通成员，子组可创建组管理员） */
  createUser: (payload: {
    name: string
    email: string
    password?: string
    group_id: number
    group_role?: 'admin' | 'member'
    require_review?: boolean
    review_by?: 'auto' | 'parent' | 'super_admin'
  }) => post<{ success: boolean; user: { id: number } }>('/api/members/users', payload),
  /** 设置成员的短链审核方式 */
  updateMemberReview: (
    groupId: number,
    userId: number,
    payload: { require_review?: boolean; review_by?: 'auto' | 'parent' | 'super_admin' },
  ) => put<{ success: boolean }>(`/api/members/groups/${groupId}/members/${userId}/review`, payload),
}

// ============ 域名管理 ============
export const domainsApi = {
  list: () => get<{ domains: Domain[] }>('/api/domains'),
  shortLinkDomains: (groupId?: number) =>
    get<{ domains: { id: number; domain: string; is_default_short_link: number }[] }>(
      `/api/domains/short-link-domains${groupId ? `?groupId=${groupId}` : ''}`,
    ),
  create: (payload: { domain: string; type: 'short_link' | 'admin' | 'both'; is_default_short_link?: boolean }) =>
    post<{
      success: boolean
      id: number
      domain: string
      hosted_on_cloudflare?: boolean
      dns_config: { type: string; name: string; target: string; instructions: string }
    }>('/api/domains', payload),
  workerHost: () => get<{ host: string; available: boolean }>('/api/domains/worker-host'),
  update: (
    id: number,
    payload: { type?: string; status?: string; is_default_short_link?: boolean },
  ) => put<{ success: boolean }>(`/api/domains/${id}`, payload),
  verify: (id: number) =>
    post<{ success: boolean; verified: boolean; message: string; worker_host?: string; hosted_on_cloudflare?: boolean }>(
      `/api/domains/${id}/verify`,
    ),
  remove: (id: number) => del<{ success: boolean }>(`/api/domains/${id}`),
}

// ============ 短链 ============
export const linksApi = {
  list: (
    params: {
      page?: number
      pageSize?: number
      search?: string
      status?: string
      groupId?: number
      domainId?: number
      creatorId?: number
    } = {},
  ) => {
    const q = new URLSearchParams()
    if (params.page) q.set('page', String(params.page))
    if (params.pageSize) q.set('pageSize', String(params.pageSize))
    if (params.search) q.set('search', params.search)
    if (params.status) q.set('status', params.status)
    if (params.groupId) q.set('groupId', String(params.groupId))
    if (params.domainId) q.set('domainId', String(params.domainId))
    if (params.creatorId) q.set('creatorId', String(params.creatorId))
    return get<{ links: ShortLink[]; total: number; page: number; pageSize: number }>(`/api/links?${q}`)
  },
  filterOptions: () =>
    get<{
      groups: { id: number; name: string; parent_id: number | null }[]
      domains: { id: number; domain: string }[]
      creators: { id: number; name: string; email: string }[]
    }>('/api/links/filter-options'),
  detail: (id: number) => get<{ link: ShortLink }>(`/api/links/${id}`),
  create: (payload: {
    target_url: string
    name?: string
    custom_alias?: string
    group_id?: number
    domain_id?: number
    password?: string
    expires_at?: number
    redirect_type?: number
  }) =>
    post<{ success: boolean; id: number; short_code: string; short_url: string; review_status?: 'approved' | 'pending' | 'rejected' }>(
      '/api/links',
      payload,
    ),
  pendingReviews: () => get<{ links: ReviewLink[] }>('/api/links/pending-reviews'),
  review: (id: number, payload: { approved: boolean; note?: string }) =>
    post<{ success: boolean; review_status: 'approved' | 'rejected' }>(`/api/links/${id}/review`, payload),
  update: (
    id: number,
    payload: {
      target_url?: string
      name?: string
      status?: string
      password?: string
      expires_at?: number | null
      redirect_type?: number
      group_id?: number | null
      domain_id?: number | null
      short_code?: string
    },
  ) => put<{ success: boolean; review_status?: string }>(`/api/links/${id}`, payload),
  remove: (id: number) => del<{ success: boolean }>(`/api/links/${id}`),
  batchImport: (links: { target_url: string; name?: string; custom_alias?: string }[]) =>
    post<{ results: { success: boolean; short_code?: string; error?: string; target_url: string }[] }>(
      '/api/links/batch-import',
      { links },
    ),
}

// ============ 统计 ============
const statsQuery = (days: number, groupId?: number | null) =>
  `days=${days}${groupId ? `&groupId=${groupId}` : ''}`

export const statsApi = {
  /** 当前用户可查看的统计范围（超管全站 / 组管理员组内及子组） */
  scope: () => get<StatsScopeInfo>('/api/stats/scope'),
  overview: (groupId?: number | null) =>
    get<OverviewStats>(`/api/stats/overview${groupId ? `?groupId=${groupId}` : ''}`),
  trend: (days = 7, groupId?: number | null) =>
    get<{ trend: { date: string; clicks: number }[] }>(`/api/stats/trend?${statsQuery(days, groupId)}`),
  geo: (days = 7, groupId?: number | null) => get<StatsGeo>(`/api/stats/geo?${statsQuery(days, groupId)}`),
  topLinks: (days = 7, groupId?: number | null, limit = 10) =>
    get<{ links: TopLinkItem[] }>(`/api/stats/top-links?${statsQuery(days, groupId)}&limit=${limit}`),
  link: (id: number, days = 7) => get<LinkStats>(`/api/stats/link/${id}?days=${days}`),
}

// ============ 系统配置 ============
export const configApi = {
  get: () => get<{ config: Record<string, string> }>('/api/config'),
  update: (payload: Record<string, string>) => put<{ success: boolean }>('/api/config', payload),
}

// ============ 操作审计 ============
export const auditApi = {
  list: (params: { page?: number; pageSize?: number; action?: string; userId?: number; keyword?: string } = {}) => {
    const q = new URLSearchParams()
    if (params.page) q.set('page', String(params.page))
    if (params.pageSize) q.set('pageSize', String(params.pageSize))
    if (params.action) q.set('action', params.action)
    if (params.userId) q.set('userId', String(params.userId))
    if (params.keyword) q.set('keyword', params.keyword)
    return get<{ logs: AuditLog[]; total: number; page: number; pageSize: number }>(`/api/audit?${q}`)
  },
}
