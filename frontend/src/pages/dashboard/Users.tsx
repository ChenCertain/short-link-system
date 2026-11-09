import { useCallback, useEffect, useState } from 'react'
import { ExternalLink, Eye, Pencil, Plus, Search, ShieldCheck, Trash2 } from 'lucide-react'
import { groupsApi, linksApi, usersApi } from '@/lib/api'
import type {
  AuditLog,
  PermissionMap,
  ProjectGroup,
  ReviewBy,
  ShortLink,
  UserDetail,
  UserItem,
  UserRole,
  UserStatus,
} from '@/lib/types'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorText,
  Input,
  Label,
  LoadingBlock,
  Modal,
  Select,
  Spinner,
  StatusBadge,
} from '@/components/ui'
import { EditLinkModal } from '@/components/EditLinkModal'
import { PermissionEditor } from '@/components/PermissionEditor'
import { useToast } from '@/components/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { actionLabel, describeDetail, targetTypeLabel } from '@/lib/audit'
import { GLOBAL_PERMISSION_DEFS } from '@/lib/permissions'
import { formatDateTime, ROLE_LABELS } from '@/lib/utils'

type DetailTab = 'overview' | 'links' | 'logs' | 'permissions'

/** 把组树拍平为「带缩进的下拉选项」 */
function flattenGroupOptions(groups: ProjectGroup[], depth = 0): { id: number; label: string }[] {
  const result: { id: number; label: string }[] = []
  for (const group of groups) {
    result.push({ id: group.id, label: `${'　'.repeat(depth)}${depth > 0 ? '└ ' : ''}${group.name}` })
    if (group.children?.length) result.push(...flattenGroupOptions(group.children, depth + 1))
  }
  return result
}

const roleTone = (role: string) => (role === 'super_admin' ? 'purple' : 'gray') as 'purple' | 'gray'

