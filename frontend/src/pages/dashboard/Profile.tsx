import { useEffect, useState } from 'react'
import { Check, KeyRound, Mail, MailCheck, Monitor, Moon, Save, ShieldAlert, Sun, UserRound } from 'lucide-react'
import { profileApi, setToken, type ProfileUser } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { Badge, Button, Card, CardHeader, ErrorText, Input, Label, LoadingBlock } from '@/components/ui'
import { useToast } from '@/components/Toast'
import { cn, formatDateTime, ROLE_LABELS } from '@/lib/utils'
import { useTheme, type ThemeChoice } from '@/lib/theme'

const THEME_OPTIONS: { key: ThemeChoice; label: string; desc: string; icon: typeof Sun }[] = [
  { key: 'system', label: '跟随系统', desc: '随操作系统的浅色 / 深色自动切换', icon: Monitor },
  { key: 'light', label: '浅色', desc: '始终使用浅色主题', icon: Sun },
  { key: 'dark', label: '深色', desc: '始终使用深色主题', icon: Moon },
]

export default function Profile() {
  const { show } = useToast()
  const { refresh } = useAuth()
  const { choice: themeChoice, setTheme } = useTheme()

  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<ProfileUser | null>(null)
  const [passwordSet, setPasswordSet] = useState(true)
  const [loadError, setLoadError] = useState('')

  // 基本信息
  const [name, setName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [nameError, setNameError] = useState('')

  // 换绑邮箱
  const [newEmail, setNewEmail] = useState('')
  const [emailCode, setEmailCode] = useState('')
  const [sendingCode, setSendingCode] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [savingEmail, setSavingEmail] = useState(false)
  const [emailError, setEmailError] = useState('')

  // 修改密码
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)
  const [passwordError, setPasswordError] = useState('')

  useEffect(() => {
    profileApi
      .me()
      .then((data) => {
        setProfile(data.user)
        setPasswordSet(data.password_set)
        setName(data.user.name)
      })
      .catch((err: Error) => setLoadError(err.message))
      .finally(() => setLoading(false))
  }, [])

  // 验证码倒计时
  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setTimeout(() => setCooldown((v) => v - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [cooldown])

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault()
    setNameError('')
    const value = name.trim()
    if (!value) {
      setNameError('用户名不能为空')
      return
    }
    if (value.length > 32) {
      setNameError('用户名最长 32 个字符')
      return
    }
    setSavingName(true)
    try {
      const res = await profileApi.update({ name: value })
      setProfile(res.user)
      setName(res.user.name)
      await refresh()
      show('用户名已更新', 'success')
    } catch (err) {
      setNameError((err as Error).message)
    } finally {
      setSavingName(false)
    }
  }

  const handleSendEmailCode = async () => {
    setEmailError('')
    const email = newEmail.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailError('请输入正确的邮箱地址')
      return
    }
    setSendingCode(true)
    try {
      const res = await profileApi.sendEmailCode(email)
      if (res.dev_code) {
        setEmailCode(res.dev_code)
        show('本地调试模式：验证码已自动填充', 'success')
      } else {
        show(res.message || '验证码已发送', 'success')
      }
      setCooldown(60)
    } catch (err) {
      setEmailError((err as Error).message)
    } finally {
      setSendingCode(false)
    }
  }

  const handleSaveEmail = async (e: React.FormEvent) => {
    e.preventDefault()
    setEmailError('')
    const email = newEmail.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailError('请输入正确的邮箱地址')
      return
    }
    if (email === profile?.email) {
      setEmailError('新邮箱与当前邮箱相同')
      return
    }
    if (!emailCode.trim()) {
      setEmailError('请填写新邮箱收到的验证码')
      return
    }

    setSavingEmail(true)
    try {
      const res = await profileApi.update({ email, verify_code: emailCode.trim() })
      if (res.token) setToken(res.token)
      setProfile(res.user)
      setNewEmail('')
      setEmailCode('')
      await refresh()
      show('邮箱已更新，下次登录请使用新邮箱', 'success')
    } catch (err) {
      setEmailError((err as Error).message)
    } finally {
      setSavingEmail(false)
    }
  }

  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setPasswordError('')
    if (passwordSet && !oldPassword) {
      setPasswordError('请输入当前密码')
      return
    }
    if (newPassword.length < 8) {
      setPasswordError('新密码长度至少 8 位')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('两次输入的新密码不一致')
      return
    }

    setSavingPassword(true)
    try {
      await profileApi.updatePassword({
        old_password: passwordSet ? oldPassword : undefined,
        new_password: newPassword,
      })
      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordSet(true)
      show('密码已更新', 'success')
    } catch (err) {
      setPasswordError((err as Error).message)
    } finally {
      setSavingPassword(false)
    }
  }

  if (loading) return <LoadingBlock />
  if (loadError) return <ErrorText>{loadError}</ErrorText>
  if (!profile) return null

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">个人设置</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">管理你的用户名、邮箱与登录密码</p>
      </div>

      {!passwordSet && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            你的账户还没有设置密码。请在下方「修改密码」中设置一个密码，之后即可正常登录。
          </span>
        </div>
      )}

      <Card>
        <CardHeader title="外观" description="默认跟随系统，选择会保存在本设备浏览器中" />
        <div className="grid gap-2 p-5 sm:grid-cols-3">
          {THEME_OPTIONS.map((option) => {
            const active = themeChoice === option.key
            return (
              <button
                key={option.key}
                type="button"
                onClick={() => setTheme(option.key)}
                aria-pressed={active}
                className={cn(
                  'flex items-start gap-2.5 rounded-xl border px-3 py-3 text-left transition-colors',
                  active
                    ? 'border-brand-300 bg-brand-50 dark:border-brand-500/40 dark:bg-brand-500/10'
                    : 'border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800',
                )}
              >
                <option.icon
                  className={cn(
                    'mt-0.5 h-4 w-4 shrink-0',
                    active ? 'text-brand-600 dark:text-brand-400' : 'text-gray-400',
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'flex items-center gap-1.5 text-sm font-medium',
                      active ? 'text-brand-700 dark:text-brand-300' : 'text-gray-900 dark:text-gray-100',
                    )}
                  >
                    {option.label}
                    {active && <Check className="h-3.5 w-3.5" />}
                  </span>
                  <span className="mt-0.5 block text-xs leading-5 text-gray-500 dark:text-gray-400">
                    {option.desc}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </Card>

      <Card>
        <CardHeader title="账户信息" description="系统分配的信息，不可自行修改" />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">邮箱</p>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-gray-900 dark:text-gray-100">
              <Mail className="h-3.5 w-3.5 shrink-0 text-gray-400" />
              {profile.email}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">角色</p>
            <p className="mt-1">
              <Badge tone={profile.role === 'super_admin' ? 'purple' : 'blue'}>
                {ROLE_LABELS[profile.role] || profile.role}
              </Badge>
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">注册时间</p>
            <p className="mt-1 text-sm text-gray-900 dark:text-gray-100">{formatDateTime(profile.created_at)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">最后登录</p>
            <p className="mt-1 text-sm text-gray-900 dark:text-gray-100">
              {formatDateTime(profile.last_login_at)}
              {profile.last_login_ip && (
                <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">{profile.last_login_ip}</span>
              )}
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="用户名" description="显示在导航栏、操作审计等位置" />
        <form onSubmit={handleSaveName} className="space-y-4 p-5">
          <div>
            <Label htmlFor="profile-name">用户名</Label>
            <Input
              id="profile-name"
              maxLength={32}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="请输入用户名"
            />
            <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">1-32 个字符</p>
          </div>
          {nameError && <ErrorText>{nameError}</ErrorText>}
          <div className="flex justify-end">
            <Button type="submit" loading={savingName}>
              <Save className="h-4 w-4" />
              保存用户名
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader
          title="换绑邮箱"
          description="需要验证新邮箱的所有权，验证码有效期 10 分钟"
        />
        <form onSubmit={handleSaveEmail} className="space-y-4 p-5">
          <div>
            <Label htmlFor="profile-email">新邮箱</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="profile-email"
                type="email"
                className="sm:flex-1"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="new@example.com"
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleSendEmailCode}
                loading={sendingCode}
                disabled={cooldown > 0}
                className="sm:w-36"
              >
                <MailCheck className="h-4 w-4" />
                {cooldown > 0 ? `${cooldown}s 后重发` : '发送验证码'}
              </Button>
            </div>
          </div>
          <div>
            <Label htmlFor="profile-email-code">验证码</Label>
            <Input
              id="profile-email-code"
              inputMode="numeric"
              maxLength={6}
              value={emailCode}
              onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, ''))}
              placeholder="6 位数字"
            />
          </div>
          {emailError && <ErrorText>{emailError}</ErrorText>}
          <div className="flex justify-end">
            <Button type="submit" loading={savingEmail}>
              <Save className="h-4 w-4" />
              确认换绑
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader
          title="修改密码"
          description={passwordSet ? '修改后新密码立即生效' : '你的账户还没有密码，设置后即可正常登录'}
        />
        <form onSubmit={handleSavePassword} className="space-y-4 p-5">
          {passwordSet && (
            <div>
              <Label htmlFor="profile-old-password">当前密码</Label>
              <Input
                id="profile-old-password"
                type="password"
                autoComplete="current-password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                placeholder="请输入当前密码"
              />
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="profile-new-password">新密码</Label>
              <Input
                id="profile-new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="至少 8 位"
              />
            </div>
            <div>
              <Label htmlFor="profile-confirm-password">确认新密码</Label>
              <Input
                id="profile-confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="再次输入新密码"
              />
            </div>
          </div>
          {passwordError && <ErrorText>{passwordError}</ErrorText>}
          <div className="flex justify-end">
            <Button type="submit" loading={savingPassword}>
              <KeyRound className="h-4 w-4" />
              {passwordSet ? '更新密码' : '设置密码'}
            </Button>
          </div>
        </form>
      </Card>

      <p className="flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500">
        <UserRound className="h-3.5 w-3.5" />
        如需停用账户或变更角色，请联系系统管理员
      </p>
    </div>
  )
}
