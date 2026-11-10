import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { ArrowLeft, Copy, ExternalLink } from 'lucide-react'
import { statsApi } from '@/lib/api'
import type { LinkStats } from '@/lib/types'
import { Badge, Button, Card, CardHeader, LoadingBlock, StatusBadge } from '@/components/ui'
import { QRCodeModal } from '@/components/QRCodeModal'
import WorldMap from '@/components/WorldMap'
import RegionRanking from '@/components/RegionRanking'
import { useToast } from '@/components/Toast'
import { copyText, formatDateTime, formatMonthDay } from '@/lib/utils'

function shortUrl(domain: string | null | undefined, code: string) {
  const path = domain ? `https://${domain}/${code}` : `/${code}`
  return path.startsWith('/') ? `${window.location.origin}${path}` : path
}

export default function LinkDetail() {
  const { id } = useParams()
  const linkId = Number(id)
  const { show } = useToast()

  const [data, setData] = useState<LinkStats | null>(null)
  const [days, setDays] = useState(7)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [qrOpen, setQrOpen] = useState(false)

  useEffect(() => {
    if (!linkId) return
    setLoading(true)
    setError('')
    statsApi
      .link(linkId, days)
      .then(setData)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }, [linkId, days])

  if (loading && !data) return <LoadingBlock />
  if (error) {
    return (
      <div className="space-y-4">
        <Link
          to="/dashboard/links"
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400"
        >
          <ArrowLeft className="h-4 w-4" />
          返回短链列表
        </Link>
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200">
          <p className="font-medium">无法查看该短链的数据</p>
          <p className="mt-1 text-xs">{error}</p>
          <p className="mt-1 text-xs">如需查看点击趋势与访问明细，请联系项目组管理员开启「查看短链数据」权限。</p>
        </div>
      </div>
    )
  }
  if (!data) return null

  const link = data.link
  const url = shortUrl(link.domain_name, link.short_code)

  return (
    <div className="space-y-5">
      <Link
        to="/dashboard/links"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400"
      >
        <ArrowLeft className="h-4 w-4" />
        返回短链列表
      </Link>

      {link.review_status === 'rejected' && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-300">
          <p className="font-medium">该短链未通过审核，暂不可访问</p>
          {link.review_note && <p className="mt-1 text-xs">驳回原因：{link.review_note}</p>}
          <p className="mt-1 text-xs">可在「短链管理」中编辑后重新提交审核，或直接删除。</p>
        </div>
      )}

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {link.name || link.short_code}
              </h1>
              <StatusBadge status={link.status} />
              <Badge tone="gray">{link.redirect_type} 跳转</Badge>
            </div>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-sm text-brand-600 hover:underline dark:text-brand-400"
            >
              {url}
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <p className="mt-2 break-all text-sm text-gray-500 dark:text-gray-400">→ {link.target_url}</p>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
              <span>创建者：{link.creator_name || '-'}</span>
              <span>项目组：{link.group_name || '无'}</span>
              <span>创建时间：{formatDateTime(link.created_at)}</span>
              {link.expires_at && <span>过期时间：{formatDateTime(link.expires_at)}</span>}
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                const ok = await copyText(url)
                show(ok ? '已复制' : '复制失败', ok ? 'success' : 'error')
              }}
            >
              <Copy className="h-4 w-4" />
              复制
            </Button>
            <Button variant="outline" size="sm" onClick={() => setQrOpen(true)}>
              二维码
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-5">
          <p className="text-sm text-gray-500 dark:text-gray-400">总访问量</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-gray-100">{link.click_count}</p>
        </Card>
        <Card className="p-5">
          <p className="text-sm text-gray-500 dark:text-gray-400">区间访问量</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-gray-100">
            {data.trend.reduce((sum, item) => sum + item.clicks, 0)}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-sm text-gray-500 dark:text-gray-400">覆盖国家/地区</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-gray-100">
            {data.countries.filter((item) => item.country !== '未知').length}
          </p>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="访问趋势"
          action={
            <div className="flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
              {[7, 30].map((d) => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                    days === d
                      ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100'
                      : 'text-gray-500 dark:text-gray-400'
                  }`}
                >
                  {d} 天
                </button>
              ))}
            </div>
          }
        />
        <div className="h-64 px-2 py-4">
          {data.trend.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-gray-400">暂无访问数据</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.trend} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" opacity={0.4} />
                <XAxis dataKey="date" tickFormatter={formatMonthDay} tick={{ fontSize: 12 }} stroke="#9ca3af" />
                <YAxis tick={{ fontSize: 12 }} stroke="#9ca3af" allowDecimals={false} width={40} />
                <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }} />
                <Line type="monotone" dataKey="clicks" name="访问量" stroke="#2563eb" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="地区分布" description="访问者所在国家/地区，颜色越深访问越多" />
        <div className="px-5 pb-5 pt-2">
          <WorldMap data={data.countries} />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="来源分布" description="最近访问的来源页面" />
          <div className="h-64 px-2 py-4">
            {data.referers.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-gray-400">暂无数据</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.referers} layout="vertical" margin={{ left: 8, right: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" opacity={0.4} />
                  <XAxis type="number" tick={{ fontSize: 11 }} stroke="#9ca3af" allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="referer"
                    tick={{ fontSize: 11 }}
                    stroke="#9ca3af"
                    width={110}
                  />
                  <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }} />
                  <Bar dataKey="count" name="访问次数" fill="#2563eb" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="地区排行 Top 10" description="国家 / 省份维度" />
          <div className="pb-3">
            <RegionRanking
              regions={data.regions}
              total={data.regions.reduce((sum, item) => sum + item.count, 0)}
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="浏览器分布" />
          <div className="h-56 px-2 py-4">
            {data.browsers.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-gray-400">暂无数据</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.browsers} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" opacity={0.4} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" allowDecimals={false} width={36} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }} />
                  <Bar dataKey="count" name="访问次数" fill="#7c3aed" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="设备与系统" />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-medium uppercase text-gray-400">设备</p>
              <ul className="space-y-1.5 text-sm">
                {data.devices.length === 0 && <li className="text-gray-400">暂无数据</li>}
                {data.devices.map((d) => (
                  <li key={d.name} className="flex justify-between text-gray-700 dark:text-gray-300">
                    <span>{d.name}</span>
                    <span className="text-gray-500">{d.count}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-2 text-xs font-medium uppercase text-gray-400">操作系统</p>
              <ul className="space-y-1.5 text-sm">
                {data.os.length === 0 && <li className="text-gray-400">暂无数据</li>}
                {data.os.map((d) => (
                  <li key={d.name} className="flex justify-between text-gray-700 dark:text-gray-300">
                    <span>{d.name}</span>
                    <span className="text-gray-500">{d.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="最近访问明细" description="最近 50 条访问记录（含访问者 IP）" />
        {!data.recent || data.recent.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-gray-400">暂无访问数据</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">
                <tr>
                  <th className="px-4 py-3 font-medium">访问时间</th>
                  <th className="px-4 py-3 font-medium">IP</th>
                  <th className="hidden px-4 py-3 font-medium sm:table-cell">地区</th>
                  <th className="hidden px-4 py-3 font-medium md:table-cell">来源</th>
                  <th className="hidden px-4 py-3 font-medium lg:table-cell">设备</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {data.recent.map((record, index) => (
                  <tr key={`${record.timestamp}-${index}`} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400">
                      {formatDateTime(record.timestamp)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-gray-700 dark:text-gray-300">
                      {record.ip || '-'}
                    </td>
                    <td className="hidden px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400 sm:table-cell">
                      {[record.country, record.region, record.city].filter(Boolean).join(' / ') || '-'}
                    </td>
                    <td className="hidden max-w-[220px] px-4 py-2.5 md:table-cell">
                      <span className="block truncate text-xs text-gray-500 dark:text-gray-400" title={record.referer || ''}>
                        {record.referer || '直接访问'}
                      </span>
                    </td>
                    <td className="hidden max-w-[260px] px-4 py-2.5 lg:table-cell">
                      <span className="block truncate text-xs text-gray-500 dark:text-gray-400" title={record.user_agent || ''}>
                        {record.user_agent || '-'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <QRCodeModal open={qrOpen} onClose={() => setQrOpen(false)} url={url} />
    </div>
  )
}
