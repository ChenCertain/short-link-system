import { useMemo, useRef, useState } from 'react'
import { countryLabel } from '@/lib/countries'
import { getCountryShapes, WORLD_HEIGHT, WORLD_WIDTH } from '@/lib/worldMap'

export interface WorldMapDatum {
  country: string
  count: number
}

interface WorldMapProps {
  data: WorldMapDatum[]
  className?: string
}

const SCALE = ['#dbeafe', '#bfdbfe', '#93c5fd', '#3b82f6', '#1d4ed8']

/** 世界地图热力图：按国家访问量着色，悬停显示明细 */
export default function WorldMap({ data, className }: WorldMapProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ code: string; count: number; x: number; y: number } | null>(null)

  const shapes = useMemo(() => getCountryShapes(), [])

  const { counts, max } = useMemo(() => {
    const map = new Map<string, number>()
    let maxCount = 0
    for (const item of data) {
      const code = (item.country || '').toUpperCase()
      if (!code || code === '未知') continue
      const next = (map.get(code) || 0) + item.count
      map.set(code, next)
      if (next > maxCount) maxCount = next
    }
    return { counts: map, max: maxCount }
  }, [data])

  const colorOf = (count: number) => {
    if (count <= 0 || max <= 0) return ''
    const ratio = Math.log(count + 1) / Math.log(max + 1)
    const level = Math.min(SCALE.length, Math.max(1, Math.ceil(ratio * SCALE.length)))
    return SCALE[level - 1]
  }

  return (
    <div ref={wrapRef} className={`relative ${className || ''}`}>
      <svg
        viewBox={`0 0 ${WORLD_WIDTH} ${WORLD_HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-label="访问地区世界地图"
        onMouseLeave={() => setHover(null)}
      >
        <rect width={WORLD_WIDTH} height={WORLD_HEIGHT} className="fill-transparent" />
        {shapes.map((shape, index) => {
          const count = shape.code ? counts.get(shape.code) || 0 : 0
          const fill = colorOf(count)
          return (
            <path
              key={`${shape.code || 'x'}-${index}`}
              d={shape.path}
              fillRule="evenodd"
              style={fill ? { fill } : undefined}
              className={
                fill
                  ? 'stroke-white/70 transition-opacity hover:opacity-80 dark:stroke-gray-900/40'
                  : 'fill-gray-200 stroke-white/70 dark:fill-gray-700 dark:stroke-gray-900/40'
              }
              onMouseMove={(event) => {
                if (!shape.code) return
                const rect = wrapRef.current?.getBoundingClientRect()
                if (!rect) return
                setHover({
                  code: shape.code,
                  count,
                  x: event.clientX - rect.left,
                  y: event.clientY - rect.top,
                })
              }}
            />
          )
        })}
      </svg>

      {hover && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-gray-900/90 px-2.5 py-1.5 text-xs text-white shadow-lg dark:bg-gray-100/90 dark:text-gray-900"
          style={{ left: hover.x, top: hover.y - 8 }}
        >
          <span className="font-medium">{countryLabel(hover.code)}</span>
          <span className="ml-2 tabular-nums">{hover.count} 次</span>
        </div>
      )}

      <div className="mt-3 flex items-center justify-end gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
        <span>少</span>
        {SCALE.map((color) => (
          <span key={color} className="h-2.5 w-5 rounded-sm" style={{ background: color }} />
        ))}
        <span>多</span>
      </div>
    </div>
  )
}
