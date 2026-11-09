import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, ShieldCheck, X } from 'lucide-react'
import { linksApi } from '@/lib/api'
import type { ReviewLink } from '@/lib/types'
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
} from '@/components/ui'
import { useToast } from '@/components/Toast'
import { formatDateTime } from '@/lib/utils'

function shortUrl(link: ReviewLink) {
  return link.domain_name ? `https://${link.domain_name}/${link.short_code}` : `/${link.short_code}`
}

export default function Review() {
  const { show } = useToast()

  const [links, setLinks] = useState<ReviewLink[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [approving, setApproving] = useState<number | null>(null)
  const [rejecting, setRejecting] = useState<ReviewLink | null>(null)
  const [note, setNote] = useState('')
  const [rejectLoading, setRejectLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await linksApi.pendingReviews()
      setLinks(data.links)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleApprove = async (link: ReviewLink) => {
    setApproving(link.id)
    try {
      await linksApi.review(link.id, { approved: true })
      show('已通过审核，用户将收到邮件通知', 'success')
      void load()
    } catch (err) {
      show((err as Error).message, 'error')
    } finally {
      setApproving(null)
    }
  }

  const handleReject = async () => {
    if (!rejecting) return
    setRejectLoading(true)
    try {
      await linksApi.review(rejecting.id, { approved: false, note: note.trim() || undefined })
      show('已驳回，用户将收到邮件通知', 'success')
      setRejecting(null)
      setNote('')
      void load()
    } catch (err) {
      show((err as Error).message, 'error')
    } finally {
      setRejectLoading(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-gray-900 dark:text-gray-100">
            <ShieldCheck className="h-5 w-5 text-brand-600" />
            短链审核
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            共 {links.length} 条待审核 · 开启审核的用户新建短链后需在此通过才能访问
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          刷新
        </Button>
      </div>

      <Card>
        {error && <div className="px-4 pt-3"><ErrorText>{error}</ErrorText></div>}

        {loading ? (
          <LoadingBlock />
        ) : links.length === 0 ? (
          <EmptyState title="当前暂无待审核短链" description="用户提交审核后会显示在这里" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">
                <tr>
                  <th className="px-4 py-3 font-medium">短链 / 名称</th>
                  <th className="px-4 py-3 font-medium">目标链接</th>
                  <th className="hidden px-4 py-3 font-medium lg:table-cell">提交人</th>
                  <th className="hidden px-4 py-3 font-medium lg:table-cell">项目组</th>
                  <th className="hidden px-4 py-3 font-medium xl:table-cell">提交时间</th>
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
                        <Badge tone="yellow">待审核</Badge>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
                        {link.name || '（未命名）'}
                      </p>
                    </td>
                    <td className="max-w-[240px] px-4 py-3">
                      <a
                        href={link.target_url}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate text-gray-600 hover:text-brand-600 dark:text-gray-400"
                        title={link.target_url}
                      >
                        {link.target_url}
                      </a>
                      <p className="mt-0.5 truncate text-xs text-gray-400">{shortUrl(link)}</p>
                    </td>
                    <td className="hidden px-4 py-3 lg:table-cell">
                      <p className="text-gray-700 dark:text-gray-300">{link.creator_name || '-'}</p>
                      <p className="text-xs text-gray-400">{link.creator_email}</p>
                    </td>
                    <td className="hidden px-4 py-3 text-gray-600 dark:text-gray-400 lg:table-cell">
                      {link.group_name || '-'}
                    </td>
                    <td className="hidden px-4 py-3 text-xs text-gray-500 dark:text-gray-400 xl:table-cell">
                      {formatDateTime(link.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          onClick={() => handleApprove(link)}
                          loading={approving === link.id}
                        >
                          <Check className="h-4 w-4" />
                          通过
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setRejecting(link)
                            setNote('')
                          }}
                        >
                          <X className="h-4 w-4" />
                          驳回
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        title="驳回短链"
        footer={
          <>
            <Button variant="outline" onClick={() => setRejecting(null)}>
              取消
            </Button>
            <Button variant="danger" onClick={handleReject} loading={rejectLoading}>
              确认驳回
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            确定驳回短链「{rejecting?.name || rejecting?.short_code}」吗？
          </p>
          <div>
            <Label htmlFor="review-note">驳回原因（可选，会通过邮件告知用户）</Label>
            <Input
              id="review-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="例如：目标链接与业务无关"
            />
          </div>
        </div>
      </Modal>
    </div>
  )
}
