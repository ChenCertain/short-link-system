// 短链编辑弹窗与表单公共控件：
// 短链管理与项目组内短链共用同一套编辑体验，避免两处实现漂移。
import { useEffect, useMemo, useState } from 'react'
import { domainsApi, groupsApi, linksApi } from '@/lib/api'
import type { ProjectGroup, ShortLink } from '@/lib/types'
import { Button, ErrorText, Input, Label, Modal, Select } from '@/components/ui'
import { useToast } from '@/components/Toast'
import { cn, localInputToTimestamp, timestampToLocalInput } from '@/lib/utils'

interface EditLinkForm {
  target_url: string
  name: string
  custom_alias: string
  domain_id: string
  group_id: string
  password: string
  expires_at: string
  redirect_type: string
}

const emptyEditForm: EditLinkForm = {
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
export const URL_PROTOCOLS = ['https', 'http'] as const

export function splitProtocol(url: string): { protocol: string; rest: string } {
  const trimmed = (url || '').trim()
  const matched = /^([a-z][a-z0-9+.-]*):\/\//i.exec(trimmed)
  if (matched) {
    return { protocol: matched[1].toLowerCase(), rest: trimmed.slice(matched[0].length) }
  }
  return { protocol: 'https', rest: trimmed }
}

export function withProtocol(protocol: string, rest: string): string {
  return `${protocol}://${rest.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')}`
}

function defaultExpiryInput() {
  const d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  d.setSeconds(0, 0)
  return timestampToLocalInput(Math.floor(d.getTime() / 1000))
}

/** 过期时间选择：长期有效 / 自定义时间 分段切换，避免按钮与右侧控件重叠 */
export function ExpiryField({
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

export function flattenGroups(groups: ProjectGroup[], depth = 0): { id: number; label: string }[] {
  const result: { id: number; label: string }[] = []
  for (const g of groups) {
    result.push({ id: g.id, label: `${'　'.repeat(depth)}${g.name}` })
    if (g.children && g.children.length > 0) {
      result.push(...flattenGroups(g.children, depth + 1))
    }
  }
  return result
}

interface EditLinkModalProps {
  link: ShortLink | null
  groups: ProjectGroup[]
  onClose: () => void
  onSaved?: (reviewStatus?: string) => void
}

export function EditLinkModal({ link, groups, onClose, onSaved }: EditLinkModalProps) {
  const { show } = useToast()
  const [form, setForm] = useState<EditLinkForm>(emptyEditForm)
  const [domains, setDomains] = useState<{ id: number; domain: string; is_default_short_link: number }[]>([])
  const [domainsLoading, setDomainsLoading] = useState(false)
  const [protocol, setProtocol] = useState<string>('https')
  const [clearPassword, setClearPassword] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const groupOptions = useMemo(() => flattenGroups(groups), [groups])

  useEffect(() => {
    if (!link) return
    setError('')
    setClearPassword(false)
    setProtocol(splitProtocol(link.target_url).protocol)
    setForm({
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
    setDomains([])
    setDomainsLoading(true)
    let cancelled = false
    const request = link.group_id
      ? groupsApi.availableDomains(link.group_id)
      : domainsApi.shortLinkDomains()
    request
      .then((data) => {
        if (!cancelled) setDomains(data.domains)
      })
      .catch(() => {
        if (!cancelled) setDomains([])
      })
      .finally(() => {
        if (!cancelled) setDomainsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [link])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!link) return
    setError('')

    const aliasInput = form.custom_alias.trim()
    if (!aliasInput) {
      setError('自定义别名不能为空')
      return
    }
    if (aliasInput.length > 64) {
      setError('自定义别名最长 64 个字符')
      return
    }
    if (!/^[\p{L}\p{N}_-]+$/u.test(aliasInput)) {
      setError('自定义别名只能包含中文、字母、数字、下划线和短横线')
      return
    }
    if (['login', 'init', 'dashboard', 'api', 'assets', 'cdn-cgi'].includes(aliasInput.toLowerCase())) {
      setError('该别名是系统保留路径，请更换')
      return
    }
    if (!splitProtocol(form.target_url).rest.trim()) {
      setError('请填写目标链接')
      return
    }

    setSaving(true)
    try {
      const originalDomainId = link.domain_id ? String(link.domain_id) : ''
      const payload: Parameters<typeof linksApi.update>[1] = {
        target_url: form.target_url,
        name: form.name,
        short_code: aliasInput,
        group_id: form.group_id ? Number(form.group_id) : null,
        expires_at: localInputToTimestamp(form.expires_at),
        redirect_type: Number(form.redirect_type),
      }

      // 仅当用户主动修改域名时才提交，避免无权限域名影响保存
      if (form.domain_id !== originalDomainId) {
        payload.domain_id = form.domain_id ? Number(form.domain_id) : null
      }
      // 密码留空表示不修改；勾选清除才置空
      if (form.password) {
        payload.password = form.password
      } else if (clearPassword) {
        payload.password = ''
      }

      const result = await linksApi.update(link.id, payload)
      if (result.review_status === 'pending') {
        show('已保存修改，并重新提交审核', 'info')
      } else {
        show('已保存修改', 'success')
      }
      onSaved?.(result.review_status)
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={!!link}
      onClose={onClose}
      title="编辑短链"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={handleSave} loading={saving}>
            保存
          </Button>
        </>
      }
    >
      <form onSubmit={handleSave} className="space-y-4">
        {link?.review_status === 'rejected' && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-300">
            <p className="font-medium">该短链未通过审核，暂不可访问</p>
            {link.review_note && <p className="mt-0.5 text-xs">驳回原因：{link.review_note}</p>}
            <p className="mt-1 text-xs">修改并保存后将自动重新提交审核；也可以直接删除该短链。</p>
          </div>
        )}
        <div>
          <Label htmlFor="edit-code">自定义别名（短码）</Label>
          <Input
            id="edit-code"
            maxLength={64}
            value={form.custom_alias}
            onChange={(e) => setForm({ ...form, custom_alias: e.target.value })}
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
              value={protocol}
              onChange={(e) => {
                const next = e.target.value
                setProtocol(next)
                setForm({ ...form, target_url: withProtocol(next, splitProtocol(form.target_url).rest) })
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
              value={splitProtocol(form.target_url).rest}
              onChange={(e) => setForm({ ...form, target_url: withProtocol(protocol, e.target.value) })}
            />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="edit-name">名称</Label>
            <Input id="edit-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="edit-group">所属项目组</Label>
            <Select
              id="edit-group"
              value={form.group_id}
              onChange={(e) => setForm({ ...form, group_id: e.target.value })}
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
          {domainsLoading ? (
            <div className="flex h-10 items-center rounded-lg border border-gray-200 px-3 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
              域名加载中...
            </div>
          ) : domains.length === 0 ? (
            <div className="flex h-10 items-center rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 text-xs text-gray-500 dark:border-gray-700 dark:bg-gray-800/40 dark:text-gray-400">
              暂无可用域名
            </div>
          ) : (
            <Select
              id="edit-domain"
              value={form.domain_id}
              onChange={(e) => setForm({ ...form, domain_id: e.target.value })}
            >
              <option value="">不指定域名</option>
              {domains.map((d) => (
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
            value={form.expires_at}
            onChange={(value) => setForm({ ...form, expires_at: value })}
          />
          <div className="min-w-0">
            <Label htmlFor="edit-redirect">跳转类型</Label>
            <Select
              id="edit-redirect"
              value={form.redirect_type}
              onChange={(e) => setForm({ ...form, redirect_type: e.target.value })}
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
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
          <label className="mt-2 flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 rounded border-gray-300"
              checked={clearPassword}
              onChange={(e) => setClearPassword(e.target.checked)}
            />
            清除访问密码（取消密码保护）
          </label>
        </div>

        {error && <ErrorText>{error}</ErrorText>}
      </form>
    </Modal>
  )
}
