import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

// ============ Button ============
type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-600 text-white hover:bg-brand-700 focus-visible:ring-brand-500 shadow-sm',
  secondary:
    'bg-gray-100 text-gray-900 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700 focus-visible:ring-gray-400',
  outline:
    'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800 focus-visible:ring-gray-400',
  ghost:
    'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800 focus-visible:ring-gray-400',
  danger: 'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500 shadow-sm',
}

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-11 px-6 text-base gap-2',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', loading, disabled, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      {...props}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  )
})

// ============ Input ============
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        // 移动端字号保持 16px：iOS Safari 在输入框字号小于 16px 时聚焦会自动放大页面
        'h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-base text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50 sm:text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500',
        className,
      )}
      {...props}
    />
  )
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(
          'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 sm:text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100',
          className,
        )}
        {...props}
      />
    )
  },
)

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <select
      ref={ref}
      className={cn(
        'h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-base text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 sm:text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  )
})

// ============ Label ============
export function Label({ children, htmlFor, className }: { children: ReactNode; htmlFor?: string; className?: string }) {
  return (
    <label htmlFor={htmlFor} className={cn('mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300', className)}>
      {children}
    </label>
  )
}

// ============ Card ============
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function CardHeader({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 px-5 py-4 dark:border-gray-800">
      <div>
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
        {description && <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">{description}</p>}
      </div>
      {action}
    </div>
  )
}

// ============ Badge ============
type BadgeTone = 'green' | 'red' | 'yellow' | 'gray' | 'blue' | 'purple'

const badgeTones: Record<BadgeTone, string> = {
  green: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  red: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  yellow: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  gray: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  purple: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
}

export function Badge({ children, tone = 'gray', className }: { children: ReactNode; tone?: BadgeTone; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        badgeTones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { tone: BadgeTone; label: string }> = {
    active: { tone: 'green', label: '活跃' },
    disabled: { tone: 'red', label: '已停用' },
    expired: { tone: 'yellow', label: '已过期' },
    pending_verification: { tone: 'gray', label: '待验证' },
  }
  const item = map[status] || { tone: 'gray' as BadgeTone, label: status }
  return <Badge tone={item.tone}>{item.label}</Badge>
}

// ============ Spinner ============
export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn('animate-spin text-current', className || 'h-5 w-5')}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  )
}

export function LoadingBlock({ label = '加载中...' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-500 dark:text-gray-400">
      <Spinner className="h-4 w-4" />
      {label}
    </div>
  )
}

// ============ Modal ============
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div
        className={cn(
          // 用 dvh 而非 vh：移动端浏览器地址栏收起/展开时 100vh 会大于可视区，导致弹窗被裁切
          // 内部拆成「固定头部 + 可滚动内容 + 固定底部」三段，避免长表单把底部按钮挤出屏幕
          'relative z-10 flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-xl dark:bg-gray-900',
          wide ? 'max-w-3xl' : 'max-w-lg',
        )}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-100 px-5 py-4 dark:border-gray-800">
          <h3 className="min-w-0 text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
          <button
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
            aria-label="关闭"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 10-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex shrink-0 justify-end gap-2 border-t border-gray-100 px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:pb-4 dark:border-gray-800">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

// ============ Empty ============
export function EmptyState({ title = '暂无数据', description }: { title?: string; description?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center">
      <div className="mb-3 rounded-full bg-gray-100 p-3 text-gray-400 dark:bg-gray-800">
        <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
        </svg>
      </div>
      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{title}</p>
      {description && <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{description}</p>}
    </div>
  )
}

// ============ ErrorText ============
export function ErrorText({ children }: { children?: ReactNode }) {
  if (!children) return null
  return (
    <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-300">
      {children}
    </div>
  )
}
