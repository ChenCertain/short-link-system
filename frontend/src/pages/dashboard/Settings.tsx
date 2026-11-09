import { useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import { configApi } from '@/lib/api'
import { Button, Card, CardHeader, ErrorText, Input, Label, LoadingBlock, Select } from '@/components/ui'
import { useToast } from '@/components/Toast'

export default function Settings() {
  const { show } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    site_name: '短链管理系统',
    default_redirect_type: '302',
  })

  useEffect(() => {
    configApi
      .get()
      .then((data) => {
        setForm({
          site_name: data.config.site_name || '短链管理系统',
          default_redirect_type: data.config.default_redirect_type || '302',
        })
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      await configApi.update({
        site_name: form.site_name.trim() || '短链管理系统',
        default_redirect_type: form.default_redirect_type,
      })
      show('设置已保存', 'success')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <LoadingBlock />

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">系统设置</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">配置站点基础信息与默认行为</p>
      </div>

      <Card>
        <CardHeader title="基础设置" description="影响首页与短链创建默认值" />
        <form onSubmit={handleSave} className="space-y-4 p-5">
          <div>
            <Label htmlFor="site-name">站点名称</Label>
            <Input
              id="site-name"
              value={form.site_name}
              onChange={(e) => setForm({ ...form, site_name: e.target.value })}
              placeholder="短链管理系统"
            />
            <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">显示在首页与登录页</p>
          </div>
          <div>
            <Label htmlFor="redirect-type">默认跳转类型</Label>
            <Select
              id="redirect-type"
              value={form.default_redirect_type}
              onChange={(e) => setForm({ ...form, default_redirect_type: e.target.value })}
            >
              <option value="302">302 临时跳转（推荐，统计准确）</option>
              <option value="301">301 永久跳转（浏览器会缓存）</option>
            </Select>
          </div>

          {error && <ErrorText>{error}</ErrorText>}

          <Button type="submit" loading={saving}>
            <Save className="h-4 w-4" />
            保存设置
          </Button>
        </form>
      </Card>

    </div>
  )
}
