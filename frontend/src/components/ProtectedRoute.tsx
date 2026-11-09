import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { Spinner } from '@/components/ui'
import type { UserRole } from '@/lib/types'
import type { ReactNode } from 'react'

/**
 * 路由守卫
 * - roles：允许的全局角色
 * - groupAdmin：是否要求「项目组管理员」身份（角色为 user 且管理至少一个项目组）
 * - globalPermission：是否需要某项全局权限（用户管理 / 操作审计等）
 * - groupPermission：是否需要某项组内权限（任一管理的项目组满足即可）
 */
export function ProtectedRoute({
  children,
  roles,
  groupAdmin,
  globalPermission,
  groupPermission,
}: {
  children: ReactNode
  roles?: UserRole[]
  groupAdmin?: boolean
  globalPermission?: string
  groupPermission?: string
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

  const isSuperAdmin = user.role === 'super_admin'
  const globalPerms = user.permissions?.global || {}
  const groupPermsMap = user.permissions?.groups || {}

  if (roles && !roles.includes(user.role)) {
    return <Navigate to="/dashboard/links" replace />
  }

  if (groupAdmin && !isSuperAdmin && !(user.managed_group_ids && user.managed_group_ids.length > 0)) {
    return <Navigate to="/dashboard/links" replace />
  }

  if (globalPermission && !isSuperAdmin && globalPerms[globalPermission] !== true) {
    return <Navigate to="/dashboard/links" replace />
  }

  if (
    groupPermission &&
    !isSuperAdmin &&
    !Object.values(groupPermsMap).some((perms) => perms?.[groupPermission] === true)
  ) {
    return <Navigate to="/dashboard/links" replace />
  }

  return <>{children}</>
}
