import type { ReactNode } from 'react'
import { Button, Modal } from '@/components/ui'

/**
 * 通用二次确认弹窗。
 * 不使用 window.confirm，避免在 IDE 内嵌浏览器 / iframe 中被静默拦截。
 */
export function ConfirmDialog({
  open,
  title,
  description,
  children,
  confirmText = '确认',
  variant = 'danger',
  loading = false,
  onCancel,
  onConfirm,
}: {
  open: boolean
  title: string
  description?: ReactNode
  children?: ReactNode
  confirmText?: string
  variant?: 'primary' | 'danger'
  loading?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button variant="outline" onClick={onCancel}>
            取消
          </Button>
          <Button variant={variant} loading={loading} onClick={onConfirm}>
            {confirmText}
          </Button>
        </>
      }
    >
      {description && <p className="text-sm text-gray-700 dark:text-gray-300">{description}</p>}
      {children}
    </Modal>
  )
}
