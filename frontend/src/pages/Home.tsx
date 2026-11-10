import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AUTHOR_NAME, copyrightText } from '@/lib/brand'
import {
  ArrowRight,
  BarChart3,
  Check,
  Globe2,
  Layers,
  Moon,
  ShieldCheck,
  Sparkles,
  Sun,
  Zap,
} from 'lucide-react'
import { publicApi } from '@/lib/api'
import { Logo, LogoMark } from '@/components/Logo'
import { useAuth } from '@/contexts/AuthContext'
import { useTheme } from '@/lib/theme'

const features = [
  {
    icon: Globe2,
    title: '多域名管理',
    desc: '为不同业务绑定独立域名，按项目组分配可用域名，一条短链也能有清晰的归属。',
  },
  {
    icon: Layers,
    title: '项目组与权限',
    desc: '树形项目组搭配组管理员机制，成员、域名、短链分域隔离，权限边界一目了然。',
  },
  {
    icon: ShieldCheck,
    title: '审核与安全',
    desc: '短链支持提交审核后上线，登录采用邮箱验证码 + 密码 + 人机验证，降低滥用风险。',
  },
  {
    icon: BarChart3,
    title: '访问统计',
    desc: '记录点击量、来源、地区与设备明细，快速掌握每一条短链的真实表现。',
  },
]

const steps = [
  { title: '登录账户', desc: '邮箱验证码 + 密码双重校验' },
  { title: '创建短链', desc: '选择域名与项目组，自定义别名' },
  { title: '分发追踪', desc: '复制短链，实时查看点击明细' },
]

