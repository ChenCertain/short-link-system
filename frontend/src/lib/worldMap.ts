// 世界地图几何数据：解析 world-atlas 的 TopoJSON（公有领域数据），
// 投影到等距墨卡托坐标并缓存为 SVG path，避免引入 d3 等额外依赖。
import worldJson from '@/assets/countries-110m.json'
import { NUMERIC_TO_ALPHA2 } from './countries'

interface Topology {
  transform?: { scale: [number, number]; translate: [number, number] }
  arcs: number[][][]
  objects: {
    countries: {
      geometries: {
        id?: string
        type: 'Polygon' | 'MultiPolygon'
        arcs: number[][] | number[][][]
        properties?: { name?: string }
      }[]
    }
  }
}

export const WORLD_WIDTH = 960
const LAT_TOP = 84
const LAT_BOTTOM = -56

const mercatorY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))
const Y_TOP = mercatorY(LAT_TOP)
const Y_BOTTOM = mercatorY(LAT_BOTTOM)
const Y_SPAN = Y_TOP - Y_BOTTOM

export const WORLD_HEIGHT = Math.round((WORLD_WIDTH * Y_SPAN) / (2 * Math.PI))

export interface CountryShape {
  /** ISO 3166-1 两位字母码；无法映射时为 null */
  code: string | null
  name: string
  path: string
}

const toX = (lon: number) => ((Math.max(-180, Math.min(180, lon)) + 180) / 360) * WORLD_WIDTH
const toY = (lat: number) => {
  const clamped = Math.max(LAT_BOTTOM, Math.min(LAT_TOP, lat))
  return ((Y_TOP - mercatorY(clamped)) / Y_SPAN) * WORLD_HEIGHT
}

function decodeArcs(topo: Topology): number[][][] {
  const scale = topo.transform?.scale ?? [1, 1]
  const translate = topo.transform?.translate ?? [0, 0]
  return topo.arcs.map((arc) => {
    let x = 0
    let y = 0
    return arc.map(([dx, dy]) => {
      x += dx
      y += dy
      return [x * scale[0] + translate[0], y * scale[1] + translate[1]]
    })
  })
}

/** 把若干 TopoJSON 弧段拼成一个环（闭合多边形） */
function buildRing(arcIndexes: number[], arcs: number[][][]): number[][] {
  const points: number[][] = []
  for (const raw of arcIndexes) {
    const index = raw < 0 ? ~raw : raw
    const arc = arcs[index]
    if (!arc) continue
    const seq = raw < 0 ? [...arc].reverse() : arc
    for (let i = points.length ? 1 : 0; i < seq.length; i++) points.push(seq[i])
  }
  return points
}

/** 环 → SVG path，跨越 180° 经线时断开，避免横穿整张图 */
function ringToPath(ring: number[][]): string {
  let d = ''
  let prevLon: number | null = null
  for (let i = 0; i < ring.length; i++) {
    const [lon, lat] = ring[i]
    const x = toX(lon).toFixed(1)
    const y = toY(lat).toFixed(1)
    const jump = prevLon !== null && Math.abs(lon - prevLon) > 180
    d += `${i === 0 || jump ? 'M' : 'L'}${x},${y}`
    prevLon = lon
  }
  return d ? `${d}Z` : ''
}

let cachedShapes: CountryShape[] | null = null

export function getCountryShapes(): CountryShape[] {
  if (cachedShapes) return cachedShapes

  const topo = worldJson as unknown as Topology
  const arcs = decodeArcs(topo)
  const shapes: CountryShape[] = []

  for (const geometry of topo.objects.countries.geometries) {
    // 南极洲（010）在本投影纬度范围外，保留只会生成一条横贯全图的裁切线
    if (geometry.id === '010') continue

    const rings: number[][][] =
      geometry.type === 'Polygon'
        ? (geometry.arcs as number[][]).map((ring) => buildRing(ring, arcs))
        : (geometry.arcs as number[][][]).flatMap((polygon) => polygon.map((ring) => buildRing(ring, arcs)))

    const path = rings.map(ringToPath).join('')
    if (!path) continue

    const id = geometry.id ? String(geometry.id) : undefined
    // 跳过南极洲（投影范围已裁掉，保留只会是一条无用直线）
    shapes.push({
      code: id ? NUMERIC_TO_ALPHA2[id] || null : null,
      name: geometry.properties?.name || '',
      path,
    })
  }

  cachedShapes = shapes
  return shapes
}
