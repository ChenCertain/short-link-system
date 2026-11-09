import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Copy,
  Eye,
  EyeOff,
  Pencil,
  Plus,
  QrCode,
  Search,
  Star,
  StarOff,
  Trash2,
  Upload,
} from 'lucide-react'
import { domainsApi, groupsApi, linksApi } from '@/lib/api'
import type { ProjectGroup, ShortLink } from '@/lib/types'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorText,
  Input,
  Label,
  LoadingBlock,
  Modal,
  Select,
  StatusBadge,
  Textarea,
} from '@/components/ui'
import { QRCodeModal } from '@/components/QRCodeModal'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useToast } from '@/components/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { cn, copyText, formatDateTime, localInputToTimestamp, timestampToLocalInput } from '@/lib/utils'

interface LinkForm {
  target_url: string
  name: string
  custom_alias: string
  domain_id: string
  group_id: string
  password: string
  expires_at: string
  redirect_type: string
}

const emptyForm: LinkForm = {
  target_url: '',
  name: '',
  custom_alias: '',
  domain_id: '',
  group_id: '',
  password: '',
  expires_at: '',
  redirect_type: '302',
}

function absoluteUrl(link: ShortLink) {
  const path = link.domain_name ? `https://${link.domain_name}/${link.short_code}` : `/${link.short_code}`
  return path.startsWith('/') ? `${window.location.origin}${path}` : path
}

function defaultExpiryInput() {
  const d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  d.setSeconds(0, 0)
  return timestampToLocalInput(Math.floor(d.getTime() / 1000))
}

