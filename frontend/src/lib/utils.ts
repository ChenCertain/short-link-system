import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** 全站统一按北京时间（UTC+8）展示，与服务端统计口径保持一致 */
export const BEIJING_OFFSET_SECONDS = 8 * 3600

const pad2 = (n: number) => String(n).padStart(2, '0')

/** Unix 秒 → 北京时间 Date（用 UTC 取值即为北京时间） */
function beijingDate(ts: number) {
  return new Date((ts + BEIJING_OFFSET_SECONDS) * 1000)
}

/** 时间戳（秒）→ 北京时间日期时间 */
export function formatDateTime(ts?: number | null): string {
  if (!ts) return '-'
  const d = beijingDate(ts)
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`
}

/** 日期字符串（YYYY-MM-DD）→ 图表轴展示（MM-DD） */
export function formatMonthDay(date: string): string {
  return date.length >= 10 ? date.slice(5) : date
}

/** datetime-local 输入框值（按北京时间填写）→ 秒级时间戳 */
export function localInputToTimestamp(value: string): number | null {
  if (!value) return null
  const matched = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  if (!matched) return null
  const [, year, month, day, hour, minute] = matched
  const utcMs = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute))
  if (Number.isNaN(utcMs)) return null
  return Math.floor(utcMs / 1000) - BEIJING_OFFSET_SECONDS
}

/** 秒级时间戳 → datetime-local 输入框值（北京时间） */
export function timestampToLocalInput(ts?: number | null): string {
  if (!ts) return ''
  const d = beijingDate(ts)
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`
}

/** 复制文本到剪贴板 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return ok
  } catch {
    return false
  }
}

export const ROLE_LABELS: Record<string, string> = {
  super_admin: '超级管理员',
  user: '普通用户',
}