export default function Home() {
  const { user } = useAuth()
  const [siteName, setSiteName] = useState('短链管理')
  const { isDark: dark, toggle: toggleTheme } = useTheme()

  useEffect(() => {
    publicApi
      .config()
      .then((data) => {
        if (data?.site_name) setSiteName(data.site_name)
      })
      // 站点名只影响展示，取不到时用默认值，不影响页面渲染
      .catch(() => undefined)
  }, [])

  return (
    <div className="relative isolate min-h-screen overflow-hidden bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      {/* 背景网格 + 光斑 */}
      <div className="hero-grid pointer-events-none absolute inset-x-0 top-0 -z-20 h-[600px]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[680px] overflow-hidden">
        <div className="absolute -left-24 -top-32 h-80 w-80 rounded-full bg-brand-400/25 blur-3xl dark:bg-brand-600/20" />
        <div className="absolute right-[-6rem] top-10 h-96 w-96 rounded-full bg-cyan-300/25 blur-3xl dark:bg-cyan-500/10" />
        <div className="absolute left-1/2 top-64 h-72 w-[36rem] -translate-x-1/2 rounded-full bg-indigo-200/20 blur-3xl dark:bg-indigo-500/10" />
      </div>

      {/* 顶部导航 */}
      <header className="sticky top-0 z-30 border-b border-gray-200/70 bg-white/75 backdrop-blur-md dark:border-gray-800/70 dark:bg-gray-950/70">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center">
            <Logo size={32} text={siteName} textClassName="text-[15px]" />
          </Link>

          <nav className="hidden items-center gap-7 text-sm font-medium text-gray-600 md:flex dark:text-gray-300">
            <a href="#features" className="transition-colors hover:text-gray-900 dark:hover:text-white">
              功能
            </a>
            <a href="#start" className="transition-colors hover:text-gray-900 dark:hover:text-white">
              使用流程
            </a>
          </nav>

          <div className="flex items-center gap-2">
            <button
              onClick={toggleTheme}
              className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
              aria-label="切换主题"
            >
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <Link
              to={user ? '/dashboard/links' : '/login'}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
            >
              {user ? '进入控制台' : '登录'}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-4 pb-16 pt-16 sm:px-6 sm:pt-24">
          <div className="grid items-center gap-14 lg:grid-cols-[1.12fr_0.88fr]">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white/70 px-3 py-1 text-xs font-medium text-gray-600 shadow-sm dark:border-gray-800 dark:bg-gray-900/60 dark:text-gray-300">
                <Sparkles className="h-3.5 w-3.5 text-brand-600 dark:text-brand-400" />
                作者：{AUTHOR_NAME}
              </span>

              <h1 className="mt-6 text-4xl font-bold leading-[1.22] tracking-tight sm:text-[2.6rem]">
                把长链接，
                <br className="hidden sm:block" />
                变成一句话就能发出去的
                <span className="bg-gradient-to-r from-brand-600 to-cyan-500 bg-clip-text text-transparent">
                  短链
                </span>
              </h1>

              <p className="mt-5 max-w-xl text-base leading-relaxed text-gray-600 dark:text-gray-400">
                部署在全球边缘网络的短链管理系统。多域名、项目组权限、审核流程与访问统计开箱即用，
                跳转延迟只有毫秒级。
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link
                  to={user ? '/dashboard/links' : '/login'}
                  className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-600/20 transition-colors hover:bg-brand-700"
                >
                  {user ? '进入控制台' : '立即登录'}
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <a
                  href="#features"
                  className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-5 py-3 text-sm font-semibold text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
                >
                  了解功能
                </a>
              </div>

              <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-gray-500 dark:text-gray-400">
                {['全球边缘加速', '权限精细隔离'].map((item) => (
                  <li key={item} className="flex items-center gap-1.5">
                    <Check className="h-4 w-4 text-emerald-500" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* 短链示意卡片 */}
            <div className="relative">
              <div className="absolute -inset-4 -z-10 rounded-[2rem] bg-gradient-to-tr from-brand-500/10 via-transparent to-cyan-400/10 blur-xl" />
              <div className="rounded-2xl border border-gray-200/80 bg-white/80 p-5 shadow-2xl shadow-gray-900/5 backdrop-blur dark:border-gray-800 dark:bg-gray-900/80">
                <div className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                  <span className="ml-auto text-[11px] font-medium text-gray-400">创建短链</span>
                </div>

                <p className="mt-4 text-[11px] font-medium uppercase tracking-wide text-gray-400">目标链接</p>
                <div className="mt-1.5 truncate rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-800/60 dark:text-gray-400">
                  https://example.com/blog/2026/11/how-to-shorten-links
                </div>

                <div className="my-3 flex items-center justify-center gap-1.5 text-[11px] text-gray-400">
                  <Zap className="h-3.5 w-3.5 text-amber-500" />
                  边缘节点实时生成
                </div>

                <div className="flex items-center gap-2 rounded-lg bg-gray-900 px-3 py-3 dark:bg-black">
                  <LogoMark size={20} />
                  <span className="truncate text-sm font-medium text-white">
                    s.example.com/<span className="text-cyan-300">launch</span>
                  </span>
                  <span className="ml-auto shrink-0 rounded-md bg-white/10 px-2 py-1 text-[11px] font-medium text-white/80">
                    复制
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  {[
                    { label: '今日点击', value: '1,286' },
                    { label: '独立访客', value: '932' },
                    { label: '平均延迟', value: '18ms' },
                  ].map((stat) => (
                    <div key={stat.label} className="rounded-lg bg-gray-50 px-2 py-2.5 dark:bg-gray-800/60">
                      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{stat.value}</p>
                      <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">{stat.label}</p>
                    </div>
                  ))}
                </div>
              </div>
              <p className="mt-3 text-center text-[11px] text-gray-400">界面示意，实际数据以控制台为准</p>
            </div>
          </div>
        </section>

        {/* 功能 */}
        <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-widest text-brand-600 dark:text-brand-400">
              核心功能
            </p>
            <h2 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">短链该有的一切，都在这里</h2>
            <p className="mt-3 text-gray-600 dark:text-gray-400">
              不只是把链接变短。从域名、权限到审核与统计，一套系统覆盖短链生命周期的每个环节。
            </p>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {features.map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="group rounded-2xl border border-gray-200 bg-white p-5 transition-all hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-lg hover:shadow-brand-600/5 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-brand-800"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600 transition-colors group-hover:bg-brand-600 group-hover:text-white dark:bg-brand-900/30 dark:text-brand-400">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-sm font-semibold">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-gray-600 dark:text-gray-400">{desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 使用流程 */}
        <section id="start" className="scroll-mt-20 border-y border-gray-200 bg-gray-50/70 py-16 dark:border-gray-800 dark:bg-gray-900/40">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-widest text-brand-600 dark:text-brand-400">
                使用流程
              </p>
              <h2 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">三步开始，十分钟上手</h2>
            </div>

            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {steps.map((step, index) => (
                <div
                  key={step.title}
                  className="relative rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-900 text-sm font-semibold text-white dark:bg-white dark:text-gray-900">
                    {index + 1}
                  </span>
                  <h3 className="mt-4 text-sm font-semibold">{step.title}</h3>
                  <p className="mt-1.5 text-sm text-gray-600 dark:text-gray-400">{step.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 结尾 CTA */}
        <section className="mx-auto max-w-6xl px-4 pb-16 pt-16 sm:px-6 sm:pb-20 sm:pt-20">
          <div className="relative isolate overflow-hidden rounded-3xl bg-gray-900 px-6 py-14 text-center shadow-xl shadow-gray-900/20 dark:bg-gray-900 dark:shadow-black/40">
            <div className="pointer-events-none absolute -left-16 -top-16 -z-10 h-56 w-56 rounded-full bg-brand-500/30 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-20 -right-10 -z-10 h-56 w-56 rounded-full bg-cyan-400/20 blur-3xl" />
            <span className="relative inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium text-white/80">
              <Zap className="h-3.5 w-3.5" />
              开始使用
            </span>
            <h2 className="relative mt-5 text-2xl font-bold tracking-tight text-white sm:text-3xl">
              登录后即可创建你的第一条短链
            </h2>
            <p className="relative mx-auto mt-3 max-w-xl text-sm leading-relaxed text-gray-300">
              账户由管理员开通。如果还没有账户，请联系系统管理员获取访问权限。
            </p>
            <div className="relative mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                to={user ? '/dashboard/links' : '/login'}
                className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-gray-900 transition-colors hover:bg-gray-100"
              >
                {user ? '进入控制台' : '前往登录'}
                <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href="#features"
                className="inline-flex items-center gap-2 rounded-xl border border-white/20 px-5 py-3 text-sm font-semibold text-white/90 transition-colors hover:border-white/40 hover:bg-white/10"
              >
                了解功能
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-gray-200 py-8 dark:border-gray-800">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-4 text-center sm:flex-row sm:justify-between sm:text-left">
          <Logo size={26} text={siteName} textClassName="text-sm" />
          <p className="text-xs leading-5 text-gray-400">
            作者：{AUTHOR_NAME} · {copyrightText()}
          </p>
        </div>
      </footer>
    </div>
  )
}
