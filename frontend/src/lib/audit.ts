// 审计日志的展示文案：操作名、对象类型、详情键值的中文映射。
// 「操作审计」页面与「用户管理 → 操作记录」共用，避免两处翻译不一致。

export const ACTION_LABELS: Record<string, string> = {
  login: '登录',
  init_admin: '初始化管理员',
  setup_password: '设置密码',
  change_password: '修改密码',
  change_email: '修改邮箱',
  update_profile: '更新个人资料',
  create_link: '创建短链',
  update_link: '更新短链',
  resubmit_link: '重新提交审核',
  delete_link: '删除短链',
  batch_import_links: '批量导入短链',
  approve_link: '通过审核',
  reject_link: '驳回审核',
  toggle_display: '首页展示',
  create_user: '创建用户',
  update_user: '更新用户',
  delete_user: '删除用户',
  update_user_permissions: '配置用户全局权限',
  create_group: '创建项目组',
  update_group: '更新项目组',
  delete_group: '删除项目组',
  add_group_member: '添加组成员',
  update_member_review: '调整成员审核方式',
  remove_group_member: '移除组成员',
  update_group_member_role: '调整组成员身份',
  update_group_member_permissions: '配置组成员权限',
  bind_group_domain: '绑定项目组域名',
  unbind_group_domain: '解绑项目组域名',
  add_domain: '添加域名',
  update_domain: '更新域名',
  verify_domain: '验证域名',
  delete_domain: '删除域名',
  update_config: '更新系统配置',
}

export const TARGET_TYPE_LABELS: Record<string, string> = {
  user: '用户',
  group: '项目组',
  link: '短链',
  domain: '域名',
  config: '系统配置',
  system: '系统',
}

const DETAIL_KEY_LABELS: Record<string, string> = {
  ip: 'IP',
  email: '邮箱',
  name: '名称',
  role: '角色',
  status: '状态',
  permissions: '权限',
  user_id: '用户',
  target_user_id: '目标用户',
  group_id: '项目组',
  domain_id: '域名',
  parent_id: '上级项目组',
  short_code: '短链',
  target_url: '目标链接',
  domain: '域名',
  type: '类型',
  description: '描述',
  review_status: '审核状态',
  review_group_id: '审核项目组',
  review_by: '审核方式',
  require_review: '需要审核',
  group_role: '组内身份',
  note: '备注',
  count: '数量',
  method: '验证方式',
  is_default_short_link: '设为默认短链域名',
  is_root: '最高权限账户',
  password: '密码',
  new_password: '新密码',
  old_password: '旧密码',
  force_https: '强制 HTTPS',
  site_name: '站点名称',
  turnstile_site_key: 'Turnstile Site Key',
}

const ROLE_VALUES: Record<string, string> = {
  super_admin: '超级管理员',
  user: '普通用户',
  admin: '组管理员',
  member: '组成员',
}

const STATUS_VALUES: Record<string, string> = {
  active: '正常',
  disabled: '已停用',
  pending_verification: '待验证',
  verified: '已验证',
}

const REVIEW_VALUES: Record<string, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已驳回',
}

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] || action
}

export function targetTypeLabel(type: string | null | undefined): string {
  if (!type) return '-'
  return TARGET_TYPE_LABELS[type] || type
}

function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'boolean') return value ? '开启' : '关闭'
  if (typeof value === 'object') {
    const text = JSON.stringify(value)
    return text.length > 70 ? `${text.slice(0, 70)}…` : text
  }
  const text = String(value)
  if (key === 'role') return ROLE_VALUES[text] || text
  if (key === 'status') return STATUS_VALUES[text] || text
  if (key === 'review_status') return REVIEW_VALUES[text] || text
  if (key === 'review_by') {
    if (text === 'super_admin') return '超级管理员'
    if (text === 'parent') return '父组管理员'
    return '组内管理员（逐级向上）'
  }
  return text
}

/** 把审计详情（JSON 或纯文本）转成可读的中文描述 */
export function describeDetail(detail: string | null): string {
  if (!detail) return '-'
  const text = detail.trim()
  if (!text.startsWith('{') && !text.startsWith('[')) return detail
  try {
    const parsed: unknown = JSON.parse(text)
    if (Array.isArray(parsed)) {
      const joined = parsed
        .map((item) => (typeof item === 'object' ? JSON.stringify(item) : String(item)))
        .join('、')
      return joined.length > 120 ? `${joined.slice(0, 120)}…` : joined || '-'
    }
    const parts = Object.entries(parsed as Record<string, unknown>)
      .map(([key, value]) => {
        const formatted = formatValue(key, value)
        if (!formatted) return ''
        const label = DETAIL_KEY_LABELS[key] || key
        return `${label}：${formatted.length > 60 ? `${formatted.slice(0, 60)}…` : formatted}`
      })
      .filter(Boolean)
    return parts.length > 0 ? parts.join(' · ') : '-'
  } catch {
    return detail
  }
}
