import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, KeyRound, Mail, ShieldCheck } from 'lucide-react'
import { ApiError, authApi } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/components/Toast'
import { Button, Card, ErrorText, Input, Label } from '@/components/ui'
import { Turnstile } from '@/components/Turnstile'
import { Logo } from '@/components/Logo'
import { AUTHOR_NAME, copyrightText } from '@/lib/brand'

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, login } = useAuth()
  const { show } = useToast()

  const [step, setStep] = useState<'credentials' | 'code' | 'setup' | 'setup-code'>('credentials')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
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
      // 账户尚未设置密码：直接切换到设置密码流程
      if (err instanceof ApiError && err.code === 'PASSWORD_NOT_SET') {
        setStep('setup')
        setPassword('')
        setConfirmPassword('')
        setCode('')
        setCountdown(0)
        show('该账户还没有密码，请先设置密码', 'info')
        return
      }
      setError((err as Error).message)
      setTurnstileReset((v) => v + 1)
      setTurnstileToken('')
    } finally {
      setLoading(false)
    }
  }

  // 首次设置密码：发送验证码
  const handleSetupSendCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!email.trim()) {
      setError('请填写邮箱')
      return
    }
    if (password.length < 8) {
      setError('密码长度至少 8 位')
      return
    }
    if (password !== confirmPassword) {
      setError('两次输入的密码不一致')
      return
    }
    if (siteKey && !turnstileToken) {
      setError('请完成人机验证')
      return
    }

    setLoading(true)
    try {
      const res = await authApi.sendCode({
        email: email.trim(),
        purpose: 'set_password',
        turnstile_token: turnstileToken,
      })
      if (res.dev_code) {
        setCode(res.dev_code)
        show('本地调试模式：验证码已自动填入', 'success')
      } else {
        show('验证码已发送至邮箱，请查收', 'success')
      }
      setStep('setup-code')
      setCountdown(60)
    } catch (err) {
      setError((err as Error).message)
      setTurnstileReset((v) => v + 1)
      setTurnstileToken('')
    } finally {
      setLoading(false)
    }
  }

  // 首次设置密码：校验验证码并直接登录
  const handleSetupSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (code.length !== 6) {
      setError('请输入 6 位验证码')
      return
    }

    setLoading(true)
    try {
      const result = await authApi.setupPassword({
        email: email.trim(),
        password,
        verify_code: code,
      })
      login(result.token, result.user)
      show('密码设置成功，已为你登录', 'success')
      navigate(from, { replace: true })
    } catch (err) {
      setError((err as Error).message)
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

  const isSetup = step === 'setup' || step === 'setup-code'
  const subtitle =
    step === 'credentials'
      ? '输入账户信息以获取邮箱验证码'
      : step === 'code'
      ? '验证码已发送至你的邮箱'
      : step === 'setup'
      ? '你的账户还没有密码，设置后即可登录'
      : '验证码已发送至你的邮箱，验证后自动登录'

  const backToCredentials = () => {
    setStep('credentials')
    setCode('')
    setError('')
    setPassword('')
    setConfirmPassword('')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-white to-gray-50 px-4 dark:from-gray-950 dark:to-gray-900">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-between">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <ArrowLeft className="h-4 w-4" />
            返回首页
          </Link>
          <Logo size={26} text="短链管理" textClassName="text-sm" />
        </div>

        <Card className="p-6 sm:p-8">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400">
              {isSetup ? <KeyRound className="h-6 w-6" /> : <ShieldCheck className="h-6 w-6" />}
            </div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              {isSetup ? '设置登录密码' : '登录短链管理系统'}
            </h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{subtitle}</p>
          </div>

          {step === 'credentials' && (
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

              <div className="flex flex-col gap-1 text-center text-xs text-gray-500 dark:text-gray-400">
                <span>账户由管理员创建，如需开通请联系管理员</span>
                <button
                  type="button"
                  onClick={() => {
                    setStep('setup')
                    setPassword('')
                    setConfirmPassword('')
                    setCode('')
                    setError('')
                  }}
                  className="font-medium text-brand-600 hover:underline dark:text-brand-400"
                >
                  首次使用 / 还没有密码？在这里设置密码
                </button>
              </div>
            </form>
          )}

          {step === 'code' && (
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
                  onClick={backToCredentials}
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

          {step === 'setup' && (
            <form onSubmit={handleSetupSendCode} className="space-y-4">
              <div>
                <Label htmlFor="setup-email">邮箱</Label>
                <Input
                  id="setup-email"
                  type="email"
                  autoComplete="username"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">填写管理员为你开通账户时使用的邮箱</p>
              </div>
              <div>
                <Label htmlFor="setup-password">设置密码</Label>
                <Input
                  id="setup-password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="至少 8 位"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="setup-confirm">确认密码</Label>
                <Input
                  id="setup-confirm"
                  type="password"
                  autoComplete="new-password"
                  placeholder="再次输入密码"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>

              <Turnstile siteKey={siteKey} onToken={setTurnstileToken} resetKey={turnstileReset} />

              {error && <ErrorText>{error}</ErrorText>}

              <Button type="submit" className="w-full" loading={loading}>
                获取邮箱验证码
              </Button>

              <button
                type="button"
                onClick={backToCredentials}
                className="w-full text-center text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400"
              >
                ← 返回登录
              </button>
            </form>
          )}

          {step === 'setup-code' && (
            <form onSubmit={handleSetupSubmit} className="space-y-4">
              <div className="flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
                <Mail className="h-4 w-4 shrink-0" />
                <span className="truncate">{email}</span>
              </div>

              <div>
                <Label htmlFor="setup-code">邮箱验证码</Label>
                <Input
                  id="setup-code"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="6 位数字验证码"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  className="text-center text-lg tracking-[0.5em]"
                />
                <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">验证成功后会自动登录</p>
              </div>

              {error && <ErrorText>{error}</ErrorText>}

              <Button type="submit" className="w-full" loading={loading}>
                设置密码并登录
              </Button>

              <button
                type="button"
                onClick={() => {
                  setStep('setup')
                  setCode('')
                  setError('')
                  setTurnstileReset((v) => v + 1)
                  setTurnstileToken('')
                }}
                className="w-full text-center text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400"
              >
                ← 返回修改
              </button>
            </form>
          )}
        </Card>

        <p className="mt-6 text-center text-[11px] leading-5 text-gray-400 dark:text-gray-500">
          <span className="block">作者：{AUTHOR_NAME}</span>
          {copyrightText()}
        </p>
      </div>
    </div>
  )
}
