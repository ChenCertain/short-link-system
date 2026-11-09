import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ExternalLink, Link2, Moon, Sun } from 'lucide-react'
import { publicApi } from '@/lib/api'
import type { PublicLink } from '@/lib/types'
import { Badge, EmptyState, LoadingBlock, StatusBadge } from '@/components/ui'
import { useAuth } from '@/contexts/AuthContext'
import { formatDate } from '@/lib/utils'

function absoluteUrl(url: string) {
  return url.startsWith('/') ? `${window.location.origin}${url}` : url
}

export default function Home() {
  const [siteName, setSiteName] = useState('短链管理系统')
  const [links, setLinks] = useState<PublicLink[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const { user } = useAuth()
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))

  useEffect(() => {
    publicApi
      .homeLinks()
      .then((data) => {
        setSiteName(data.site_name)
        setLinks(data.links)
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const toggleTheme = () => {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    localStorage.setItem('sl_theme', next ? 'dark' : 'light')
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-gray-50 dark:from-gray-950 dark:to-gray-900">
      <header className="border-b border-gray-200 bg-white/70 backdrop-blur dark:border-gray-800 dark:bg-gray-900/70">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
          <div className="flex items-center gap-2 font-semibold text-gray-900 dark:text-gray-100">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
              SL
            </span>
            {siteName}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleTheme}
              className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
              aria-label="切换主题"
            >
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <Link
              to={user ? '/dashboard/links' : '/login'}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              {user ? '进入控制台' : '登录'}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-12">
        <div className="mb-10 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100 sm:text-4xl">
            精选短链接
          </h1>
          <p className="mt-3 text-gray-500 dark:text-gray-400">
            以下链接由管理员精选展示，点击即可访问
          </p>
        </div>

        {loading && <LoadingBlock label="正在加载短链..." />}

        {!loading && error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900 dark:bg-red-900/20 dark:text-red-300">
            {error}
          </div>
        )}

        {!loading && !error && links.length === 0 && (
          <EmptyState title="暂无展示的短链" description="管理员可在后台选择要展示的短链" />
        )}

        {!loading && !error && links.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">
                <tr>
                  <th className="px-5 py-3 font-medium">名称</th>
                  <th className="px-5 py-3 font-medium">短链</th>
                  <th className="px-5 py-3 font-medium">状态</th>
                  <th className="hidden px-5 py-3 font-medium sm:table-cell">创建时间</th>
                  <th className="px-5 py-3 text-right font-medium">访问</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {links.map((link) => {
                  const url = absoluteUrl(link.short_url)
                  return (
                    <tr key={link.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                      <td className="px-5 py-3 font-medium text-gray-900 dark:text-gray-100">{link.name}</td>
                      <td className="px-5 py-3">
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-brand-600 hover:underline dark:text-brand-400"
                        >
                          {url.replace(/^https?:\/\//, '')}
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge status={link.status} />
                      </td>
                      <td className="hidden px-5 py-3 text-gray-500 dark:text-gray-400 sm:table-cell">
                        {formatDate(link.created_at)}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <Badge tone="blue">{link.click_count} 次</Badge>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-12 flex flex-col items-center gap-3 rounded-xl border border-dashed border-gray-300 bg-white/60 px-6 py-8 text-center dark:border-gray-700 dark:bg-gray-900/40">
          <Link2 className="h-6 w-6 text-brand-600" />
          <p className="text-sm text-gray-600 dark:text-gray-400">
            需要创建自己的短链？请联系管理员开通账户后登录使用
          </p>
          <Link to="/login" className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">
            前往登录 →
          </Link>
        </div>
      </main>

      <footer className="border-t border-gray-200 py-6 text-center text-xs leading-6 text-gray-400 dark:border-gray-800">
        <p>作者：ChenCertain</p>
        <p>Copyright © {new Date().getFullYear()} ChenCertain. All Rights Reserved.</p>
      </footer>
    </div>
  )
}
