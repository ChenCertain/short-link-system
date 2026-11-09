import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { linksApi, statsApi } from '@/lib/api'
import type { OverviewStats, ShortLink } from '@/lib/types'
import { Badge, Card, CardHeader, LoadingBlock, StatusBadge } from '@/components/ui'
import { formatDate } from '@/lib/utils'

export default function Analytics() {
  const [stats, setStats] = useState<OverviewStats | null>(null)
  const [trend, setTrend] = useState<{ date: string; clicks: number }[]>([])
  const [topLinks, setTopLinks] = useState<ShortLink[]>([])
  const [days, setDays] = useState(30)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([statsApi.overview(), statsApi.trend(days), linksApi.list({ pageSize: 200 })])
      .then(([s, t, l]) => {
        setStats(s)
        setTrend(t.trend)
        setTopLinks([...l.links].sort((a, b) => b.click_count - a.click_count).slice(0, 10))
      })
      .catch(() => {
        // 忽略错误，展示空状态
      })
      .finally(() => setLoading(false))
  }, [days])

  if (loading && !stats) return <LoadingBlock />

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">指标统计</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">全局短链访问与状态概况</p>
        </div>
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
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: '短链总数', value: stats?.total_links ?? 0 },
          { label: '总访问量', value: stats?.total_clicks ?? 0 },
          { label: '今日访问', value: stats?.today_clicks ?? 0 },
          { label: '活跃短链', value: stats?.active_links ?? 0 },
        ].map((item) => (
          <Card key={item.label} className="p-5">
            <p className="text-sm text-gray-500 dark:text-gray-400">{item.label}</p>
            <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-gray-100">{item.value}</p>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader title="访问趋势" description={`最近 ${days} 天每日访问量`} />
        <div className="h-72 px-2 py-4">
          {trend.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-gray-400">暂无访问数据</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trend} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" opacity={0.4} />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="#9ca3af" />
                <YAxis tick={{ fontSize: 12 }} stroke="#9ca3af" allowDecimals={false} width={40} />
                <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }} />
                <Bar dataKey="clicks" name="访问量" fill="#2563eb" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="热门短链 Top 10" description="按累计访问量排序" />
        {topLinks.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-gray-400">暂无短链</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">
                <tr>
                  <th className="px-4 py-3 font-medium">短链</th>
                  <th className="px-4 py-3 font-medium">状态</th>
                  <th className="px-4 py-3 font-medium">访问量</th>
                  <th className="hidden px-4 py-3 font-medium sm:table-cell">创建时间</th>
                  <th className="px-4 py-3 text-right font-medium">详情</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {topLinks.map((link) => (
                  <tr key={link.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900 dark:text-gray-100">/{link.short_code}</p>
                      <p className="truncate text-xs text-gray-500 dark:text-gray-400">{link.name || '未命名'}</p>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={link.status} />
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone="blue">{link.click_count}</Badge>
                    </td>
                    <td className="hidden px-4 py-3 text-xs text-gray-500 dark:text-gray-400 sm:table-cell">
                      {formatDate(link.created_at)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to={`/dashboard/links/${link.id}`}
                        className="text-brand-600 hover:underline dark:text-brand-400"
                      >
                        查看统计
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
