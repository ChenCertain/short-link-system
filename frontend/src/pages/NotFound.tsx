import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Compass, Home, LayoutDashboard, LogIn, Moon, Sun } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

export default function NotFound() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))

  useEffect(() => {
    const previous = document.title
    document.title = '404 · 页面不存在'
    return () => {
      document.title = previous
    }
  }, [])

  const toggleTheme = () => {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    localStorage.setItem('sl_theme', next ? 'dark' : 'light')
  }

  const primaryClass =
    'inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white transition hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-gray-950'
  const secondaryClass =
    'inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800 dark:focus:ring-offset-gray-950'

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-white to-gray-50 dark:from-gray-950 dark:to-gray-900">
      <header className="border-b border-gray-200 bg-white/70 backdrop-blur dark:border-gray-800 dark:bg-gray-900/70">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-4">
          <Link
            to="/"
            className="flex items-center gap-2 font-semibold text-gray-900 dark:text-gray-100"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
              SL
            </span>
            短链管理系统
          </Link>
          <button
            onClick={toggleTheme}
            className="rounded-lg p-2 text-gray-500 transition hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label="切换主题"
          >
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 items-center justify-center px-4 py-16">
        <div className="w-full text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 ring-1 ring-brand-100 dark:bg-brand-500/10 dark:text-brand-400 dark:ring-brand-500/20">
            <Compass className="h-8 w-8" />
          </div>

          <p className="select-none bg-gradient-to-r from-brand-500 to-brand-700 bg-clip-text text-6xl font-black tracking-tighter text-transparent sm:text-7xl">
            404
          </p>

          <h1 className="mt-4 text-xl font-semibold text-gray-900 dark:text-gray-100 sm:text-2xl">
            页面不存在
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-gray-500 dark:text-gray-400">
            您访问的页面可能已被删除、重命名，或链接地址输入有误。请检查地址后重试，或返回首页继续浏览。
          </p>

          <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-center">
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
        </div>
      </main>

      <footer className="border-t border-gray-200 py-6 text-center text-xs leading-6 text-gray-400 dark:border-gray-800">
        <p>作者：ChenCertain</p>
        <p>Copyright © {new Date().getFullYear()} ChenCertain. All Rights Reserved.</p>
      </footer>
    </div>
  )
}
