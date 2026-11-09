import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { Spinner } from '@/components/ui'
import type { UserRole } from '@/lib/types'
import type { ReactNode } from 'react'

/**
 * 路由守卫
 * - roles：允许的全局角色
 * - groupAdmin：是否要求「项目组管理员」身份（角色为 user 且管理至少一个项目组）
 */
export function ProtectedRoute({
  children,
  roles,
  groupAdmin,
}: {
  children: ReactNode
  roles?: UserRole[]
  groupAdmin?: boolean
}) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-8 w-8 text-brand-600" />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />
  }

  if (roles && !roles.includes(user.role)) {
    return <Navigate to="/dashboard/links" replace />
  }

  if (groupAdmin && user.role !== 'super_admin' && !(user.managed_group_ids && user.managed_group_ids.length > 0)) {
    return <Navigate to="/dashboard/links" replace />
  }

  return <>{children}</>
}
