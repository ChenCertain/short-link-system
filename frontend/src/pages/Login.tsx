import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, Mail, ShieldCheck } from 'lucide-react'
import { authApi } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/components/Toast'
import { Button, Card, ErrorText, Input, Label } from '@/components/ui'
import { Turnstile } from '@/components/Turnstile'

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, login } = useAuth()
  const { show } = useToast()

  const [step, setStep] = useState<'credentials' | 'code'>('credentials')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [turnstileToken, setTurnstileToken] = useState('')
  const [siteKey, setSiteKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [turnstileReset, setTurnstileReset] = useState(0)

  const from = (location.state as { from?: string } | null)?.from || '/dashboard/links'

  useEffect(() => {
    if (user) navigate(from, { replace: true })
  }, [user, from, navigate])

  useEffect(() => {
    authApi
      .initStatus()
      .then((status) => {
        if (!status.initialized) {
          navigate('/init', { replace: true })
          return
        }
        setSiteKey(status.turnstile_site_key)
      })
      .catch(() => {
        // 忽略：稍后发送时再报错
      })
  }, [navigate])

  useEffect(() => {
    if (countdown <= 0) return
    const timer = window.setTimeout(() => setCountdown((v) => v - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [countdown])

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!email.trim() || !password) {
      setError('请填写邮箱和密码')
      return
    }
    // 未配置 Turnstile 时不渲染组件，也不要求 token
    if (siteKey && !turnstileToken) {
      setError('请完成人机验证')
      return
    }

    setLoading(true)
    try {
      const res = await authApi.sendCode({
        email: email.trim(),
        password,
        purpose: 'login',
        turnstile_token: turnstileToken,
      })
      if (res.dev_code) {
        setCode(res.dev_code)
        show('本地调试模式：验证码已自动填入', 'success')
      } else {
        show('验证码已发送至邮箱，请查收', 'success')
      }
      setStep('code')
      setCountdown(60)
    } catch (err) {
      setError((err as Error).message)
      setTurnstileReset((v) => v + 1)
      setTurnstileToken('')
    } finally {
      setLoading(false)
    }
  }

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (code.length !== 6) {
      setError('请输入 6 位验证码')
      return
    }

    setLoading(true)
    try {
      const result = await authApi.verifyLogin({ email: email.trim(), password, verify_code: code })
      login(result.token, result.user)
      show('登录成功', 'success')
      navigate(from, { replace: true })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const handleResend = async () => {
    if (countdown > 0) return
    setError('')
    setTurnstileToken('')
    setTurnstileReset((v) => v + 1)
    setStep('credentials')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-white to-gray-50 px-4 dark:from-gray-950 dark:to-gray-900">
      <div className="w-full max-w-md">
        <Link
          to="/"
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          <ArrowLeft className="h-4 w-4" />
          返回首页
        </Link>

        <Card className="p-6 sm:p-8">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">登录短链管理系统</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {step === 'credentials' ? '输入账户信息以获取邮箱验证码' : '验证码已发送至你的邮箱'}
            </p>
          </div>

          {step === 'credentials' ? (
            <form onSubmit={handleSendCode} className="space-y-4">
              <div>
                <Label htmlFor="email">邮箱</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="password">密码</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="请输入密码"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              <Turnstile siteKey={siteKey} onToken={setTurnstileToken} resetKey={turnstileReset} />

              {error && <ErrorText>{error}</ErrorText>}

              <Button type="submit" className="w-full" loading={loading}>
                获取邮箱验证码
              </Button>

              <p className="text-center text-xs text-gray-500 dark:text-gray-400">
                账户由管理员创建，如需开通请联系管理员
              </p>
            </form>
          ) : (
            <form onSubmit={handleVerify} className="space-y-4">
              <div className="flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
                <Mail className="h-4 w-4 shrink-0" />
                <span className="truncate">{email}</span>
              </div>

              <div>
                <Label htmlFor="code">邮箱验证码</Label>
                <Input
                  id="code"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="6 位数字验证码"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  className="text-center text-lg tracking-[0.5em]"
                />
                <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">验证码 10 分钟内有效</p>
              </div>

              {error && <ErrorText>{error}</ErrorText>}

              <Button type="submit" className="w-full" loading={loading}>
                验证并登录
              </Button>

              <div className="flex items-center justify-between text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setStep('credentials')
                    setCode('')
                    setError('')
                  }}
                  className="text-gray-500 hover:text-gray-700 dark:text-gray-400"
                >
                  ← 修改账户信息
                </button>
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={countdown > 0}
                  className="font-medium text-brand-600 disabled:text-gray-400 dark:text-brand-400"
                >
                  {countdown > 0 ? `${countdown}s 后可重新获取` : '重新获取验证码'}
                </button>
              </div>
            </form>
          )}
        </Card>

        <p className="mt-6 text-center text-[11px] leading-5 text-gray-400 dark:text-gray-500">
          <span className="block">作者：ChenCertain</span>
          Copyright © {new Date().getFullYear()} ChenCertain. All Rights Reserved.
        </p>
      </div>
    </div>
  )
}
