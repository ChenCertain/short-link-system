import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Activity, Clock, FolderTree, Link2, MousePointerClick, Users } from 'lucide-react'
import { linksApi, statsApi } from '@/lib/api'
import type { OverviewStats, ShortLink } from '@/lib/types'
import { Button, Card, CardHeader, LoadingBlock, StatusBadge } from '@/components/ui'
import { formatDateTime, formatMonthDay } from '@/lib/utils'

function StatCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string
  value: number | string
  icon: typeof Link2
  tone: string
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-gray-100">{value}</p>
        </div>
        <div className={`rounded-lg p-2.5 ${tone}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </Card>
  )
}

export default function Overview() {
  const [stats, setStats] = useState<OverviewStats | null>(null)
  const [trend, setTrend] = useState<{ date: string; clicks: number }[]>([])
  const [links, setLinks] = useState<ShortLink[]>([])
  const [days, setDays] = useState(7)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    setError('')
    Promise.all([statsApi.overview(), statsApi.trend(days), linksApi.list({ pageSize: 5 })])
      .then(([s, t, l]) => {
        setStats(s)
        setTrend(t.trend)
        setLinks(l.links)
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }, [days])

  if (loading && !stats) return <LoadingBlock />

  if (error && !stats) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200">
        <p className="font-medium">无法查看概览数据</p>
        <p className="mt-1 text-xs">{error}</p>
        <p className="mt-1 text-xs">项目组管理员需要所在组开启「查看短链数据」权限。</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">概览</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {stats?.scope === 'groups' ? '所在项目组（含全部子组）的运行情况' : '短链系统整体运行情况'}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="短链总数"
          value={stats?.total_links ?? 0}
          icon={Link2}
          tone="bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
        />
        <StatCard
          label="活跃短链"
          value={stats?.active_links ?? 0}
          icon={Activity}
          tone="bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400"
        />
        <StatCard
          label="总访问量"
          value={stats?.total_clicks ?? 0}
          icon={MousePointerClick}
          tone="bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400"
        />
        <StatCard
          label="今日访问"
          value={stats?.today_clicks ?? 0}
          icon={Clock}
          tone="bg-orange-50 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400"
        />
        <StatCard
          label={stats?.scope === 'groups' ? '组内成员' : '用户数'}
          value={stats?.total_users ?? 0}
          icon={Users}
          tone="bg-cyan-50 text-cyan-600 dark:bg-cyan-900/30 dark:text-cyan-400"
        />
        <StatCard
          label={stats?.scope === 'groups' ? '项目组（含子组）' : '项目组'}
          value={stats?.total_groups ?? 0}
          icon={FolderTree}
          tone="bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400"
        />
        <StatCard
          label="已停用"
          value={stats?.disabled_links ?? 0}
          icon={Activity}
          tone="bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400"
        />
        <StatCard
          label="已过期"
          value={stats?.expired_links ?? 0}
          icon={Clock}
          tone="bg-yellow-50 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400"
        />
      </div>

      <Card>
        <CardHeader
          title="访问趋势"
          description="按北京时间（UTC+8）自然日统计访问次数"
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
        <div className="h-72 px-2 py-4">
          {trend.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-gray-400">暂无访问数据</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="clicks" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563eb" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" opacity={0.4} />
                <XAxis dataKey="date" tickFormatter={formatMonthDay} tick={{ fontSize: 12 }} stroke="#9ca3af" />
                <YAxis tick={{ fontSize: 12 }} stroke="#9ca3af" allowDecimals={false} width={40} />
                <Tooltip
                  contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }}
                  labelStyle={{ color: '#6b7280' }}
                />
                <Area type="monotone" dataKey="clicks" name="访问量" stroke="#2563eb" strokeWidth={2} fill="url(#clicks)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="最近创建的短链"
          action={
            <Link to="/dashboard/links">
              <Button variant="outline" size="sm">
                查看全部
              </Button>
            </Link>
          }
        />
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {links.length === 0 && <p className="px-5 py-8 text-center text-sm text-gray-400">暂无短链</p>}
          {links.map((link) => (
            <div key={link.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                  {link.name || link.short_code}
                </p>
                <p className="truncate text-xs text-gray-500 dark:text-gray-400">{link.target_url}</p>
              </div>
              <StatusBadge status={link.status} />
              <span className="text-xs text-gray-400">{formatDateTime(link.created_at)}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