/** 过期时间选择：长期有效 / 自定义时间 分段切换，避免按钮与右侧控件重叠 */
function ExpiryField({
  id,
  value,
  onChange,
}: {
  id: string
  value: string
  onChange: (value: string) => void
}) {
  const permanent = !value
  const tabClass = (active: boolean) =>
    cn(
      'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
      active
        ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100'
        : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200',
    )

  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <Label htmlFor={id} className="mb-0">
          过期时间
        </Label>
        <div className="inline-flex shrink-0 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800">
          <button type="button" onClick={() => onChange('')} className={tabClass(permanent)}>
            长期有效
          </button>
          <button
            type="button"
            onClick={() => {
              if (!value) onChange(defaultExpiryInput())
            }}
            className={tabClass(!permanent)}
          >
            自定义
          </button>
        </div>
      </div>
      {permanent ? (
        <div className="flex h-10 items-center rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 text-xs text-gray-500 dark:border-gray-700 dark:bg-gray-800/40 dark:text-gray-400">
          不会自动过期
        </div>
      ) : (
        <Input
          id={id}
          type="datetime-local"
          value={value}
          min={timestampToLocalInput(Math.floor(Date.now() / 1000))}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        {permanent ? '当前设置为长期有效，不会自动过期' : '到期后短链自动失效'}
      </p>
    </div>
  )
}

function flattenGroups(groups: ProjectGroup[], depth = 0): { id: number; label: string }[] {
  const result: { id: number; label: string }[] = []
  for (const g of groups) {
    result.push({ id: g.id, label: `${'　'.repeat(depth)}${g.name}` })
    if (g.children && g.children.length > 0) {
      result.push(...flattenGroups(g.children, depth + 1))
    }
  }
  return result
}

export default function Links() {
  const { user } = useAuth()
  const { show } = useToast()
  const isSuperAdmin = user?.role === 'super_admin'

  const [links, setLinks] = useState<ShortLink[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [groups, setGroups] = useState<ProjectGroup[]>([])
  const [domains, setDomains] = useState<{ id: number; domain: string; is_default_short_link: number }[]>([])
  // 当前所选项目组可用的短链域名
  const [groupDomains, setGroupDomains] = useState<{ id: number; domain: string; is_default_short_link: number }[]>([])
  const [groupDomainsLoading, setGroupDomainsLoading] = useState(false)

  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState<LinkForm>(emptyForm)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [createdUrl, setCreatedUrl] = useState('')

  const [editing, setEditing] = useState<ShortLink | null>(null)
  const [editForm, setEditForm] = useState<LinkForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState('')

  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importing, setImporting] = useState(false)

  const [qrLink, setQrLink] = useState<ShortLink | null>(null)

  // 删除确认
  const [deleting, setDeleting] = useState<ShortLink | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  const pageSize = 20
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const groupOptions = useMemo(() => flattenGroups(groups), [groups])

  const loadLinks = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await linksApi.list({ page, pageSize, search, status })
      setLinks(data.links)
      setTotal(data.total)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [page, search, status])

  useEffect(() => {
    void loadLinks()
  }, [loadLinks])

  useEffect(() => {
    groupsApi
      .list()
      .then((data) => setGroups(data.groups))
      .catch(() => setGroups([]))
    domainsApi
      .shortLinkDomains()
      .then((data) => setDomains(data.domains))
      .catch(() => setDomains([]))
  }, [])

  const loadGroupDomains = useCallback(async (groupId: string) => {
    if (!groupId) {
      setGroupDomains([])
      return
    }
    setGroupDomainsLoading(true)
    try {
      const data = await groupsApi.availableDomains(Number(groupId))
      setGroupDomains(data.domains)
      // 默认选中该组第一个可用域名
      setCreateForm((prev) =>
        prev.group_id === groupId ? { ...prev, domain_id: data.domains[0] ? String(data.domains[0].id) : '' } : prev,
      )
    } catch {
      setGroupDomains([])
    } finally {
      setGroupDomainsLoading(false)
    }
  }, [])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreateError('')

    if (!createForm.target_url.trim()) {
      setCreateError('请填写目标链接')
      return
    }
    if (createForm.group_id && !groupDomainsLoading && groupDomains.length === 0) {
      setCreateError('该项目组暂无可用域名，请联系超级管理员绑定域名')
      return
    }

    setCreating(true)
    try {
      const result = await linksApi.create({
        target_url: createForm.target_url.trim(),
        name: createForm.name.trim() || undefined,
        custom_alias: createForm.custom_alias.trim() || undefined,
        domain_id: createForm.domain_id ? Number(createForm.domain_id) : undefined,
        group_id: createForm.group_id ? Number(createForm.group_id) : undefined,
        password: createForm.password || undefined,
        expires_at: localInputToTimestamp(createForm.expires_at) ?? undefined,
        redirect_type: Number(createForm.redirect_type),
      })
      setCreatedUrl(result.short_url)
      setCreateForm(emptyForm)
      setGroupDomains([])
      if (result.review_status === 'pending') {
        show('已提交审核，管理员通过后即可访问', 'info')
      } else {
        show('短链创建成功', 'success')
      }
      void loadLinks()
    } catch (err) {
      setCreateError((err as Error).message)
    } finally {
      setCreating(false)
    }
  }

  const openEdit = (link: ShortLink) => {
    setEditing(link)
    setEditError('')
    setEditForm({
      target_url: link.target_url,
      name: link.name || '',
      custom_alias: link.short_code,
      domain_id: link.domain_id ? String(link.domain_id) : '',
      group_id: link.group_id ? String(link.group_id) : '',
      password: '',
      expires_at: timestampToLocalInput(link.expires_at),
      redirect_type: String(link.redirect_type),
    })
  }

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editing) return
    setEditError('')
    setSaving(true)
    try {
      await linksApi.update(editing.id, {
        target_url: editForm.target_url,
        name: editForm.name,
        group_id: editForm.group_id ? Number(editForm.group_id) : null,
        password: editForm.password,
        expires_at: localInputToTimestamp(editForm.expires_at),
        redirect_type: Number(editForm.redirect_type),
      })
      show('已保存修改', 'success')
      setEditing(null)
      void loadLinks()
    } catch (err) {
      setEditError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const handleToggleStatus = async (link: ShortLink) => {
    try {
      await linksApi.update(link.id, { status: link.status === 'active' ? 'disabled' : 'active' })
      show(link.status === 'active' ? '已停用' : '已启用', 'success')
      void loadLinks()
    } catch (err) {
      show((err as Error).message, 'error')
    }
  }

  const handleDelete = async () => {
    if (!deleting) return
    setDeleteLoading(true)
    try {
      await linksApi.remove(deleting.id)
      show('短链已删除', 'success')
      setDeleting(null)
      void loadLinks()
    } catch (err) {
      show((err as Error).message, 'error')
    } finally {
      setDeleteLoading(false)
    }
  }

  const handleToggleDisplay = async (link: ShortLink) => {
    try {
      await linksApi.toggleDisplay(link.id, link.is_displayed === 0)
      show(link.is_displayed === 0 ? '已加入首页展示' : '已取消首页展示', 'success')
      void loadLinks()
    } catch (err) {
      show((err as Error).message, 'error')
    }
  }

  const handleImport = async () => {
    const lines = importText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    if (lines.length === 0) return

    const payload = lines.map((line) => {
      const [url, name, alias] = line.split(',').map((s) => s.trim())
      return { target_url: url, name: name || undefined, custom_alias: alias || undefined }
    })

    setImporting(true)
    try {
      const result = await linksApi.batchImport(payload)
      const ok = result.results.filter((r) => r.success).length
      show(`导入完成：成功 ${ok} 条，失败 ${result.results.length - ok} 条`, ok > 0 ? 'success' : 'error')
      setImportOpen(false)
      setImportText('')
      void loadLinks()
    } catch (err) {
      show((err as Error).message, 'error')
    } finally {
      setImporting(false)
    }
  }

  const copy = async (link: ShortLink) => {
    const ok = await copyText(absoluteUrl(link))
    show(ok ? '短链已复制' : '复制失败', ok ? 'success' : 'error')
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">短链管理</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">共 {total} 条短链</p>
        </div>
        <div className="flex gap-2">
          {isSuperAdmin && (
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              <Upload className="h-4 w-4" />
              批量导入
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => {
              setCreateOpen(true)
              setCreatedUrl('')
              setCreateError('')
              // 恢复上次选择项目组的可用域名；未选择则清空
              if (createForm.group_id) {
                void loadGroupDomains(createForm.group_id)
              } else {
                setGroupDomains([])
              }
            }}
          >
            <Plus className="h-4 w-4" />
            创建短链
          </Button>
        </div>
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-3 dark:border-gray-800">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              className="pl-9"
              placeholder="搜索短码、目标链接或名称"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
            />
          </div>
          <Select
            className="w-36"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value)
              setPage(1)
            }}
          >
            <option value="">全部状态</option>
            <option value="active">活跃</option>
            <option value="disabled">已停用</option>
            <option value="expired">已过期</option>
          </Select>
        </div>

        {error && <div className="px-4 pt-3"><ErrorText>{error}</ErrorText></div>}

        {loading ? (
          <LoadingBlock />
        ) : links.length === 0 ? (
          <EmptyState title="暂无短链" description="点击右上角「创建短链」开始使用" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">短链 / 名称</th>
                    <th className="px-4 py-3 font-medium">目标链接</th>
                    <th className="px-4 py-3 font-medium">状态</th>
                    <th className="hidden px-4 py-3 font-medium lg:table-cell">项目组</th>
                    <th className="hidden px-4 py-3 font-medium lg:table-cell">创建者</th>
                    <th className="px-4 py-3 font-medium">访问</th>
                    <th className="hidden px-4 py-3 font-medium xl:table-cell">创建时间</th>
                    <th className="px-4 py-3 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {links.map((link) => (
                    <tr key={link.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Link
                            to={`/dashboard/links/${link.id}`}
                            className="font-medium text-brand-600 hover:underline dark:text-brand-400"
                          >
                            /{link.short_code}
                          </Link>
                          {link.is_displayed === 1 && (
                            <Badge tone="purple">
                              <Star className="mr-0.5 h-3 w-3" /> 展示
                            </Badge>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
                          {link.name || '（未命名）'}
                        </p>
                      </td>
                      <td className="max-w-[220px] px-4 py-3">
                        <a
                          href={link.target_url}
                          target="_blank"
                          rel="noreferrer"
                          className="block truncate text-gray-600 hover:text-brand-600 dark:text-gray-400"
                          title={link.target_url}
                        >
                          {link.target_url}
                        </a>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusBadge status={link.status} />
                          {link.review_status === 'pending' && <Badge tone="yellow">待审核</Badge>}
                          {link.review_status === 'rejected' && <Badge tone="red">未通过</Badge>}
                        </div>
                      </td>
                      <td className="hidden px-4 py-3 text-gray-600 dark:text-gray-400 lg:table-cell">
                        {link.group_name || '-'}
                      </td>
                      <td className="hidden px-4 py-3 lg:table-cell">
                        <p className="text-gray-700 dark:text-gray-300">{link.creator_name || '-'}</p>
                        <p className="text-xs text-gray-400">{link.creator_email}</p>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone="blue">{link.click_count}</Badge>
                      </td>
                      <td className="hidden px-4 py-3 text-xs text-gray-500 dark:text-gray-400 xl:table-cell">
                        {formatDateTime(link.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => copy(link)}
                            className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800"
                            title="复制短链"
                          >
                            <Copy className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setQrLink(link)}
                            className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800"
                            title="二维码"
                          >
                            <QrCode className="h-4 w-4" />
                          </button>
                          {isSuperAdmin && (
                            <button
                              onClick={() => handleToggleDisplay(link)}
                              className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800"
                              title={link.is_displayed ? '取消首页展示' : '加入首页展示'}
                            >
                              {link.is_displayed ? <StarOff className="h-4 w-4" /> : <Star className="h-4 w-4" />}
                            </button>
                          )}
                          {link.can_manage && (
                            <>
                              <button
                                onClick={() => handleToggleStatus(link)}
                                className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800"
                                title={link.status === 'active' ? '停用' : '启用'}
                              >
                                {link.status === 'active' ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                              </button>
                              <button
                                onClick={() => openEdit(link)}
                                className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800"
                                title="编辑"
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => setDeleting(link)}
                                className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                                title="删除"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </>
                          )}
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

      {/* 创建短链 */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="创建短链"
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button
              onClick={handleCreate}
              loading={creating}
              disabled={!!createForm.group_id && !groupDomainsLoading && groupDomains.length === 0}
            >
              创建
            </Button>
          </>
        }
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <Label htmlFor="target">目标链接 *</Label>
            <Input
              id="target"
              placeholder="https://example.com/path"
              value={createForm.target_url}
              onChange={(e) => setCreateForm({ ...createForm, target_url: e.target.value })}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="name">名称</Label>
              <Input
                id="name"
                placeholder="用于识别的名称"
                value={createForm.name}
                onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="alias">自定义别名</Label>
              <Input
                id="alias"
                placeholder="留空自动生成"
                value={createForm.custom_alias}
                onChange={(e) => setCreateForm({ ...createForm, custom_alias: e.target.value })}
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="min-w-0">
              <Label htmlFor="group">所属项目组</Label>
              <Select
                id="group"
                value={createForm.group_id}
                onChange={(e) => {
                  const gid = e.target.value
                  setCreateForm({ ...createForm, group_id: gid, domain_id: '' })
                  void loadGroupDomains(gid)
                }}
              >
                <option value="">不归属项目组</option>
                {groupOptions.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="min-w-0">
              <Label htmlFor="domain">短链域名</Label>
              {createForm.group_id ? (
                groupDomainsLoading ? (
                  <div className="flex h-10 items-center rounded-lg border border-gray-200 px-3 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
                    域名加载中...
                  </div>
                ) : groupDomains.length === 0 ? (
                  <div className="flex h-10 items-center rounded-lg border border-dashed border-amber-300 bg-amber-50 px-3 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                    暂无可用域名
                  </div>
                ) : (
                  <Select
                    id="domain"
                    value={createForm.domain_id}
                    onChange={(e) => setCreateForm({ ...createForm, domain_id: e.target.value })}
                  >
                    {groupDomains.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.domain}
                        {d.is_default_short_link ? '（默认）' : ''}
                      </option>
                    ))}
                  </Select>
                )
              ) : (
                <Select
                  id="domain"
                  value={createForm.domain_id}
                  onChange={(e) => setCreateForm({ ...createForm, domain_id: e.target.value })}
                >
                  <option value="">默认域名</option>
                  {domains.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.domain}
                      {d.is_default_short_link ? '（默认）' : ''}
                    </option>
                  ))}
                </Select>
              )}
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {createForm.group_id
                  ? groupDomains.length === 0 && !groupDomainsLoading
                    ? '该项目组暂未绑定域名，请联系超级管理员'
                    : '项目组短链只能使用该组已绑定的域名'
                  : '未归属项目组时使用平台默认域名'}
              </p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <ExpiryField
              id="expires"
              value={createForm.expires_at}
              onChange={(value) => setCreateForm({ ...createForm, expires_at: value })}
            />
            <div className="min-w-0">
              <Label htmlFor="redirect">跳转类型</Label>
              <Select
                id="redirect"
                value={createForm.redirect_type}
                onChange={(e) => setCreateForm({ ...createForm, redirect_type: e.target.value })}
              >
                <option value="302">302 临时跳转（推荐）</option>
                <option value="301">301 永久跳转</option>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="pwd">访问密码（可选）</Label>
            <Input
              id="pwd"
              type="password"
              placeholder="设置后访问短链需要输入密码"
              value={createForm.password}
              onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
            />
          </div>

          {createError && <ErrorText>{createError}</ErrorText>}

          {createdUrl && (
            <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-900/30 dark:text-green-300">
              创建成功：
              <a href={createdUrl} target="_blank" rel="noreferrer" className="ml-1 underline">
                {createdUrl}
              </a>
            </div>
          )}
        </form>
      </Modal>

      {/* 编辑短链 */}
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title="编辑短链"
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
            <Label>短码</Label>
            <Input value={editing?.short_code || ''} disabled />
          </div>
          <div>
            <Label htmlFor="edit-target">目标链接</Label>
            <Input
              id="edit-target"
              value={editForm.target_url}
              onChange={(e) => setEditForm({ ...editForm, target_url: e.target.value })}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="edit-name">名称</Label>
              <Input
                id="edit-name"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="edit-group">所属项目组</Label>
              <Select
                id="edit-group"
                value={editForm.group_id}
                onChange={(e) => setEditForm({ ...editForm, group_id: e.target.value })}
              >
                <option value="">不归属项目组</option>
                {groupOptions.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.label}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                切换项目组后，若原域名不属于新项目组，将自动改用该组默认域名
              </p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <ExpiryField
              id="edit-expires"
              value={editForm.expires_at}
              onChange={(value) => setEditForm({ ...editForm, expires_at: value })}
            />
            <div className="min-w-0">
              <Label htmlFor="edit-redirect">跳转类型</Label>
              <Select
                id="edit-redirect"
                value={editForm.redirect_type}
                onChange={(e) => setEditForm({ ...editForm, redirect_type: e.target.value })}
              >
                <option value="302">302 临时跳转</option>
                <option value="301">301 永久跳转</option>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="edit-pwd">访问密码（留空表示不修改）</Label>
            <Input
              id="edit-pwd"
              type="password"
              value={editForm.password}
              onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
            />
          </div>

          {editError && <ErrorText>{editError}</ErrorText>}
        </form>
      </Modal>

      {/* 批量导入 */}
      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="批量导入短链"
        footer={
          <>
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              取消
            </Button>
            <Button onClick={handleImport} loading={importing}>
              开始导入
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            每行一条，格式：<code className="rounded bg-gray-100 px-1 dark:bg-gray-800">目标链接,名称,自定义别名</code>
            （名称和别名可省略）
          </p>
          <Textarea
            rows={10}
            placeholder={'https://example.com/1,示例一\nexample.com/2,示例二,mylink'}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            className="font-mono text-xs"
          />
        </div>
      </Modal>

      <QRCodeModal
        open={!!qrLink}
        onClose={() => setQrLink(null)}
        url={qrLink ? absoluteUrl(qrLink) : ''}
        title={qrLink ? `二维码 · ${qrLink.name || qrLink.short_code}` : '二维码'}
      />

      <ConfirmDialog
        open={!!deleting}
        title="删除短链"
        description={`确定删除短链「${deleting?.name || deleting?.short_code}」吗？删除后访问记录也会一并清除，操作不可恢复。`}
        confirmText="确认删除"
        loading={deleteLoading}
        onCancel={() => setDeleting(null)}
        onConfirm={handleDelete}
      />
    </div>
  )
}
