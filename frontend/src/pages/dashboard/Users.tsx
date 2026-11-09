import { useCallback, useEffect, useState } from 'react'
import { Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { usersApi } from '@/lib/api'
import type { ReviewBy, UserItem, UserRole, UserStatus } from '@/lib/types'
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
  StatusBadge,
} from '@/components/ui'
import { useToast } from '@/components/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { formatDateTime, ROLE_LABELS } from '@/lib/utils'

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

  const pageSize = 20
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await usersApi.list({ page, pageSize, search })
      setUsers(data.users)
      setTotal(data.total)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [page, search])

  useEffect(() => {
    void load()
  }, [load])

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

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">用户管理</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            共 {total} 位用户 · 账户只能由超级管理员创建，项目组管理员在项目组内设置
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
          <div className="relative max-w-md">
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
                  {users.map((u) => (
                    <tr key={u.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900 dark:text-gray-100">{u.name}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{u.email}</p>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={roleTone(u.role)}>{ROLE_LABELS[u.role] || u.role}</Badge>
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
                            onClick={() => openEdit(u)}
                            className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800"
                            title="编辑"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setDeleting(u)}
                            disabled={u.id === user?.id}
                            className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30 dark:hover:bg-red-900/20"
                            title="删除"
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
                <option value="user">普通用户</option>
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
                <option value="disabled" disabled={editing?.id === user?.id}>
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
    </div>
  )
}
