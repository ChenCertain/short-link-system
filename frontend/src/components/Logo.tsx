import { useId } from 'react'
import { cn } from '@/lib/utils'

/**
 * 品牌标识：渐变圆角方块 + 链环（∞ 造型），几何简洁，小尺寸也清晰。
 */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  // 同一页面可能渲染多个实例，渐变 id 必须唯一，否则会被后一个覆盖
  const uid = useId().replace(/[:]/g, '')
  const gradientId = `logo-grad-${uid}`

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={cn('shrink-0', className)}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="2" y1="1" x2="30" y2="31" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2563eb" />
          <stop offset="0.55" stopColor="#1d8cf8" />
          <stop offset="1" stopColor="#06b6d4" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${gradientId})`} />
      {/* 顶部高光，增强质感 */}
      <path d="M0 9A9 9 0 0 1 9 0h14a9 9 0 0 1 9 9v1H0V9Z" fill="#ffffff" opacity="0.12" />
      <path
        d="M16 16c0-5.2-7-5.2-7 0s7 5.2 7 0c0-5.2 7-5.2 7 0s-7 5.2-7 0"
        fill="none"
        stroke="#ffffff"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

/**
 * 横版 logo：图形 + 站点名
 */
export function Logo({
  size = 32,
  text,
  className,
  textClassName,
}: {
  size?: number
  text?: string
  className?: string
  textClassName?: string
}) {
  return (
    <span className={cn('flex items-center gap-2', className)}>
      <LogoMark size={size} />
      {text ? (
        <span className={cn('font-semibold tracking-tight text-gray-900 dark:text-gray-100', textClassName)}>
          {text}
        </span>
      ) : null}
    </span>
  )
}
