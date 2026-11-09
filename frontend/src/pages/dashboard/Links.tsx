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

// 目标链接协议：默认 https，可切换为 http
const URL_PROTOCOLS = ['https', 'http'] as const

function splitProtocol(url: string): { protocol: string; rest: string } {
  const trimmed = (url || '').trim()
  const matched = /^([a-z][a-z0-9+.-]*):\/\//i.exec(trimmed)
  if (matched) {
    return { protocol: matched[1].toLowerCase(), rest: trimmed.slice(matched[0].length) }
  }
  return { protocol: 'https', rest: trimmed }
}

function withProtocol(protocol: string, rest: string): string {
  return `${protocol}://${rest.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')}`
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
  const [filterGroup, setFilterGroup] = useState('')
  const [filterDomain, setFilterDomain] = useState('')
  const [filterCreator, setFilterCreator] = useState('')
  const [filterOptions, setFilterOptions] = useState<{
    groups: { id: number; name: string; parent_id: number | null }[]
    domains: { id: number; domain: string }[]
    creators: { id: number; name: string; email: string }[]
  }>({ groups: [], domains: [], creators: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [groups, setGroups] = useState<ProjectGroup[]>([])
  const [domains, setDomains] = useState<{ id: number; domain: string; is_default_short_link: number }[]>([])
  // 当前所选项目组可用的短链域名
  const [groupDomains, setGroupDomains] = useState<{ id: number; domain: string; is_default_short_link: number }[]>([])
  const [groupDomainsLoading, setGroupDomainsLoading] = useState(false)

  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState<LinkForm>(emptyForm)
  const [createProtocol, setCreateProtocol] = useState<string>('https')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [createdUrl, setCreatedUrl] = useState('')

  const [editing, setEditing] = useState<ShortLink | null>(null)
  const [editForm, setEditForm] = useState<LinkForm>(emptyForm)
  const [editDomains, setEditDomains] = useState<{ id: number; domain: string; is_default_short_link: number }[]>([])
  const [editDomainsLoading, setEditDomainsLoading] = useState(false)
  const [editProtocol, setEditProtocol] = useState<string>('https')
  const [editClearPassword, setEditClearPassword] = useState(false)
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

  // 平台默认短链域名；未设置为空字符串，表示暂无默认域名
  const globalDefaultDomainId = useMemo(() => {
    const target = domains.find((d) => d.is_default_short_link === 1)
    return target ? String(target.id) : ''
  }, [domains])

  const loadLinks = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await linksApi.list({
        page,
        pageSize,
        search,
        status,
        groupId: filterGroup ? Number(filterGroup) : undefined,
        domainId: filterDomain ? Number(filterDomain) : undefined,
        creatorId: filterCreator ? Number(filterCreator) : undefined,
      })
      setLinks(data.links)
      setTotal(data.total)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [page, search, status, filterGroup, filterDomain, filterCreator])

  const loadFilterOptions = useCallback(async () => {
    try {
      const data = await linksApi.filterOptions()
      setFilterOptions({ groups: data.groups, domains: data.domains, creators: data.creators })
    } catch {
      // 筛选项加载失败时不影响列表本身
    }
  }, [])

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
    void loadFilterOptions()
  }, [loadFilterOptions])

  const loadGroupDomains = useCallback(async (groupId: string) => {
    if (!groupId) {
      setGroupDomains([])
      return
    }
    setGroupDomainsLoading(true)
    try {
      const data = await groupsApi.availableDomains(Number(groupId))
      setGroupDomains(data.domains)
      // 仅当项目组设置了默认域名时才自动选中，否则留空交由用户选择
      const preferred = data.domains.find((d) => d.is_default_short_link === 1)
      setCreateForm((prev) =>
        prev.group_id === groupId ? { ...prev, domain_id: preferred ? String(preferred.id) : '' } : prev,
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

    if (!splitProtocol(createForm.target_url).rest.trim()) {
      setCreateError('请填写目标链接')
      return
    }
    const aliasInput = createForm.custom_alias.trim()
    if (aliasInput) {
      if (aliasInput.length > 64) {
        setCreateError('自定义别名最长 64 个字符')
        return
      }
      if (!/^[\p{L}\p{N}_-]+$/u.test(aliasInput)) {
        setCreateError('自定义别名只能包含中文、字母、数字、下划线和短横线')
        return
      }
      if (['login', 'init', 'dashboard', 'api', 'assets', 'cdn-cgi'].includes(aliasInput.toLowerCase())) {
        setCreateError('该别名是系统保留路径，请更换')
        return
      }
    }
    if (createForm.group_id && !groupDomainsLoading && groupDomains.length === 0) {
      setCreateError('该项目组暂无可用域名，请联系超级管理员绑定域名')
      return
    }
    if (createForm.group_id && !createForm.domain_id) {
      setCreateError('该项目组未设置默认域名，请选择要使用的短链域名')
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
      setCreateProtocol('https')
      setGroupDomains([])
      void loadFilterOptions()
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
    setEditClearPassword(false)
    setEditProtocol(splitProtocol(link.target_url).protocol)
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

    // 只加载当前用户有权限使用的域名
    setEditDomains([])
    setEditDomainsLoading(true)
    const request = link.group_id
      ? groupsApi.availableDomains(link.group_id)
      : domainsApi.shortLinkDomains()
    request
      .then((data) => setEditDomains(data.domains))
      .catch(() => setEditDomains([]))
      .finally(() => setEditDomainsLoading(false))
  }

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editing) return
    setEditError('')

    const aliasInput = editForm.custom_alias.trim()
    if (!aliasInput) {
      setEditError('自定义别名不能为空')
      return
    }
    if (aliasInput.length > 64) {
      setEditError('自定义别名最长 64 个字符')
      return
    }
    if (!/^[\p{L}\p{N}_-]+$/u.test(aliasInput)) {
      setEditError('自定义别名只能包含中文、字母、数字、下划线和短横线')
      return
    }
    if (['login', 'init', 'dashboard', 'api', 'assets', 'cdn-cgi'].includes(aliasInput.toLowerCase())) {
      setEditError('该别名是系统保留路径，请更换')
      return
    }

    if (!splitProtocol(editForm.target_url).rest.trim()) {
      setEditError('请填写目标链接')
      return
    }

    setSaving(true)
    try {
      const originalDomainId = editing.domain_id ? String(editing.domain_id) : ''
      const payload: Parameters<typeof linksApi.update>[1] = {
        target_url: editForm.target_url,
        name: editForm.name,
        short_code: aliasInput,
        group_id: editForm.group_id ? Number(editForm.group_id) : null,
        expires_at: localInputToTimestamp(editForm.expires_at),
        redirect_type: Number(editForm.redirect_type),
      }

      // 仅当用户主动修改域名时才提交，避免无权限域名影响保存
      if (editForm.domain_id !== originalDomainId) {
        payload.domain_id = editForm.domain_id ? Number(editForm.domain_id) : null
      }
      // 密码留空表示不修改；勾选清除才置空
      if (editForm.password) {
        payload.password = editForm.password
      } else if (editClearPassword) {
        payload.password = ''
      }

      const result = await linksApi.update(editing.id, payload)
      if (result.review_status === 'pending') {
        show('已保存修改，并重新提交审核', 'info')
      } else {
        show('已保存修改', 'success')
      }
      setEditing(null)
      void loadLinks()
      void loadFilterOptions()
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
              // 有项目组则加载组内域名；否则回落到平台默认域名（未设置则为空）
              if (createForm.group_id) {
                void loadGroupDomains(createForm.group_id)
              } else {
                setGroupDomains([])
                setCreateForm((prev) => ({ ...prev, domain_id: globalDefaultDomainId }))
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
          {groupOptions.length > 0 && (
            <Select
              className="w-44"
              value={filterGroup}
              onChange={(e) => {
                setFilterGroup(e.target.value)
                setPage(1)
              }}
            >
              <option value="">全部项目组</option>
              {groupOptions.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </Select>
          )}
          {filterOptions.domains.length > 0 && (
            <Select
              className="w-48"
              value={filterDomain}
              onChange={(e) => {
                setFilterDomain(e.target.value)
                setPage(1)
              }}
            >
              <option value="">全部域名</option>
              {filterOptions.domains.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.domain}
                </option>
              ))}
            </Select>
          )}
          {filterOptions.creators.length > 0 && (
            <Select
              className="w-40"
              value={filterCreator}
              onChange={(e) => {
                setFilterCreator(e.target.value)
                setPage(1)
              }}
            >
              <option value="">全部创建人</option>
              {filterOptions.creators.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name || c.email}
                </option>
              ))}
            </Select>
          )}
          {(filterGroup || filterDomain || filterCreator || status) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setFilterGroup('')
                setFilterDomain('')
                setFilterCreator('')
                setStatus('')
                setPage(1)
              }}
            >
              重置筛选
            </Button>
          )}
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
                        {link.review_status === 'rejected' && link.review_note && (
                          <p className="mt-1 max-w-[240px] break-words text-xs text-red-600 dark:text-red-400">
                            驳回原因：{link.review_note}
                          </p>
                        )}
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
            <div className="flex gap-2">
              <Select
                aria-label="协议"
                className="w-24 shrink-0"
                value={createProtocol}
                onChange={(e) => {
                  const protocol = e.target.value
                  setCreateProtocol(protocol)
                  setCreateForm({
                    ...createForm,
                    target_url: withProtocol(protocol, splitProtocol(createForm.target_url).rest),
                  })
                }}
              >
                {URL_PROTOCOLS.map((p) => (
                  <option key={p} value={p}>
                    {p}://
                  </option>
                ))}
              </Select>
              <Input
                id="target"
                className="flex-1"
                placeholder="example.com/path"
                value={splitProtocol(createForm.target_url).rest}
                onChange={(e) =>
                  setCreateForm({ ...createForm, target_url: withProtocol(createProtocol, e.target.value) })
                }
              />
            </div>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              默认使用 https，如目标站点仅支持 http 可切换协议
            </p>
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
                maxLength={64}
                value={createForm.custom_alias}
                onChange={(e) => setCreateForm({ ...createForm, custom_alias: e.target.value })}
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                1-64 个字符，支持中文、字母、数字、下划线和短横线
              </p>
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
                  setCreateForm({
                    ...createForm,
                    group_id: gid,
                    // 切回不归属项目组时回落到平台默认域名（未设置则为空）
                    domain_id: gid ? '' : globalDefaultDomainId,
                  })
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
                    <option value="">暂无默认域名，请选择</option>
                    {groupDomains.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.domain}
                        {d.is_default_short_link ? '（默认）' : ''}
                      </option>
                    ))}
                  </Select>
                )
              ) : domains.length === 0 ? (
                <div className="flex h-10 items-center rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 text-xs text-gray-500 dark:border-gray-700 dark:bg-gray-800/40 dark:text-gray-400">
                  暂无可用域名
                </div>
              ) : (
                <Select
                  id="domain"
                  value={createForm.domain_id}
                  onChange={(e) => setCreateForm({ ...createForm, domain_id: e.target.value })}
                >
                  <option value="">{globalDefaultDomainId ? '跟随默认域名' : '暂不指定域名'}</option>
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
                    : groupDomains.some((d) => d.is_default_short_link === 1)
                      ? '默认使用项目组设定的默认域名，也可手动切换'
                      : '该项目组未设置默认域名，请手动选择'
                  : domains.length === 0
                    ? '你没有可用域名：需加入项目组且该项目组已绑定域名'
                    : globalDefaultDomainId
                      ? '未归属项目组时使用默认域名，也可手动切换'
                      : '未设置默认域名，请手动选择'}
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
          {editing?.review_status === 'rejected' && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-300">
              <p className="font-medium">该短链未通过审核，暂不可访问</p>
              {editing.review_note && <p className="mt-0.5 text-xs">驳回原因：{editing.review_note}</p>}
              <p className="mt-1 text-xs">修改并保存后将自动重新提交审核；也可以直接删除该短链。</p>
            </div>
          )}
          <div>
            <Label htmlFor="edit-code">自定义别名（短码）</Label>
            <Input
              id="edit-code"
              maxLength={64}
              value={editForm.custom_alias}
              onChange={(e) => setEditForm({ ...editForm, custom_alias: e.target.value })}
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              1-64 个字符，支持中文、字母、数字、下划线和短横线；修改后旧链接立即失效
            </p>
          </div>
          <div>
            <Label htmlFor="edit-target">目标链接</Label>
            <div className="flex gap-2">
              <Select
                aria-label="协议"
                className="w-24 shrink-0"
                value={editProtocol}
                onChange={(e) => {
                  const protocol = e.target.value
                  setEditProtocol(protocol)
                  setEditForm({
                    ...editForm,
                    target_url: withProtocol(protocol, splitProtocol(editForm.target_url).rest),
                  })
                }}
              >
                {URL_PROTOCOLS.map((p) => (
                  <option key={p} value={p}>
                    {p}://
                  </option>
                ))}
              </Select>
              <Input
                id="edit-target"
                className="flex-1"
                value={splitProtocol(editForm.target_url).rest}
                onChange={(e) =>
                  setEditForm({ ...editForm, target_url: withProtocol(editProtocol, e.target.value) })
                }
              />
            </div>
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
          <div>
            <Label htmlFor="edit-domain">短链域名</Label>
            {editDomainsLoading ? (
              <div className="flex h-10 items-center rounded-lg border border-gray-200 px-3 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
                域名加载中...
              </div>
            ) : editDomains.length === 0 ? (
              <div className="flex h-10 items-center rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 text-xs text-gray-500 dark:border-gray-700 dark:bg-gray-800/40 dark:text-gray-400">
                暂无可用域名
              </div>
            ) : (
              <Select
                id="edit-domain"
                value={editForm.domain_id}
                onChange={(e) => setEditForm({ ...editForm, domain_id: e.target.value })}
              >
                <option value="">不指定域名</option>
                {editDomains.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.domain}
                    {d.is_default_short_link ? '（默认）' : ''}
                  </option>
                ))}
              </Select>
            )}
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              只能选择当前用户有权限使用的域名，修改后短链地址会随之变化
            </p>
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
              placeholder="留空则保持原密码不变"
              value={editForm.password}
              onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
            />
            <label className="mt-2 flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 rounded border-gray-300"
                checked={editClearPassword}
                onChange={(e) => setEditClearPassword(e.target.checked)}
              />
              清除访问密码（取消密码保护）
            </label>
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
            （名称和别名可省略；别名 1-64 个字符，支持中文、字母、数字、下划线和短横线）
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
