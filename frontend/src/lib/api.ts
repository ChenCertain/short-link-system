import type {
  AuditLog,
  AuthUser,
  Domain,
  GroupDetail,
  InitStatus,
  LinkStats,
  OverviewStats,
  ProjectGroup,
  PublicLink,
  ReviewLink,
  ShortLink,
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
  homeLinks: () => get<{ site_name: string; links: PublicLink[] }>('/api/public/links'),
  config: () => get<{ site_name: string; turnstile_site_key: string }>('/api/config/public'),
}

// ============ 用户管理 ============
export const usersApi = {
  list: (params: { page?: number; pageSize?: number; search?: string } = {}) => {
    const q = new URLSearchParams()
    if (params.page) q.set('page', String(params.page))
    if (params.pageSize) q.set('pageSize', String(params.pageSize))
    if (params.search) q.set('search', params.search)
    return get<{ users: UserItem[]; total: number; page: number; pageSize: number }>(`/api/users?${q}`)
  },
  detail: (id: number) =>
    get<{ user: AuthUser; groups: { id: number; name: string; parent_id: number | null; group_role: string }[] }>(`/api/users/${id}`),
  create: (payload: {
    email: string
    password?: string
    name: string
    role: 'super_admin' | 'user'
    require_review?: boolean
    review_by?: 'auto' | 'super_admin'
  }) => post<{ success: boolean; user: AuthUser }>('/api/users', payload),
  update: (
    id: number,
    payload: {
      name?: string
      role?: 'super_admin' | 'user'
      status?: 'active' | 'disabled'
      password?: string
      require_review?: boolean
      review_by?: 'auto' | 'super_admin'
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
  bindDomain: (id: number, domainId: number) =>
    post<{ success: boolean }>(`/api/groups/${id}/domains`, { domain_id: domainId }),
  unbindDomain: (id: number, domainId: number) =>
    del<{ success: boolean }>(`/api/groups/${id}/domains/${domainId}`),
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
  toggleDisplay: (id: number, displayed: boolean, order?: number) =>
    post<{ success: boolean }>(`/api/links/${id}/display`, { displayed, order }),
  batchImport: (links: { target_url: string; name?: string; custom_alias?: string }[]) =>
    post<{ results: { success: boolean; short_code?: string; error?: string; target_url: string }[] }>(
      '/api/links/batch-import',
      { links },
    ),
}

// ============ 统计 ============
export const statsApi = {
  overview: () => get<OverviewStats>('/api/stats/overview'),
  trend: (days = 7) => get<{ trend: { date: string; clicks: number }[] }>(`/api/stats/trend?days=${days}`),
  link: (id: number, days = 7) => get<LinkStats>(`/api/stats/link/${id}?days=${days}`),
}

// ============ 系统配置 ============
export const configApi = {
  get: () => get<{ config: Record<string, string> }>('/api/config'),
  update: (payload: Record<string, string>) => put<{ success: boolean }>('/api/config', payload),
}

// ============ 操作审计 ============
export const auditApi = {
  list: (params: { page?: number; pageSize?: number; action?: string } = {}) => {
    const q = new URLSearchParams()
    if (params.page) q.set('page', String(params.page))
    if (params.pageSize) q.set('pageSize', String(params.pageSize))
    if (params.action) q.set('action', params.action)
    return get<{ logs: AuditLog[]; total: number; page: number; pageSize: number }>(`/api/audit?${q}`)
  },
}