export default function Users() {
  const { user } = useAuth()
  const { show } = useToast()

  const [users, setUsers] = useState<UserItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // 筛选：项目组 / 组内身份 / 角色 / 状态
  const [filterGroupId, setFilterGroupId] = useState(0)
  const [filterGroupRole, setFilterGroupRole] = useState<'admin' | 'member' | 'none' | ''>('')
  const [filterRole, setFilterRole] = useState<'super_admin' | 'user' | ''>('')
  const [filterStatus, setFilterStatus] = useState<'active' | 'disabled' | ''>('')
  const [groupOptions, setGroupOptions] = useState<{ id: number; label: string }[]>([])
  const [groups, setGroups] = useState<ProjectGroup[]>([])

  // 详情内短链的编辑 / 删除
  const [editingLink, setEditingLink] = useState<ShortLink | null>(null)
  const [deletingLink, setDeletingLink] = useState<ShortLink | null>(null)
  const [linkDeleteLoading, setLinkDeleteLoading] = useState(false)

  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState<{
    name: string
    email: string
    password: string
    role: UserRole
    require_review: boolean
    review_by: ReviewBy
  }>({
    name: '',
    email: '',
    password: '',
    role: 'user',
    // 新建用户默认开启短链审核
    require_review: true,
    review_by: 'auto',
  })
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  const [editing, setEditing] = useState<UserItem | null>(null)
  const [editForm, setEditForm] = useState<{
    name: string
    role: UserRole
    status: UserStatus
    password: string
    require_review: boolean
    review_by: ReviewBy
  }>({
    name: '',
    role: 'user',
    status: 'active',
    password: '',
    require_review: true,
    review_by: 'auto',
  })
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState('')

  // 删除确认（不使用 window.confirm，兼容内嵌浏览器）
  const [deleting, setDeleting] = useState<UserItem | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  // ============ 用户详情 ============
  const [detail, setDetail] = useState<UserDetail | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [tab, setTab] = useState<DetailTab>('overview')

  // 详情内的短链分页
  const [detailLinks, setDetailLinks] = useState<ShortLink[]>([])
  const [linksTotal, setLinksTotal] = useState(0)
  const [linksPage, setLinksPage] = useState(1)
  const [linksLoading, setLinksLoading] = useState(false)

  // 详情内的操作记录分页
  const [detailLogs, setDetailLogs] = useState<AuditLog[]>([])
  const [logsTotal, setLogsTotal] = useState(0)
  const [logsPage, setLogsPage] = useState(1)
  const [logsLoading, setLogsLoading] = useState(false)

  // 全局权限编辑
  const [permValue, setPermValue] = useState<PermissionMap>({})
  const [permSaving, setPermSaving] = useState(false)

  const isSuperAdmin = user?.role === 'super_admin'
  // 最高权限账户（站点初始化时创建的超级管理员）：只有它本身能管理其他超级管理员
  const isRoot = user?.is_root === true
  const detailPageSize = 10

  const pageSize = 20
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await usersApi.list({
        page,
        pageSize,
        search,
        groupId: filterGroupId || undefined,
        groupRole: filterGroupRole || undefined,
        role: filterRole || undefined,
        status: filterStatus || undefined,
      })
      setUsers(data.users)
      setTotal(data.total)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [page, search, filterGroupId, filterGroupRole, filterRole, filterStatus])

  useEffect(() => {
    void load()
  }, [load])

  // 项目组下拉（用于筛选）
  useEffect(() => {
    if (!isSuperAdmin) return
    groupsApi
      .list()
      .then((data) => {
        setGroups(data.groups)
        setGroupOptions(flattenGroupOptions(data.groups))
      })
      .catch(() => undefined)
  }, [isSuperAdmin])

  const resetCreateForm = () =>
    setCreateForm({
      name: '',
      email: '',
      password: '',
      role: 'user',
      require_review: true,
      review_by: 'auto',
    })

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreateError('')
    if (!createForm.name.trim() || !createForm.email.trim()) {
      setCreateError('请填写用户名和邮箱')
      return
    }
    if (createForm.password && createForm.password.length < 8) {
      setCreateError('密码长度至少 8 位')
      return
    }
    setCreating(true)
    try {
      await usersApi.create({
        name: createForm.name.trim(),
        email: createForm.email.trim(),
        password: createForm.password || undefined,
        role: createForm.role,
        require_review: createForm.require_review,
        review_by: createForm.review_by,
      })
      show('用户创建成功', 'success')
      setCreateOpen(false)
      resetCreateForm()
      void load()
    } catch (err) {
      setCreateError((err as Error).message)
    } finally {
      setCreating(false)
    }
  }

  const openEdit = (u: UserItem) => {
    setEditing(u)
    setEditError('')
    setEditForm({
      name: u.name,
      role: u.role,
      status: u.status,
      password: '',
      require_review: !!u.require_review,
      review_by: u.review_by || 'auto',
    })
  }

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editing) return
    setEditError('')
    setSaving(true)
    try {
      await usersApi.update(editing.id, {
        name: editForm.name,
        role: editForm.role,
        status: editForm.status,
        password: editForm.password || undefined,
        require_review: editForm.require_review,
        review_by: editForm.review_by,
      })
      show('用户信息已更新', 'success')
      setEditing(null)
      void load()
    } catch (err) {
      setEditError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const loadDetailLinks = async (userId: number, targetPage: number) => {
    setLinksLoading(true)
    try {
      const data = await usersApi.links(userId, { page: targetPage, pageSize: detailPageSize })
      setDetailLinks(data.links)
      setLinksTotal(data.total)
      setLinksPage(data.page)
    } catch (err) {
      show((err as Error).message, 'error')
    } finally {
      setLinksLoading(false)
    }
  }

  const loadDetailLogs = async (userId: number, targetPage: number) => {
    setLogsLoading(true)
    try {
      const data = await usersApi.logs(userId, { page: targetPage, pageSize: detailPageSize })
      setDetailLogs(data.logs)
      setLogsTotal(data.total)
      setLogsPage(data.page)
    } catch (err) {
      show((err as Error).message, 'error')
    } finally {
      setLogsLoading(false)
    }
  }

  const openDetail = async (u: UserItem, initialTab: DetailTab = 'overview') => {
    setDetailOpen(true)
    setTab(initialTab)
    setDetailLoading(true)
    setDetailError('')
    setDetail(null)
    setDetailLinks([])
    setDetailLogs([])
    try {
      const data = await usersApi.detail(u.id)
      setDetail(data)
      setPermValue(data.user.global_permissions || {})
      if (initialTab === 'links') void loadDetailLinks(u.id, 1)
      if (initialTab === 'logs') void loadDetailLogs(u.id, 1)
    } catch (err) {
      setDetailError((err as Error).message)
    } finally {
      setDetailLoading(false)
    }
  }

  const switchTab = (next: DetailTab) => {
    setTab(next)
    if (!detail) return
    if (next === 'links' && detailLinks.length === 0) void loadDetailLinks(detail.user.id, 1)
    if (next === 'logs' && detailLogs.length === 0) void loadDetailLogs(detail.user.id, 1)
  }

  const handleSavePermissions = async () => {
    if (!detail) return
    setPermSaving(true)
    try {
      const data = await usersApi.updatePermissions(detail.user.id, permValue)
      setPermValue(data.effective)
      setDetail({ ...detail, user: { ...detail.user, global_permissions: data.permissions } })
      show('权限已保存', 'success')
    } catch (err) {
      show((err as Error).message, 'error')
    } finally {
      setPermSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleting) return
    setDeleteLoading(true)
    try {
      await usersApi.remove(deleting.id)
      show('用户已删除', 'success')
      setDeleting(null)
      void load()
    } catch (err) {
      show((err as Error).message, 'error')
    } finally {
      setDeleteLoading(false)
    }
  }

  const handleDeleteLink = async () => {
    if (!deletingLink || !detail) return
    setLinkDeleteLoading(true)
    try {
      await linksApi.remove(deletingLink.id)
      show('短链已删除', 'success')
      setDeletingLink(null)
      void loadDetailLinks(detail.user.id, linksPage)
      void load()
    } catch (err) {
      show((err as Error).message, 'error')
    } finally {
      setLinkDeleteLoading(false)
    }
  }

  const resetFilters = () => {
    setSearch('')
    setFilterGroupId(0)
    setFilterGroupRole('')
    setFilterRole('')
    setFilterStatus('')
    setPage(1)
  }

  const hasFilter = !!(search || filterGroupId || filterGroupRole || filterRole || filterStatus)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">用户管理</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            共 {total} 位用户 · 账户只能由超级管理员创建，项目组管理员在项目组内设置
          </p>
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
            最高权限账户（站点初始化时创建的超级管理员）可以管理其他超级管理员，其他超级管理员不能修改或移除它
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setCreateOpen(true)
            setCreateError('')
          }}
        >
          <Plus className="h-4 w-4" />
          创建用户
        </Button>
      </div>

      <Card>
        <div className="border-b border-gray-100 px-4 py-3 dark:border-gray-800">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                className="pl-9"
                placeholder="搜索邮箱或姓名"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(1)
                }}
              />
            </div>
            <Select
              className="h-10 w-44"
              value={filterGroupId}
              onChange={(e) => {
                const next = Number(e.target.value)
                setFilterGroupId(next)
                if (next > 0) setFilterGroupRole('')
                setPage(1)
              }}
              title="按项目组筛选（含其子组）"
            >
              <option value={0}>全部项目组</option>
              {groupOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </Select>
            <Select
              className="h-10 w-36"
              value={filterGroupRole}
              onChange={(e) => {
                setFilterGroupRole(e.target.value as typeof filterGroupRole)
                setPage(1)
              }}
            >
              <option value="">组内身份不限</option>
              {filterGroupId > 0 ? (
                <>
                  <option value="admin">组管理员</option>
                  <option value="member">组内成员</option>
                </>
              ) : (
                <option value="none">未加入任何组</option>
              )}
            </Select>
            <Select
              className="h-10 w-32"
              value={filterRole}
              onChange={(e) => {
                setFilterRole(e.target.value as typeof filterRole)
                setPage(1)
              }}
            >
              <option value="">全部角色</option>
              <option value="super_admin">超级管理员</option>
              <option value="user">普通用户</option>
            </Select>
            <Select
              className="h-10 w-32"
              value={filterStatus}
              onChange={(e) => {
                setFilterStatus(e.target.value as typeof filterStatus)
                setPage(1)
              }}
            >
              <option value="">全部状态</option>
              <option value="active">正常</option>
              <option value="disabled">已停用</option>
            </Select>
            {hasFilter && (
              <Button variant="ghost" size="sm" onClick={resetFilters}>
                清除筛选
              </Button>
            )}
          </div>
        </div>

        {error && <div className="px-4 pt-3"><ErrorText>{error}</ErrorText></div>}

        {loading ? (
          <LoadingBlock />
        ) : users.length === 0 ? (
          <EmptyState title="暂无用户" description="点击右上角「创建用户」添加账户" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">姓名 / 邮箱</th>
                    <th className="px-4 py-3 font-medium">角色</th>
                    <th className="px-4 py-3 font-medium">状态</th>
                    <th className="px-4 py-3 font-medium">最后登录</th>
                    <th className="hidden px-4 py-3 font-medium xl:table-cell">创建时间</th>
                    <th className="px-4 py-3 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {users.map((u) => {
                    const isRootUser = u.is_root === 1 || u.is_root === true
                    const rootLocked = isRootUser && !isRoot
                    return (
                    <tr key={u.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                      <td className="px-4 py-3">
                        <button
                          onClick={() => void openDetail(u)}
                          className="text-left font-medium text-gray-900 hover:text-brand-600 dark:text-gray-100 dark:hover:text-brand-400"
                          title="查看用户详情"
                        >
                          {u.name}
                        </button>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{u.email}</p>
                        <p className="mt-0.5 text-[11px] text-gray-400">
                          {u.link_count ?? 0} 条短链 · {u.group_count ?? 0} 个项目组
                        </p>
                        {u.groups && u.groups.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {u.groups.slice(0, 3).map((g) => (
                              <span
                                key={g.id}
                                className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                                title={g.role === 'admin' ? '该组的组管理员' : '该组成员'}
                              >
                                {g.path}
                                {g.role === 'admin' ? ' · 管理员' : ''}
                              </span>
                            ))}
                            {u.groups.length > 3 && (
                              <span className="text-[10px] text-gray-400">+{u.groups.length - 3}</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge tone={roleTone(u.role)}>{ROLE_LABELS[u.role] || u.role}</Badge>
                          {isRootUser && <Badge tone="red">最高权限</Badge>}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusBadge status={u.status === 'active' ? 'active' : 'disabled'} />
                          {u.password_set === 0 && <Badge tone="gray">未设密码</Badge>}
                          {!!u.require_review && (
                            <Badge tone="yellow">
                              {u.review_by === 'super_admin' ? '超管审核' : '需审核'}
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {u.last_login_at ? (
                          <>
                            <p className="text-xs text-gray-600 dark:text-gray-300">{formatDateTime(u.last_login_at)}</p>
                            <p className="font-mono text-[11px] text-gray-400">{u.last_login_ip || '-'}</p>
                          </>
                        ) : (
                          <span className="text-xs text-gray-400">从未登录</span>
                        )}
                      </td>
                      <td className="hidden px-4 py-3 text-xs text-gray-500 dark:text-gray-400 xl:table-cell">
                        {formatDateTime(u.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => void openDetail(u)}
                            className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-brand-600 dark:hover:bg-gray-800"
                            title="查看详情 / 操作记录"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          {isSuperAdmin && (
                            <button
                              onClick={() => void openDetail(u, 'permissions')}
                              disabled={rootLocked}
                              className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-brand-600 disabled:opacity-30 dark:hover:bg-gray-800"
                              title={rootLocked ? '最高权限账户的权限只能由本人调整' : '配置权限'}
                            >
                              <ShieldCheck className="h-4 w-4" />
                            </button>
                          )}
                          <button
                            onClick={() => openEdit(u)}
                            disabled={rootLocked}
                            className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 dark:hover:bg-gray-800"
                            title={rootLocked ? '最高权限账户只能由本人修改' : '编辑'}
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setDeleting(u)}
                            disabled={u.id === user?.id || rootLocked || (u.role === 'super_admin' && !isRoot)}
                            className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30 dark:hover:bg-red-900/20"
                            title={
                              rootLocked
                                ? '最高权限账户不能被删除'
                                : u.role === 'super_admin' && !isRoot
                                  ? '只有最高权限账户可以删除超级管理员'
                                  : '删除'
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3 text-sm dark:border-gray-800">
              <span className="text-gray-500 dark:text-gray-400">
                第 {page} / {totalPages} 页
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  上一页
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  下一页
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>

      {/* 创建用户 */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="创建用户"
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreate} loading={creating}>
              创建
            </Button>
          </>
        }
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <Label htmlFor="u-name">姓名 *</Label>
            <Input
              id="u-name"
              value={createForm.name}
              onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
              placeholder="用户姓名"
            />
          </div>
          <div>
            <Label htmlFor="u-email">邮箱 *</Label>
            <Input
              id="u-email"
              type="email"
              value={createForm.email}
              onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
              placeholder="user@example.com"
            />
          </div>
          <div>
            <Label htmlFor="u-password">初始密码（可留空）</Label>
            <Input
              id="u-password"
              type="password"
              placeholder="留空则由用户首次登录时自行设置"
              value={createForm.password}
              onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
            />
            <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
              留空时用户需在登录页点击「首次使用 / 还没有密码」通过邮箱验证码自行设置
            </p>
          </div>
          <div>
            <Label htmlFor="u-role">角色</Label>
            <Select
              id="u-role"
              value={createForm.role}
              onChange={(e) => setCreateForm({ ...createForm, role: e.target.value as UserRole })}
            >
              <option value="user">普通用户</option>
              <option value="super_admin">超级管理员</option>
            </Select>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              项目组管理员请在「项目组 → 成员」中设置
            </p>
          </div>

          <label className="flex items-start gap-2.5 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
              checked={createForm.require_review}
              onChange={(e) => setCreateForm({ ...createForm, require_review: e.target.checked })}
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              该用户创建的短链需要审核（默认开启）
              <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                开启后，该用户新建短链会进入待审核状态，审核通过后才可访问
              </span>
            </span>
          </label>

          {createForm.require_review && (
            <div>
              <Label htmlFor="u-review-by">审核人</Label>
              <Select
                id="u-review-by"
                value={createForm.review_by}
                onChange={(e) => setCreateForm({ ...createForm, review_by: e.target.value as ReviewBy })}
              >
                <option value="auto">自动（优先所在项目组管理员，无则超级管理员）</option>
                <option value="super_admin">仅超级管理员</option>
              </Select>
            </div>
          )}

          {createError && <ErrorText>{createError}</ErrorText>}
        </form>
      </Modal>

      {/* 编辑用户 */}
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title="编辑用户"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>
              取消
            </Button>
            <Button onClick={handleSaveEdit} loading={saving}>
              保存
            </Button>
          </>
        }
      >
        <form onSubmit={handleSaveEdit} className="space-y-4">
          <div>
            <Label>邮箱</Label>
            <Input value={editing?.email || ''} disabled />
          </div>
          <div>
            <Label htmlFor="e-name">姓名</Label>
            <Input
              id="e-name"
              value={editForm.name}
              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="e-role">角色</Label>
              <Select
                id="e-role"
                value={editForm.role}
                onChange={(e) => setEditForm({ ...editForm, role: e.target.value as UserRole })}
              >
                <option value="user" disabled={editing?.is_root === 1 || editing?.is_root === true}>
                  普通用户
                </option>
                <option value="super_admin">超级管理员</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="e-status">状态</Label>
              <Select
                id="e-status"
                value={editForm.status}
                onChange={(e) => setEditForm({ ...editForm, status: e.target.value as UserStatus })}
              >
                <option value="active">正常</option>
                <option
                  value="disabled"
                  disabled={editing?.id === user?.id || editing?.is_root === 1 || editing?.is_root === true}
                >
                  禁用
                </option>
              </Select>
              {editing?.id === user?.id && (
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">不能禁用自己的账户</p>
              )}
            </div>
          </div>

          <label className="flex items-start gap-2.5 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
              checked={editForm.require_review}
              onChange={(e) => setEditForm({ ...editForm, require_review: e.target.checked })}
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              该用户创建的短链需要审核
              <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                开启后，该用户新建短链会进入待审核状态，需管理员审核通过后才可访问
              </span>
            </span>
          </label>

          {editForm.require_review && (
            <div>
              <Label htmlFor="e-review-by">审核人</Label>
              <Select
                id="e-review-by"
                value={editForm.review_by}
                onChange={(e) => setEditForm({ ...editForm, review_by: e.target.value as ReviewBy })}
              >
                <option value="auto">自动（优先所在项目组管理员，无则超级管理员）</option>
                <option value="super_admin">仅超级管理员</option>
              </Select>
            </div>
          )}

          <div>
            <Label htmlFor="e-password">重置密码（留空表示不修改）</Label>
            <Input
              id="e-password"
              type="password"
              value={editForm.password}
              onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
            />
          </div>
          {editError && <ErrorText>{editError}</ErrorText>}
        </form>
      </Modal>

      {/* 用户详情 */}
      <Modal
        open={detailOpen}
        onClose={() => {
          setDetailOpen(false)
          setDetail(null)
        }}
        title={detail ? `用户详情 · ${detail.user.name}` : '用户详情'}
        wide
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setDetailOpen(false)
                setDetail(null)
              }}
            >
              关闭
            </Button>
            {tab === 'permissions' && isSuperAdmin && detail && detail.user.role !== 'super_admin' && (
              <Button onClick={handleSavePermissions} loading={permSaving}>
                保存权限
              </Button>
            )}
          </>
        }
      >
        {detailLoading ? (
          <LoadingBlock label="正在加载用户资料..." />
        ) : detailError ? (
          <ErrorText>{detailError}</ErrorText>
        ) : detail ? (
          <div className="space-y-4">
            {/* 标签页 */}
            <div className="flex flex-wrap gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
              {(
                [
                  ['overview', '概览'],
                  ['links', '创建短链'],
                  ['logs', '操作记录'],
                  ['permissions', '权限配置'],
                ] as [DetailTab, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => switchTab(key)}
                  className={
                    tab === key
                      ? 'flex-1 rounded-md bg-white px-3 py-1.5 text-xs font-medium text-gray-900 shadow-sm dark:bg-gray-900 dark:text-gray-100'
                      : 'flex-1 rounded-md px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
                  }
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === 'overview' && (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
                    <p className="text-xs text-gray-500 dark:text-gray-400">账号</p>
                    <p className="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">{detail.user.email}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Badge tone={roleTone(detail.user.role)}>
                        {ROLE_LABELS[detail.user.role] || detail.user.role}
                      </Badge>
                      {(detail.user.is_root === 1 || detail.user.is_root === true) && (
                        <Badge tone="red">最高权限</Badge>
                      )}
                      <StatusBadge status={detail.user.status === 'active' ? 'active' : 'disabled'} />
                      {detail.user.password_set === 0 && <Badge tone="gray">未设密码</Badge>}
                      {!!detail.user.require_review && (
                        <Badge tone="yellow">
                          {detail.user.review_by === 'super_admin' ? '超管审核' : '需审核'}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
                    <p className="text-xs text-gray-500 dark:text-gray-400">最后登录</p>
                    <p className="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">
                      {detail.user.last_login_at ? formatDateTime(detail.user.last_login_at) : '从未登录'}
                    </p>
                    <p className="mt-1 font-mono text-xs text-gray-500 dark:text-gray-400">
                      IP：{detail.user.last_login_ip || '-'}
                    </p>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      注册于 {formatDateTime(detail.user.created_at)}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: '创建短链', value: detail.link_summary.total },
                    { label: '活跃短链', value: detail.link_summary.active },
                    { label: '累计点击', value: detail.link_summary.clicks },
                  ].map((item) => (
                    <div key={item.label} className="rounded-lg bg-gray-50 p-3 text-center dark:bg-gray-800/60">
                      <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">{item.value || 0}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{item.label}</p>
                    </div>
                  ))}
                </div>

                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    所在项目组（{detail.groups.length}）
                  </p>
                  {detail.groups.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-gray-200 px-3 py-3 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
                      该用户尚未加入任何项目组
                    </p>
                  ) : (
                    <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
                      {detail.groups.map((g) => (
                        <li key={g.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                          <span className="flex-1 text-sm text-gray-900 dark:text-gray-100">{g.path}</span>
                          <Badge tone={g.group_role === 'admin' ? 'purple' : 'gray'}>
                            {g.group_role === 'admin' ? '组管理员' : '成员'}
                          </Badge>
                          <span className="text-[11px] text-gray-400">加入于 {formatDateTime(g.joined_at)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {detail.ips.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      操作 IP
                    </p>
                    <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
                      {detail.ips.map((item) => (
                        <li key={item.ip} className="flex items-center gap-2 px-3 py-2 text-xs">
                          <span className="font-mono text-gray-700 dark:text-gray-300">{item.ip}</span>
                          {item.location && <span className="text-gray-400">{item.location}</span>}
                          <span className="ml-auto text-gray-400">{item.count} 次</span>
                          <span className="text-gray-400">{formatDateTime(item.last_seen)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {tab === 'links' && (
              <div className="space-y-3">
                {linksLoading ? (
                  <LoadingBlock label="加载短链..." />
                ) : detailLinks.length === 0 ? (
                  <EmptyState title="暂无短链" description="该用户还没有创建短链" />
                ) : (
                  <>
                    <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
                      <table className="w-full min-w-[520px] text-sm">
                        <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">
                          <tr>
                            <th className="px-3 py-2 font-medium">短链</th>
                            <th className="px-3 py-2 font-medium">目标链接</th>
                            <th className="px-3 py-2 font-medium">项目组</th>
                            <th className="px-3 py-2 font-medium">状态</th>
                            <th className="px-3 py-2 font-medium">点击</th>
                            <th className="px-3 py-2 text-right font-medium">操作</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                          {detailLinks.map((l) => (
                            <tr key={l.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                              <td className="px-3 py-2">
                                <p className="font-medium text-brand-600 dark:text-brand-400">
                                  {l.domain_name ? `${l.domain_name}/${l.short_code}` : `/${l.short_code}`}
                                </p>
                                <p className="truncate text-xs text-gray-500 dark:text-gray-400">{l.name || '（未命名）'}</p>
                              </td>
                              <td className="max-w-[180px] px-3 py-2">
                                <span className="block truncate text-xs text-gray-600 dark:text-gray-400" title={l.target_url}>
                                  {l.target_url}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
                                {l.group_name || '个人'}
                              </td>
                              <td className="px-3 py-2">
                                {l.review_status === 'pending' ? (
                                  <Badge tone="yellow">待审核</Badge>
                                ) : l.review_status === 'rejected' ? (
                                  <Badge tone="red">已驳回</Badge>
                                ) : l.status === 'active' ? (
                                  <Badge tone="green">正常</Badge>
                                ) : l.status === 'expired' ? (
                                  <Badge tone="gray">已过期</Badge>
                                ) : (
                                  <Badge tone="gray">已停用</Badge>
                                )}
                              </td>
                              <td className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">{l.click_count}</td>
                              <td className="px-3 py-2">
                                <div className="flex items-center justify-end gap-1">
                                  <button
                                    onClick={() =>
                                      window.open(
                                        `https://${l.domain_name || window.location.host}/${l.short_code}`,
                                        '_blank',
                                        'noopener',
                                      )
                                    }
                                    className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-brand-600 dark:hover:bg-gray-800"
                                    title="打开短链"
                                  >
                                    <ExternalLink className="h-4 w-4" />
                                  </button>
                                  <button
                                    onClick={() => setEditingLink(l)}
                                    className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800"
                                    title="编辑短链"
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </button>
                                  <button
                                    onClick={() => setDeletingLink(l)}
                                    className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                                    title="删除短链"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                      <span>
                        共 {linksTotal} 条 · 第 {linksPage} / {Math.max(1, Math.ceil(linksTotal / detailPageSize))} 页
                      </span>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={linksPage <= 1}
                          onClick={() => void loadDetailLinks(detail.user.id, linksPage - 1)}
                        >
                          上一页
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={linksPage >= Math.ceil(linksTotal / detailPageSize)}
                          onClick={() => void loadDetailLinks(detail.user.id, linksPage + 1)}
                        >
                          下一页
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {tab === 'logs' && (
              <div className="space-y-3">
                {logsLoading ? (
                  <LoadingBlock label="加载操作记录..." />
                ) : detailLogs.length === 0 ? (
                  <EmptyState title="暂无操作记录" description="该用户还没有产生可审计的操作" />
                ) : (
                  <>
                    <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
                      {detailLogs.map((log) => (
                        <li key={log.id} className="px-3 py-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                              {actionLabel(log.action)}
                            </span>
                            {log.target_type && (
                              <span className="text-xs text-gray-500 dark:text-gray-400">
                                {targetTypeLabel(log.target_type)}
                                {log.target_id ? `#${log.target_id}` : ''}
                              </span>
                            )}
                            <span className="ml-auto text-[11px] text-gray-400">{formatDateTime(log.timestamp)}</span>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-gray-400">
                            <span className="font-mono">{log.ip || '-'}</span>
                            {log.location && <span>{log.location}</span>}
                            {log.detail && (
                              <span className="max-w-full truncate" title={log.detail}>
                                {describeDetail(log.detail)}
                              </span>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                    <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                      <span>
                        共 {logsTotal} 条 · 第 {logsPage} / {Math.max(1, Math.ceil(logsTotal / detailPageSize))} 页
                      </span>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={logsPage <= 1}
                          onClick={() => void loadDetailLogs(detail.user.id, logsPage - 1)}
                        >
                          上一页
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={logsPage >= Math.ceil(logsTotal / detailPageSize)}
                          onClick={() => void loadDetailLogs(detail.user.id, logsPage + 1)}
                        >
                          下一页
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {tab === 'permissions' && (
              <div className="space-y-3">
                {detail.user.role === 'super_admin' ? (
                  <p className="rounded-lg bg-purple-50 px-3 py-2 text-xs text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                    超级管理员默认拥有全部权限，无法单独收窄
                  </p>
                ) : !isSuperAdmin ? (
                  <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:bg-gray-800/60 dark:text-gray-300">
                    只有超级管理员可以配置全局权限
                  </p>
                ) : (
                  <>
                    <PermissionEditor
                      defs={GLOBAL_PERMISSION_DEFS}
                      value={permValue}
                      onChange={setPermValue}
                      description="全局权限：用户管理与操作审计菜单的可见性与访问能力"
                    />
                    <div className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
                      <span>重置为默认（普通用户默认无全局权限）</span>
                      <Button variant="outline" size="sm" onClick={() => setPermValue({})}>
                        恢复默认
                      </Button>
                    </div>
                  </>
                )}
                {detail.groups.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      组内权限
                    </p>
                    <div className="space-y-2">
                      {detail.groups.map((g) => {
                        const perms = g.group_permissions || {}
                        const enabled = Object.keys(perms).filter((k) => perms[k])
                        return (
                          <div
                            key={g.id}
                            className="rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-800"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm text-gray-900 dark:text-gray-100">{g.path}</span>
                              <Badge tone={g.group_role === 'admin' ? 'purple' : 'gray'}>
                                {g.group_role === 'admin' ? '组管理员' : '成员'}
                              </Badge>
                              <span className="text-[11px] text-gray-400">已开启 {enabled.length} 项</span>
                            </div>
                            <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                              组内权限请到「项目组 → 成员管理」中配置
                            </p>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center py-8 text-gray-400">
            <Spinner className="h-5 w-5" />
          </div>
        )}
      </Modal>

      {/* 删除确认 */}
      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="删除用户"
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              取消
            </Button>
            <Button variant="danger" onClick={handleDelete} loading={deleteLoading}>
              确认删除
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-700 dark:text-gray-300">
          确定删除用户「{deleting?.name}」（{deleting?.email}）吗？
        </p>
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">
          该用户创建的短链及其访问数据会一并删除，操作不可恢复。
        </p>
      </Modal>

      {/* 详情内短链编辑 */}
      <EditLinkModal
        link={editingLink}
        groups={groups}
        onClose={() => setEditingLink(null)}
        onSaved={() => {
          if (detail) void loadDetailLinks(detail.user.id, linksPage)
        }}
      />

      {/* 详情内短链删除确认 */}
      <Modal
        open={!!deletingLink}
        onClose={() => setDeletingLink(null)}
        title="删除短链"
        footer={
          <>
            <Button variant="outline" onClick={() => setDeletingLink(null)}>
              取消
            </Button>
            <Button variant="danger" onClick={handleDeleteLink} loading={linkDeleteLoading}>
              确认删除
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-700 dark:text-gray-300">
          确定删除短链「
          {deletingLink?.domain_name
            ? `${deletingLink.domain_name}/${deletingLink.short_code}`
            : `/${deletingLink?.short_code}`}
          」吗？
        </p>
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">
          删除后短链立即失效，访问数据将一并清除，操作不可恢复。
        </p>
      </Modal>
    </div>
  )
}
