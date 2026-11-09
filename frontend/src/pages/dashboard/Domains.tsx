import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Copy, Globe, Plus, RefreshCw, Star, Trash2 } from 'lucide-react'
import { domainsApi } from '@/lib/api'
import type { Domain } from '@/lib/types'
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
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useToast } from '@/components/Toast'
import { copyText, formatDateTime } from '@/lib/utils'

const TYPE_LABELS: Record<string, string> = {
  short_link: '短链域名',
  admin: '管理域名',
  both: '通用域名',
}

export default function Domains() {
  const { show } = useToast()

  const [domains, setDomains] = useState<Domain[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [verifyingId, setVerifyingId] = useState<number | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState({ domain: '', type: 'both', is_default: false })
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  const [dnsInfo, setDnsInfo] = useState<{ domain: string; target: string; hosted?: boolean } | null>(null)
  // 本实例 Worker 的 workers.dev 域名，作为 CNAME 目标自动展示
  const [workerHost, setWorkerHost] = useState('')

  // 删除确认
  const [deleting, setDeleting] = useState<Domain | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [data, hostInfo] = await Promise.all([
        domainsApi.list(),
        domainsApi.workerHost().catch(() => ({ host: '', available: false })),
      ])
      setDomains(data.domains)
      setWorkerHost(hostInfo.host || '')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreateError('')
    if (!createForm.domain.trim()) {
      setCreateError('请填写域名')
      return
    }
    setCreating(true)
    try {
      const result = await domainsApi.create({
        domain: createForm.domain.trim(),
        type: createForm.type as 'short_link' | 'admin' | 'both',
        is_default_short_link: createForm.is_default,
      })
      setDnsInfo({
        domain: result.domain,
        target: result.dns_config.target || workerHost,
        hosted: result.hosted_on_cloudflare,
      })
      setCreateOpen(false)
      setCreateForm({ domain: '', type: 'both', is_default: false })
      show('域名已添加，请按提示配置 DNS', 'success')
      void load()
    } catch (err) {
      setCreateError((err as Error).message)
    } finally {
      setCreating(false)
    }
  }

  const handleVerify = async (d: Domain) => {
    setVerifyingId(d.id)
    try {
      const result = await domainsApi.verify(d.id)
      show(result.message, 'success')
      void load()
    } catch (err) {
      show((err as Error).message, 'error')
    } finally {
      setVerifyingId(null)
    }
  }

  const handleSetDefault = async (d: Domain) => {
    try {
      await domainsApi.update(d.id, { is_default_short_link: true })
      show('已设为默认短链域名', 'success')
      void load()
    } catch (err) {
      show((err as Error).message, 'error')
    }
  }

  const handleToggleStatus = async (d: Domain) => {
    try {
      await domainsApi.update(d.id, { status: d.status === 'active' ? 'disabled' : 'active' })
      show(d.status === 'active' ? '域名已停用' : '域名已启用', 'success')
      void load()
    } catch (err) {
      show((err as Error).message, 'error')
    }
  }

  const handleDelete = async () => {
    if (!deleting) return
    setDeleteLoading(true)
    try {
      await domainsApi.remove(deleting.id)
      show('域名已删除', 'success')
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
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">域名管理</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            支持多域名作为短链前缀，可绑定到项目组使用
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
          添加域名
        </Button>
      </div>

      {error && <ErrorText>{error}</ErrorText>}

      <Card>
        {loading ? (
          <LoadingBlock />
        ) : domains.length === 0 ? (
          <EmptyState title="暂无域名" description="默认使用部署域名，可在此添加自定义域名" />
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {domains.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                  <Globe className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-gray-900 dark:text-gray-100">{d.domain}</p>
                    {d.is_default_short_link === 1 && (
                      <Badge tone="purple">
                        <Star className="mr-0.5 h-3 w-3" /> 默认
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    {TYPE_LABELS[d.type] || d.type} · 添加于 {formatDateTime(d.created_at)}
                  </p>
                </div>

                <StatusBadge status={d.status} />

                <div className="flex items-center gap-1">
                  {d.status !== 'active' && (
                    <Button
                      variant="outline"
                      size="sm"
                      loading={verifyingId === d.id}
                      onClick={() => handleVerify(d)}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      验证
                    </Button>
                  )}
                  {d.status === 'active' && (
                    <Button variant="ghost" size="sm" onClick={() => handleToggleStatus(d)}>
                      {d.status === 'active' ? '停用' : '启用'}
                    </Button>
                  )}
                  {d.is_default_short_link !== 1 && (
                    <button
                      onClick={() => handleSetDefault(d)}
                      className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-amber-600 dark:hover:bg-gray-800"
                      title="设为默认短链域名"
                    >
                      <Star className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    onClick={() => setDeleting(d)}
                    className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                    title="删除"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* 添加域名 */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="添加域名"
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreate} loading={creating}>
              添加
            </Button>
          </>
        }
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <Label htmlFor="d-domain">域名 *</Label>
            <Input
              id="d-domain"
              placeholder="例如 sl.example.com"
              value={createForm.domain}
              onChange={(e) => setCreateForm({ ...createForm, domain: e.target.value })}
            />
            <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
              不需要填写 http:// 路径，仅填写域名本身
            </p>
          </div>
          <div>
            <Label htmlFor="d-type">用途</Label>
            <Select
              id="d-type"
              value={createForm.type}
              onChange={(e) => setCreateForm({ ...createForm, type: e.target.value })}
            >
              <option value="both">通用（短链 + 管理）</option>
              <option value="short_link">仅短链域名</option>
              <option value="admin">仅管理域名</option>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={createForm.is_default}
              onChange={(e) => setCreateForm({ ...createForm, is_default: e.target.checked })}
              className="h-4 w-4 rounded border-gray-300 text-brand-600"
            />
            设为默认短链域名
          </label>
          {createError && <ErrorText>{createError}</ErrorText>}
        </form>
      </Modal>

      {/* DNS 配置提示 */}
      <Modal
        open={!!dnsInfo}
        onClose={() => setDnsInfo(null)}
        title="配置 DNS 解析"
        footer={
          <>
            <Button variant="outline" onClick={() => setDnsInfo(null)}>
              稍后配置
            </Button>
            <Button onClick={() => setDnsInfo(null)}>我知道了</Button>
          </>
        }
      >
        {dnsInfo && (
          <div className="space-y-4 text-sm">
            {dnsInfo.hosted === false ? (
              <div className="flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  该域名的 DNS 不在 Cloudflare 托管：直接 CNAME 到 workers.dev 无法签发证书，HTTPS 会打不开。
                  <br />① 推荐：把域名 NS 迁移到 Cloudflare，再到 Worker → Settings → Domains &amp; Routes 绑定；
                  <br />② 或使用 Cloudflare for SaaS（Custom Hostnames）；
                  <br />③ 也可以让第三方 CDN 回源到下方地址。
                </span>
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  两种接入方式任选其一：
                  <br />① 在 Worker → Settings → Domains &amp; Routes 直接绑定该域名（推荐，自动生成记录与证书）；
                  <br />② 在 Cloudflare DNS 添加下方 CNAME 记录。
                  <br />配置完成后回到列表点击「验证」。
                </span>
              </div>
            )}
            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
                <span className="text-gray-500 dark:text-gray-400">记录类型</span>
                <span className="font-mono">CNAME</span>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
                <span className="text-gray-500 dark:text-gray-400">名称</span>
                <span className="font-mono">{dnsInfo.domain}</span>
              </div>
              <div className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
                <span className="text-gray-500 dark:text-gray-400">目标</span>
                <span className="break-all text-right font-mono">
                  {dnsInfo.target || workerHost || '未检测到（可在 wrangler.toml 配置 WORKER_HOST）'}
                </span>
              </div>
            </div>
            <Button
              variant="outline"
              className="w-full"
              onClick={async () => {
                const target = dnsInfo.target || workerHost
                const ok = await copyText(`CNAME ${dnsInfo.domain} -> ${target}`)
                show(ok ? '已复制配置' : '复制失败', ok ? 'success' : 'error')
              }}
            >
              <Copy className="h-4 w-4" />
              复制配置
            </Button>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        title="删除域名"
        description={`确定删除域名「${deleting?.domain}」吗？使用该域名的短链将无法通过该域名访问。`}
        confirmText="确认删除"
        loading={deleteLoading}
        onCancel={() => setDeleting(null)}
        onConfirm={handleDelete}
      />
    </div>
  )
}
