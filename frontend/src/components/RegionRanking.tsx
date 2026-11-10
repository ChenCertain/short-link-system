import type { GeoRegion } from '@/lib/types'
import { countryLabel } from '@/lib/countries'

interface RegionRankingProps {
  regions: GeoRegion[]
  total: number
  limit?: number
}

/** 地区排行：国家 / 省份维度的访问量占比 */
export default function RegionRanking({ regions, total, limit = 10 }: RegionRankingProps) {
  const rows = regions.filter((item) => item.count > 0)
  const sum = total || rows.reduce((acc, item) => acc + item.count, 0)

  if (rows.length === 0) {
    return <p className="px-5 py-10 text-center text-sm text-gray-400">暂无访问数据</p>
  }

  return (
    <ul className="divide-y divide-gray-100 px-5 dark:divide-gray-800">
      {rows.slice(0, limit).map((item, index) => {
        const percent = sum > 0 ? (item.count / sum) * 100 : 0
        const label = item.region
          ? `${countryLabel(item.country)} · ${item.region}`
          : countryLabel(item.country)
        return (
          <li key={`${item.country}-${item.region}-${index}`} className="py-2.5">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <span className="w-4 shrink-0 text-xs tabular-nums text-gray-400">{index + 1}</span>
                <span className="truncate text-gray-700 dark:text-gray-300">{label}</span>
              </span>
              <span className="shrink-0 tabular-nums text-gray-500 dark:text-gray-400">
                {item.count}
                <span className="ml-1 text-xs text-gray-400">({percent.toFixed(1)}%)</span>
              </span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
              <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.max(percent, 2)}%` }} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}
