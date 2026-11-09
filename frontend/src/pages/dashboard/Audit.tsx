import { useCallback, useEffect, useState } from 'react'
import { ScrollText } from 'lucide-react'
import { auditApi } from '@/lib/api'
import type { AuditLog } from '@/lib/types'
import { Badge, Button, Card, EmptyState, ErrorText, LoadingBlock, Select } from '@/components/ui'
import { formatDateTime } from '@/lib/utils'

const ACTION_LABELS: Record<string, string> = {
  login: '登录',
  init_admin: '初始化管理员',
  create_link: '创建短链',
  update_link: '更新短链',
  delete_link: '删除短链',
  approve_link: '通过审核',
  reject_link: '驳回审核',
  toggle_display: '首页展示',
  batch_import_links: '批量导入短链',
  create_user: '创建用户',
  update_user: '更新用户',
  delete_user: '删除用户',
  create_group: '创建项目组',
  update_group: '更新项目组',
  delete_group: '删除项目组',
  add_group_member: '添加组成员',
  remove_group_member: '移除组成员',
  bind_group_domain: '绑定项目组域名',
  unbind_group_domain: '解绑项目组域名',
  add_domain: '添加域名',
  update_domain: '更新域名',
  delete_domain: '删除域名',
  update_config: '更新系统配置',
}

function actionLabel(action: string) {
  return ACTION_LABELS[action] || action
}

function describeDetail(detail: string | null): string {
  if (!detail) return '-'
  try {
    const parsed = JSON.parse(detail) as Record<string, unknown>
    const parts = Object.entries(parsed)
      .filter(([, value]) => value !== null && value !== undefined && value !== '')
      .map(([key, value]) => {
        const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
        return `${key}: ${text.length > 60 ? `${text.slice(0, 60)}…` : text}`
      })
    return parts.length > 0 ? parts.join(' · ') : '-'
  } catch {
    return detail
  }
}

export default function Audit() {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [action, setAction] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const pageSize = 30
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await auditApi.list({ page, pageSize, action })
      setLogs(data.logs)
      setTotal(data.total)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [page, action])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-gray-900 dark:text-gray-100">
            <ScrollText className="h-5 w-5 text-brand-600" />
            操作审计
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">共 {total} 条操作记录</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          刷新
        </Button>
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-3 dark:border-gray-800">
          <Select
            className="w-48"
            value={action}
            onChange={(e) => {
              setAction(e.target.value)
              setPage(1)
            }}
          >
            <option value="">全部操作</option>
            {Object.entries(ACTION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <span className="text-xs text-gray-400">记录登录、短链、项目组、域名与系统配置等敏感操作</span>
        </div>

        {error && (
          <div className="px-4 pt-3">
            <ErrorText>{error}</ErrorText>
          </div>
        )}

        {loading ? (
          <LoadingBlock />
        ) : logs.length === 0 ? (
          <EmptyState title="暂无操作记录" description="系统会自动记录管理员与用户的敏感操作" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">时间</th>
                    <th className="px-4 py-3 font-medium">操作人</th>
                    <th className="px-4 py-3 font-medium">操作</th>
                    <th className="hidden px-4 py-3 font-medium md:table-cell">对象</th>
                    <th className="px-4 py-3 font-medium">IP</th>
                    <th className="hidden px-4 py-3 font-medium xl:table-cell">详情</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {logs.map((log) => (
                    <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                        {formatDateTime(log.timestamp)}
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-gray-700 dark:text-gray-300">{log.user_name || log.user_email || '-'}</p>
                        <p className="text-xs text-gray-400">{log.user_email}</p>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone="blue">{actionLabel(log.action)}</Badge>
                      </td>
                      <td className="hidden px-4 py-3 text-xs text-gray-500 dark:text-gray-400 md:table-cell">
                        {log.target_type ? `${log.target_type}${log.target_id ? ` #${log.target_id}` : ''}` : '-'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-600 dark:text-gray-400">
                        {log.ip || '-'}
                      </td>
                      <td className="hidden max-w-[320px] px-4 py-3 xl:table-cell">
                        <p className="truncate text-xs text-gray-500 dark:text-gray-400" title={log.detail || ''}>
                          {describeDetail(log.detail)}
                        </p>
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
    </div>
  )
}
