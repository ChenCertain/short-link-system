import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { AUTHOR_NAME, copyrightText } from '@/lib/brand'
import {
  BarChart3,
  FolderTree,
  Globe,
  Home,
  LayoutDashboard,
  Link2,
  LogOut,
  Menu,
  ScrollText,
  Settings,
  ShieldCheck,
  UserRound,
  Users,
  UsersRound,
  X,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { LogoMark } from '@/components/Logo'
import { cn, ROLE_LABELS } from '@/lib/utils'

interface NavItem {
  to: string
  label: string
  icon: typeof LayoutDashboard
  /** 仅超级管理员可见 */
  superOnly?: boolean
  /** 需要某项组内权限（任一管理的组满足即可） */
  groupPermission?: string
  /** 需要某项全局权限（超级管理员默认拥有） */
  globalPermission?: string
  /** 需要是超级管理员或项目组管理员（成员管理） */
  needGroupAdmin?: boolean
  end?: boolean
}

const navItems: NavItem[] = [
  { to: '/dashboard', label: '概览', icon: LayoutDashboard, needGroupAdmin: true, end: true },
  { to: '/dashboard/links', label: '短链管理', icon: Link2 },
  { to: '/dashboard/groups', label: '项目组', icon: FolderTree },
  { to: '/dashboard/members', label: '成员管理', icon: UsersRound, needGroupAdmin: true },
  { to: '/dashboard/review', label: '短链审核', icon: ShieldCheck, groupPermission: 'link.review' },
  { to: '/dashboard/stats', label: '指标统计', icon: BarChart3, needGroupAdmin: true },
  { to: '/dashboard/users', label: '用户管理', icon: Users, globalPermission: 'user.manage' },
  { to: '/dashboard/audit', label: '操作审计', icon: ScrollText, globalPermission: 'audit.view' },
  { to: '/dashboard/domains', label: '域名管理', icon: Globe, superOnly: true },
  { to: '/dashboard/settings', label: '系统设置', icon: Settings, superOnly: true },
  { to: '/dashboard/profile', label: '个人设置', icon: UserRound },
]

export default function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [mobileOpen, setMobileOpen] = useState(false)

  // 左侧导航固定、仅右侧内容区滚动，切换页面时需要把内容区滚回顶部
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [location.pathname])

  const isSuperAdmin = user?.role === 'super_admin'
  const isGroupAdmin = !!user?.managed_group_ids?.length
  const globalPerms = user?.permissions?.global || {}
  const groupPermsMap = user?.permissions?.groups || {}
  const hasAnyGroupPermission = (key: string) =>
    Object.values(groupPermsMap).some((perms) => perms?.[key] === true)

  const visibleNav = navItems.filter((item) => {
    if (!user) return false
    if (item.superOnly) return isSuperAdmin
    if (item.globalPermission) return isSuperAdmin || globalPerms[item.globalPermission] === true
    if (item.groupPermission) return isSuperAdmin || hasAnyGroupPermission(item.groupPermission)
    if (item.needGroupAdmin) return isSuperAdmin || isGroupAdmin
    return true
  })

  // 侧边栏身份标识：项目组管理员单独标注
  const roleLabel = isSuperAdmin
    ? ROLE_LABELS.super_admin
    : isGroupAdmin
      ? '项目组管理员'
      : ROLE_LABELS.user

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-gray-50 dark:bg-gray-950">
      {/* 移动端遮罩 */}
      {mobileOpen && (
        <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* 侧边栏 */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-gray-200 bg-white transition-transform dark:border-gray-800 dark:bg-gray-900 lg:static lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-16 items-center justify-between border-b border-gray-100 px-5 dark:border-gray-800">
          <Link to="/dashboard" className="flex items-center gap-2 font-semibold text-gray-900 dark:text-gray-100">
            <LogoMark size={32} />
            短链管理
          </Link>
          <button
            className="rounded-md p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-label="关闭菜单"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {visibleNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300'
                    : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800',
                )
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-gray-100 px-3 py-2 dark:border-gray-800">
          <Link
            to="/"
            onClick={() => setMobileOpen(false)}
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            <Home className="h-4 w-4" />
            返回首页
          </Link>
        </div>

        <div className="border-t border-gray-100 p-3 dark:border-gray-800">
          <Link
            to="/dashboard/profile"
            onClick={() => setMobileOpen(false)}
            className="mb-2 block rounded-lg px-2 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-800"
            title="个人设置"
          >
            <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{user?.name}</p>
            <p className="truncate text-xs text-gray-500 dark:text-gray-400">
              {roleLabel} · {user?.email}
            </p>
          </Link>
          <button
            onClick={handleLogout}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-red-600 hover:bg-red-50 dark:border-gray-700 dark:hover:bg-red-900/20"
          >
            <LogOut className="h-3.5 w-3.5" />
            退出登录
          </button>
        </div>
      </aside>

      {/* 主内容：独立滚动容器，左侧导航固定不动 */}
      <div ref={scrollRef} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
        {/* 移动端菜单入口（桌面端不显示顶部条幅） */}
        <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-gray-200 bg-white/80 px-4 py-2 backdrop-blur dark:border-gray-800 dark:bg-gray-900/80 lg:hidden">
          <button
            className="rounded-md p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
            onClick={() => setMobileOpen(true)}
            aria-label="打开菜单"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
        <main className="flex-1 p-4 lg:p-6">
          <Outlet />
        </main>
        <footer className="border-t border-gray-200 px-4 py-4 text-center text-[11px] leading-5 text-gray-400 dark:border-gray-800 dark:text-gray-500">
          <p>作者：{AUTHOR_NAME}</p>
          <p>{copyrightText()}</p>
        </footer>
      </div>
    </div>
  )
}
