import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Globe2, TrendingUp } from 'lucide-react'
import { statsApi } from '@/lib/api'
import type { OverviewStats, StatsGeo, StatsScopeInfo, TopLinkItem } from '@/lib/types'
import { Card, CardHeader, LoadingBlock } from '@/components/ui'
import WorldMap from '@/components/WorldMap'
import RegionRanking from '@/components/RegionRanking'
import { groupSelectOptions } from '@/lib/groups'
import { formatMonthDay } from '@/lib/utils'

export default function Analytics() {
  const [scope, setScope] = useState<StatsScopeInfo | null>(null)
  const [groupId, setGroupId] = useState<number | ''>('')
  const [stats, setStats] = useState<OverviewStats | null>(null)
  const [geo, setGeo] = useState<StatsGeo | null>(null)
  const [trend, setTrend] = useState<{ date: string; clicks: number }[]>([])
  const [topLinks, setTopLinks] = useState<TopLinkItem[]>([])
  const [days, setDays] = useState(30)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const groupOptions = useMemo(() => (scope ? groupSelectOptions(scope.groups) : []), [scope])

  useEffect(() => {
    statsApi
      .scope()
      .then((data) => {
        setScope(data)
        // 单组管理员直接锁定到自己管理的组，多组时默认全部
        if (!data.all && data.groups.length === 1) setGroupId(data.groups[0].id)
      })
      .catch((err: Error) => setError(err.message))
  }, [])

  useEffect(() => {
    if (!scope) return
    const selected = groupId === '' ? undefined : groupId
    setLoading(true)
    setError('')
    Promise.all([statsApi.overview(selected), statsApi.trend(days, selected), statsApi.geo(days, selected), statsApi.topLinks(days, selected)])
      .then(([s, t, g, top]) => {
        setStats(s)
        setTrend(t.trend)
        setGeo(g)
        setTopLinks(top.links)
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }, [scope, groupId, days])

  if (error && !stats) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200">
        <p className="font-medium">无法查看指标统计</p>
        <p className="mt-1 text-xs">{error}</p>
        <p className="mt-1 text-xs">如需查看组内数据，请联系超级管理员为你的项目组开启「查看短链数据」权限。</p>
      </div>
    )
  }

  if (loading && !stats) return <LoadingBlock />

  const scopeText =
    scope && !scope.all
      ? groupId === ''
        ? '我管理的项目组（含子组）'
        : groupOptions.find((item) => item.id === groupId)?.label || '当前项目组'
      : groupId === ''
        ? '全站数据'
        : groupOptions.find((item) => item.id === groupId)?.label || '当前项目组'

  const coveredCountries = (geo?.countries || []).filter((item) => item.count > 0 && item.country !== '未知').length
  const rangeClicks = trend.reduce((sum, item) => sum + item.clicks, 0)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">指标统计</h1>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
            <TrendingUp className="h-4 w-4" />
            {scopeText} · 统计时间统一为北京时间（UTC+8）
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {groupOptions.length > 0 && (
            <select
              className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
              value={groupId}
              onChange={(event) => setGroupId(event.target.value ? Number(event.target.value) : '')}
            >
              <option value="">{scope?.all ? '全站数据' : '我管理的组（含子组）'}</option>
              {groupOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {'　'.repeat(item.depth)}
                  {item.label}
                </option>
              ))}
            </select>
          )}
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
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: '短链总数', value: stats?.total_links ?? 0 },
          { label: `${days} 天访问量`, value: rangeClicks },
          { label: '今日访问', value: stats?.today_clicks ?? 0 },
          { label: '覆盖国家/地区', value: coveredCountries },
        ].map((item) => (
          <Card key={item.label} className="p-5">
            <p className="text-sm text-gray-500 dark:text-gray-400">{item.label}</p>
            <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-gray-100">{item.value}</p>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader title="访问趋势" description={`最近 ${days} 天每日访问量（北京时间自然日）`} />
        <div className="h-72 px-2 py-4">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={trend} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" opacity={0.4} />
              <XAxis
                dataKey="date"
                tickFormatter={formatMonthDay}
                tick={{ fontSize: 12 }}
                stroke="#9ca3af"
                minTickGap={12}
              />
              <YAxis tick={{ fontSize: 12 }} stroke="#9ca3af" allowDecimals={false} width={40} />
              <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }} />
              <Bar dataKey="clicks" name="访问量" fill="#2563eb" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader
            title="地区分布"
            description={`最近 ${days} 天访问者所在国家/地区`}
            action={
              <span className="flex items-center gap-1 text-xs text-gray-400">
                <Globe2 className="h-3.5 w-3.5" />
                共 {geo?.total ?? 0} 次访问
              </span>
            }
          />
          <div className="px-5 pb-5 pt-2">
            <WorldMap data={geo?.countries || []} />
          </div>
        </Card>

        <Card>
          <CardHeader title="地区排行 Top 10" description="国家 / 省份维度" />
          <div className="pb-3">
            <RegionRanking regions={geo?.regions || []} total={geo?.total || 0} />
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="热门短链 Top 10" description={`最近 ${days} 天访问量排序`} />
        {topLinks.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-gray-400">暂无数据</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">
                <tr>
                  <th className="px-4 py-3 font-medium">短链</th>
                  <th className="hidden px-4 py-3 font-medium sm:table-cell">项目组</th>
                  <th className="px-4 py-3 font-medium">区间访问</th>
                  <th className="px-4 py-3 text-right font-medium">详情</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {topLinks.map((link) => (
                  <tr key={link.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900 dark:text-gray-100">
                        {link.domain_name ? `${link.domain_name}/` : '/'}
                        {link.short_code}
                      </p>
                      <p className="truncate text-xs text-gray-500 dark:text-gray-400">{link.name || '未命名'}</p>
                    </td>
                    <td className="hidden px-4 py-3 text-gray-600 dark:text-gray-400 sm:table-cell">
                      {link.group_name || '-'}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-gray-700 dark:text-gray-300">{link.clicks}</td>
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
