import { Badge } from './ui'
import { groupByCategory, type PermissionDef } from '@/lib/permissions'
import type { PermissionMap } from '@/lib/types'
import { cn } from '@/lib/utils'

interface PermissionEditorProps {
  defs: PermissionDef[]
  value: PermissionMap
  onChange?: (next: PermissionMap) => void
  /** 默认权限表：与默认值不同的项会标记为「已单独配置」 */
  defaults?: PermissionMap
  disabled?: boolean
  description?: string
}

/**
 * 权限勾选面板：按分类分组渲染开关，供超级管理员 / 组管理员逐人配置权限。
 */
export function PermissionEditor({ defs, value, onChange, defaults, disabled, description }: PermissionEditorProps) {
  const groups = groupByCategory(defs)
  const enabledCount = defs.filter((def) => value[def.key] === true).length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-800/60">
        <p className="text-xs text-gray-600 dark:text-gray-300">
          {description || '打开即拥有该权限，关闭则不生效；未单独配置时使用身份的默认权限'}
        </p>
        <Badge tone="blue">
          已开启 {enabledCount}/{defs.length}
        </Badge>
      </div>

      {groups.map((group) => (
        <div key={group.category}>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {group.category}
          </p>
          <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
            {group.items.map((def) => {
              const checked = value[def.key] === true
              const overridden = defaults ? (defaults[def.key] === true) !== checked : false
              return (
                <li
                  key={def.key}
                  className={cn(
                    'flex items-start gap-3 px-3 py-2.5',
                    disabled ? 'opacity-70' : 'hover:bg-gray-50 dark:hover:bg-gray-800/40',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{def.label}</span>
                      {overridden && <Badge tone="purple">已单独配置</Badge>}
                    </div>
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{def.description}</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={checked}
                    aria-label={def.label}
                    disabled={disabled || !onChange}
                    onClick={() => onChange?.({ ...value, [def.key]: !checked })}
                    className={cn(
                      'relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors',
                      checked ? 'bg-brand-600' : 'bg-gray-300 dark:bg-gray-700',
                      disabled || !onChange ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
                    )}
                  >
                    <span
                      className={cn(
                        'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all',
                        checked ? 'left-[1.15rem]' : 'left-0.5',
                      )}
                    />
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}
