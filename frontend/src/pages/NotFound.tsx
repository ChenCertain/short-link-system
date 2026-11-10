import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AUTHOR_NAME, copyrightText } from '@/lib/brand'
import { SourceLink } from '@/components/SourceLink'
import {
  ArrowLeft,
  ArrowUpRight,
  Globe,
  Home,
  LayoutDashboard,
  Link2Off,
  LogIn,
  Moon,
  Sun,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useTheme } from '@/lib/theme'

export default function NotFound() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { isDark: dark, toggle: toggleTheme } = useTheme()

  useEffect(() => {
    const previous = document.title
    document.title = '404 · 页面不存在'
    return () => {
      document.title = previous
    }
  }, [])

  const isSuperAdmin = user?.role === 'super_admin'

  const primaryClass =
    'inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 text-sm font-medium text-white shadow-lg shadow-brand-600/20 transition hover:bg-brand-700 hover:shadow-brand-600/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-950'
  const secondaryClass =
    'inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white/80 px-5 text-sm font-medium text-gray-700 backdrop-blur transition hover:border-gray-300 hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:border-gray-800 dark:bg-gray-900/70 dark:text-gray-200 dark:hover:border-gray-700 dark:hover:bg-gray-900 dark:focus-visible:ring-offset-gray-950'

  const shortcuts = [
    { to: '/', label: '产品首页', desc: '了解系统功能与使用流程', icon: Home },
    ...(user ? [{ to: '/dashboard/links', label: '短链管理', desc: '管理我的短链', icon: LayoutDashboard }] : []),
    isSuperAdmin
      ? { to: '/dashboard/domains', label: '域名管理', desc: '配置短链域名', icon: Globe }
      : { to: user ? '/dashboard/groups' : '/login', label: user ? '项目组' : '登录', desc: user ? '查看所属分组' : '进入管理后台', icon: Globe },
  ]

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-white dark:bg-gray-950">
      {/* 背景装饰 */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-32 -top-32 h-80 w-80 rounded-full bg-brand-200/60 blur-3xl dark:bg-brand-700/20" />
        <div className="absolute -right-24 top-1/4 h-96 w-96 rounded-full bg-sky-200/50 blur-3xl dark:bg-sky-600/10" />
        <div className="absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-indigo-200/50 blur-3xl dark:bg-indigo-600/10" />
        <div
          className="absolute inset-0 opacity-40 dark:opacity-20"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgb(148 163 184 / 0.16) 1px, transparent 1px), linear-gradient(to bottom, rgb(148 163 184 / 0.16) 1px, transparent 1px)',
            backgroundSize: '56px 56px',
            maskImage: 'radial-gradient(ellipse at center, black 15%, transparent 72%)',
            WebkitMaskImage: 'radial-gradient(ellipse at center, black 15%, transparent 72%)',
          }}
        />
      </div>

      <style>{`
        @keyframes sl-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-12px); }
        }
        @keyframes sl-fade-up {
          from { opacity: 0; transform: translateY(14px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes sl-ring {
          0% { transform: scale(0.85); opacity: 0.5; }
          75%, 100% { transform: scale(1.6); opacity: 0; }
        }
      `}</style>

      <header className="relative z-10 border-b border-gray-200/70 bg-white/60 backdrop-blur dark:border-gray-800/70 dark:bg-gray-950/60">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2 font-semibold text-gray-900 dark:text-gray-100">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
              SL
            </span>
            短链管理系统
          </Link>
          <button
            onClick={toggleTheme}
            className="rounded-lg p-2 text-gray-500 transition hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
            aria-label="切换主题"
          >
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-4 py-14 text-center sm:py-20">
        {/* 断链标识 */}
        <div className="relative mb-2">
          <span
            aria-hidden
            className="absolute inset-0 rounded-2xl bg-brand-400/30 blur-xl"
            style={{ animation: 'sl-ring 2.8s ease-out infinite' }}
          />
          <span className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-brand-100 bg-white text-brand-600 shadow-sm dark:border-brand-500/20 dark:bg-gray-900 dark:text-brand-400">
            <Link2Off className="h-6 w-6" />
          </span>
        </div>

        {/* 404 大字 */}
        <p
          className="select-none bg-gradient-to-br from-brand-500 via-brand-600 to-indigo-600 bg-clip-text text-[6.5rem] font-black leading-none tracking-tighter text-transparent sm:text-[9rem]"
          style={{ animation: 'sl-float 6s ease-in-out infinite' }}
        >
          404
        </p>

        <h1
          className="mt-2 text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100 sm:text-3xl"
          style={{ animation: 'sl-fade-up 0.6s ease-out both' }}
        >
          这个短链好像被剪断了
        </h1>
        <p
          className="mx-auto mt-3 max-w-md text-sm leading-6 text-gray-500 dark:text-gray-400"
          style={{ animation: 'sl-fade-up 0.6s ease-out 0.08s both' }}
        >
          你访问的页面不存在、已被删除，或者地址输错了。检查一下链接，或者从下面重新出发。
        </p>

        <div
          className="mt-8 flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:items-center sm:justify-center"
          style={{ animation: 'sl-fade-up 0.6s ease-out 0.16s both' }}
        >
          <Link to="/" className={primaryClass}>
            <Home className="h-4 w-4" />
            返回首页
          </Link>
          <button type="button" onClick={() => navigate(-1)} className={secondaryClass}>
            <ArrowLeft className="h-4 w-4" />
            返回上一页
          </button>
          {user ? (
            <Link to="/dashboard/links" className={secondaryClass}>
              <LayoutDashboard className="h-4 w-4" />
              进入控制台
            </Link>
          ) : (
            <Link to="/login" className={secondaryClass}>
              <LogIn className="h-4 w-4" />
              登录
            </Link>
          )}
        </div>

        {/* 快捷入口 */}
        <div
          className="mt-12 w-full border-t border-dashed border-gray-200 pt-8 dark:border-gray-800"
          style={{ animation: 'sl-fade-up 0.6s ease-out 0.24s both' }}
        >
          <p className="mb-4 text-xs font-medium uppercase tracking-widest text-gray-400 dark:text-gray-500">
            或者从这里开始
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {shortcuts.map(({ to, label, desc, icon: Icon }) => (
              <Link
                key={to + label}
                to={to}
                className="group flex items-center gap-3 rounded-xl border border-gray-200 bg-white/70 px-4 py-3 text-left backdrop-blur transition hover:-translate-y-0.5 hover:border-brand-200 hover:bg-white hover:shadow-md dark:border-gray-800 dark:bg-gray-900/50 dark:hover:border-brand-500/30 dark:hover:bg-gray-900"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500 transition group-hover:bg-brand-50 group-hover:text-brand-600 dark:bg-gray-800 dark:text-gray-400 dark:group-hover:bg-brand-500/10 dark:group-hover:text-brand-400">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                    {label}
                  </span>
                  <span className="block truncate text-xs text-gray-500 dark:text-gray-400">{desc}</span>
                </span>
                <ArrowUpRight className="h-4 w-4 shrink-0 text-gray-300 transition group-hover:text-brand-500 dark:text-gray-600" />
              </Link>
            ))}
          </div>
        </div>
      </main>

      <footer className="relative z-10 border-t border-gray-200/70 py-6 text-center text-xs leading-6 text-gray-400 dark:border-gray-800/70">
        <p>作者：{AUTHOR_NAME}</p>
        <p>{copyrightText()}</p>
        <p>
          源代码：<SourceLink />
        </p>
      </footer>
    </div>
  )
}
