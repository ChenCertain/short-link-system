import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Rocket, ShieldCheck } from 'lucide-react'
import { authApi } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/components/Toast'
import { Button, Card, ErrorText, Input, Label } from '@/components/ui'
import { Turnstile } from '@/components/Turnstile'

export default function InitAdmin() {
  const navigate = useNavigate()
  const { login } = useAuth()
  const { show } = useToast()

  const [checking, setChecking] = useState(true)
  const [step, setStep] = useState<'form' | 'code'>('form')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [code, setCode] = useState('')
  const [turnstileToken, setTurnstileToken] = useState('')
  const [siteKey, setSiteKey] = useState('')
  const [turnstileReset, setTurnstileReset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    authApi
      .initStatus()
      .then((status) => {
        if (status.initialized) {
          navigate('/login', { replace: true })
          return
        }
        setSiteKey(status.turnstile_site_key)
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setChecking(false))
  }, [navigate])

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!name.trim() || !email.trim() || !password) {
      setError('请填写所有必填字段')
      return
    }
    if (password.length < 8) {
      setError('密码长度至少 8 位')
      return
    }
    if (password !== confirm) {
      setError('两次输入的密码不一致')
      return
    }
    if (!turnstileToken) {
      setError('请完成人机验证')
      return
    }

    setLoading(true)
    try {
      const res = await authApi.sendCode({
        email: email.trim(),
        purpose: 'init_admin',
        turnstile_token: turnstileToken,
      })
      if (res.dev_code) {
        setCode(res.dev_code)
        show('本地调试模式：验证码已自动填入', 'success')
      } else {
        show('验证码已发送至邮箱', 'success')
      }
      setStep('code')
    } catch (err) {
      setError((err as Error).message)
      setTurnstileReset((v) => v + 1)
      setTurnstileToken('')
    } finally {
      setLoading(false)
    }
  }

  const handleInit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (code.length !== 6) {
      setError('请输入 6 位验证码')
      return
    }

    setLoading(true)
    try {
      const result = await authApi.init({
        email: email.trim(),
        password,
        name: name.trim(),
        turnstile_token: turnstileToken,
        verify_code: code,
      })
      login(result.token, result.user)
      show('管理员账户创建成功', 'success')
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  if (checking) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-gray-500">正在检查系统状态...</div>
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-white to-gray-50 px-4 py-10 dark:from-gray-950 dark:to-gray-900">
      <div className="w-full max-w-md">
        <Card className="p-6 sm:p-8">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400">
              {step === 'form' ? <Rocket className="h-6 w-6" /> : <ShieldCheck className="h-6 w-6" />}
            </div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">初始化管理员账户</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {step === 'form'
                ? '首次部署，请创建超级管理员账户'
                : '请查收邮箱中的 6 位验证码完成创建'}
            </p>
          </div>

          {step === 'form' ? (
            <form onSubmit={handleSendCode} className="space-y-4">
              <div>
                <Label htmlFor="name">管理员姓名</Label>
                <Input id="name" placeholder="如：张三" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="email">邮箱</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  placeholder="admin@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="password">密码（至少 8 位）</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="confirm">确认密码</Label>
                <Input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </div>

              <Turnstile siteKey={siteKey} onToken={setTurnstileToken} resetKey={turnstileReset} />

              {error && <ErrorText>{error}</ErrorText>}

              <Button type="submit" className="w-full" loading={loading}>
                获取邮箱验证码
              </Button>
            </form>
          ) : (
            <form onSubmit={handleInit} className="space-y-4">
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
              </div>

              {error && <ErrorText>{error}</ErrorText>}

              <Button type="submit" className="w-full" loading={loading}>
                创建管理员并进入控制台
              </Button>

              <button
                type="button"
                onClick={() => {
                  setStep('form')
                  setCode('')
                  setError('')
                }}
                className="w-full text-center text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400"
              >
                ← 返回修改信息
              </button>
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
