import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ChevronDown,
  ChevronRight,
  Eye,
  FolderPlus,
  Globe,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react'
import { groupsApi, usersApi } from '@/lib/api'
import type {
  GroupDetail,
  GroupMember,
  MemberOverview,
  PermissionMap,
  ProjectGroup,
  ShortLink,
  UserItem,
} from '@/lib/types'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorText,
  Input,
  Label,
  LoadingBlock,
  Modal,
  Select,
  StatusBadge,
  Textarea,
} from '@/components/ui'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EditLinkModal } from '@/components/EditLinkModal'
import { PermissionEditor } from '@/components/PermissionEditor'
import { useToast } from '@/components/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { can, defaultPermissionMap, diffFromDefaults, GROUP_PERMISSION_DEFS } from '@/lib/permissions'
import { formatDateTime, ROLE_LABELS } from '@/lib/utils'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function flattenGroups(groups: ProjectGroup[], depth = 0): { id: number; label: string }[] {
  const result: { id: number; label: string }[] = []
  for (const g of groups) {
    result.push({ id: g.id, label: `${'— '.repeat(depth)}${g.name}` })
    if (g.children?.length) result.push(...flattenGroups(g.children, depth + 1))
  }
  return result
}

function GroupNode({
  group,
  selectedId,
  onSelect,
  depth = 0,
}: {
  group: ProjectGroup
  selectedId: number | null
  onSelect: (id: number) => void
  depth?: number
}) {
  const [open, setOpen] = useState(true)
  const hasChildren = !!group.children?.length

  return (
    <div>
      <div
        className={`flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1.5 text-sm transition-colors ${
          selectedId === group.id
            ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300'
            : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
        }`}
        style={{ paddingLeft: depth * 16 + 8 }}
        onClick={() => onSelect(group.id)}
      >
        <button
          className={`rounded p-0.5 text-gray-400 ${hasChildren ? '' : 'invisible'}`}
          onClick={(e) => {
            e.stopPropagation()
            setOpen((v) => !v)
          }}
          aria-label="展开或收起"
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        <span className="truncate">{group.name}</span>
        {group.my_role === 'admin' && (
          <span className="ml-auto shrink-0 rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
            管理
          </span>
        )}
      </div>
      {open && hasChildren && (
        <div>
          {group.children!.map((child) => (
            <GroupNode key={child.id} group={child} selectedId={selectedId} onSelect={onSelect} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function Groups() {
  const { user } = useAuth()
  const { show } = useToast()
  const isSuperAdmin = user?.role === 'super_admin'

  const [groups, setGroups] = useState<ProjectGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const [detail, setDetail] = useState<GroupDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const [allUsers, setAllUsers] = useState<UserItem[]>([])

  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState({ name: '', description: '', parent_id: '' })
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  // 编辑项目组名称 / 描述（超管或该组管理员）
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', description: '' })
  const [savingEdit, setSavingEdit] = useState(false)
  const [editError, setEditError] = useState('')

  // 组内短链详情/编辑
  const [editingLink, setEditingLink] = useState<ShortLink | null>(null)

  // 删除确认
  const [deletingGroupId, setDeletingGroupId] = useState<number | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  // 移除成员确认
  const [removingMember, setRemovingMember] = useState<{ id: number; name: string } | null>(null)
  const [removeLoading, setRemoveLoading] = useState(false)

  const [memberOpen, setMemberOpen] = useState(false)
  const [memberRole, setMemberRole] = useState<'member' | 'admin'>('member')
  const [memberKeyword, setMemberKeyword] = useState('')
  const [addingUserId, setAddingUserId] = useState<number | null>(null)
  const [memberCandidates, setMemberCandidates] = useState<{ id: number; name: string; email: string }[]>([])

  // 编辑成员身份
  const [editingMember, setEditingMember] = useState<{
    id: number
    name: string
    role: 'admin' | 'member'
    /** 打开弹窗时的原始身份，用于判断是否真的发生变更 */
    origin: 'admin' | 'member'
  } | null>(null)
  const [savingRole, setSavingRole] = useState(false)

  // 成员资料概览（IP / 所在组 / 创建的短链）
  const [overviewMember, setOverviewMember] = useState<{ id: number; name: string } | null>(null)
  const [memberOverview, setMemberOverview] = useState<MemberOverview | null>(null)
  const [overviewLoading, setOverviewLoading] = useState(false)

  // 成员权限配置
  const [permMember, setPermMember] = useState<GroupMember | null>(null)
  const [permValue, setPermValue] = useState<PermissionMap>({})
  const [permSaving, setPermSaving] = useState(false)

  const [domainOpen, setDomainOpen] = useState(false)
  const [domainId, setDomainId] = useState('')
  const [bindingDomain, setBindingDomain] = useState(false)
  const [bindableDomains, setBindableDomains] = useState<{ id: number; domain: string; status?: string }[]>([])
  const [bindablesLoading, setBindablesLoading] = useState(false)

  const flatGroups = useMemo(() => flattenGroups(groups), [groups])

  const loadGroups = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await groupsApi.list()
      setGroups(data.groups)
      setSelectedId((prev) => prev ?? (data.groups.length > 0 ? data.groups[0].id : null))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadGroups()
  }, [loadGroups])

  // 用户列表仅超级管理员可获取
  useEffect(() => {
    if (!isSuperAdmin) return
    usersApi
      .list({ pageSize: 200 })
      .then((data) => setAllUsers(data.users))
      .catch(() => setAllUsers([]))
  }, [isSuperAdmin])

  const loadDetail = useCallback(
    async (id: number) => {
      setDetailLoading(true)
      try {
        const data = await groupsApi.detail(id)
        setDetail(data)
      } catch (err) {
        show((err as Error).message, 'error')
        setDetail(null)
      } finally {
        setDetailLoading(false)
      }
    },
    [show],
  )

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId)
  }, [selectedId, loadDetail])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreateError('')
    if (!createForm.name.trim()) {
      setCreateError('请填写项目组名称')
      return
    }
    setCreating(true)
    try {
      const result = await groupsApi.create({
        name: createForm.name.trim(),
        description: createForm.description.trim() || undefined,
        parent_id: createForm.parent_id ? Number(createForm.parent_id) : undefined,
      })
      show('项目组创建成功', 'success')
      setCreateOpen(false)
      setCreateForm({ name: '', description: '', parent_id: '' })
      await loadGroups()
      setSelectedId(result.id)
    } catch (err) {
      setCreateError((err as Error).message)
    } finally {
      setCreating(false)
    }
  }

  // 打开「编辑项目组信息」弹窗
  const openEditModal = () => {
    if (!detail) return
    setEditForm({ name: detail.group.name, description: detail.group.description || '' })
    setEditError('')
    setEditOpen(true)
  }

  const handleSaveGroupInfo = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!detail) return
    setEditError('')
    if (!editForm.name.trim()) {
      setEditError('请填写项目组名称')
      return
    }
    setSavingEdit(true)
    try {
      await groupsApi.update(detail.group.id, {
        name: editForm.name.trim(),
        description: editForm.description.trim(),
      })
      show('项目组信息已更新', 'success')
      setEditOpen(false)
      await loadDetail(detail.group.id)
      await loadGroups()
    } catch (err) {
      setEditError((err as Error).message)
    } finally {
      setSavingEdit(false)
    }
  }

  const handleDeleteGroup = async () => {
    if (!deletingGroupId) return
    setDeleteLoading(true)
    try {
      const parentId = detail?.group.parent_id ?? null
      await groupsApi.remove(deletingGroupId)
      show('项目组已删除', 'success')
      setDetail(null)
      setDeletingGroupId(null)
      await loadGroups()
      // 删除后回到父组，避免右侧详情空白
      if (selectedId === deletingGroupId) setSelectedId(parentId)
    } catch (err) {
      show((err as Error).message, 'error')
    } finally {
      setDeleteLoading(false)
    }
  }

  // 搜索到成员后一键直接添加（弹窗保持打开，方便连续添加）
  const handleQuickAddMember = async (target: { id: number; name: string; email: string }) => {
    if (!selectedId) return
    // 具备「设置成员身份」权限时可直接添加为组管理员
    const canGrant = isSuperAdmin || canSetMemberRole
    const role: 'admin' | 'member' = canGrant ? memberRole : 'member'
    setAddingUserId(target.id)
    try {
      await groupsApi.addMember(selectedId, { user_id: target.id, role })
      show(`已将 ${target.name} 添加为${role === 'admin' ? '组管理员' : '成员'}`, 'success')
      if (!isSuperAdmin) setMemberCandidates((prev) => prev.filter((u) => u.id !== target.id))
      await loadDetail(selectedId)
      await loadGroups()
    } catch (err) {
      show((err as Error).message, 'error')
    } finally {
      setAddingUserId(null)
    }
  }

  // 快捷修改成员在组内的身份（成员 / 组管理员）
  const handleUpdateMemberRole = async () => {
    if (!selectedId || !editingMember) return
    if (editingMember.role === editingMember.origin) {
      setEditingMember(null)
      return
    }
    setSavingRole(true)
    try {
      await groupsApi.updateMemberRole(selectedId, editingMember.id, editingMember.role)
      show(`${editingMember.name} 已设为${editingMember.role === 'admin' ? '组管理员' : '成员'}`, 'success')
      setEditingMember(null)
      await loadDetail(selectedId)
      await loadGroups()
    } catch (err) {
      show((err as Error).message, 'error')
    } finally {
      setSavingRole(false)
    }
  }

  const handleRemoveMember = async () => {
    if (!selectedId || !removingMember) return
    setRemoveLoading(true)
    try {
      await groupsApi.removeMember(selectedId, removingMember.id)
      show('成员已移除', 'success')
      setRemovingMember(null)
      await loadDetail(selectedId)
      await loadGroups()
    } catch (err) {
      show((err as Error).message, 'error')
    } finally {
      setRemoveLoading(false)
    }
  }

  // 查看成员资料（IP / 所在组 / 创建的短链）
  const openMemberOverview = async (member: GroupMember) => {
    if (!selectedId) return
    setOverviewMember({ id: member.id, name: member.name })
    setMemberOverview(null)
    setOverviewLoading(true)
    try {
      const data = await groupsApi.memberOverview(selectedId, member.id)
      setMemberOverview(data)
    } catch (err) {
      show((err as Error).message, 'error')
      setOverviewMember(null)
    } finally {
      setOverviewLoading(false)
    }
  }

  // 配置单个成员在本组的权限
  const openMemberPermissions = (member: GroupMember) => {
    setPermMember(member)
    setPermValue(member.permissions || defaultPermissionMap(member.group_role))
  }

  const handleSaveMemberPermissions = async () => {
    if (!selectedId || !permMember) return
    setPermSaving(true)
    try {
      // 基线用「生效身份」：父组管理员即使在子组是普通成员，默认值也按管理员计算
      const overrides = diffFromDefaults(permValue, permMember.permission_role || permMember.group_role)
      await groupsApi.updateMemberPermissions(selectedId, permMember.id, overrides)
      show(`已更新 ${permMember.name} 的权限`, 'success')
      setPermMember(null)
      await loadDetail(selectedId)
    } catch (err) {
      show((err as Error).message, 'error')
    } finally {
      setPermSaving(false)
    }
  }

  const handleBindDomain = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedId || !domainId) {
      show('请选择域名', 'error')
      return
    }
    setBindingDomain(true)
    try {
      await groupsApi.bindDomain(selectedId, Number(domainId))
      show('域名已绑定', 'success')
      setDomainOpen(false)
      setDomainId('')
      await loadDetail(selectedId)
    } catch (err) {
      show((err as Error).message, 'error')
    } finally {
      setBindingDomain(false)
    }
  }

  const handleUnbindDomain = async (dId: number) => {
    if (!selectedId) return
    try {
      await groupsApi.unbindDomain(selectedId, dId)
      show('域名已解绑', 'success')
      await loadDetail(selectedId)
    } catch (err) {
      show((err as Error).message, 'error')
    }
  }

  // 是否有管理该组的权限（超管或该项目组管理员，含父组管理员）
  const canManageSelected = !!detail?.can_manage
  const canManageMembers = isSuperAdmin || can(detail?.permissions, 'group.member.add')
  const canRemoveMembers = isSuperAdmin || can(detail?.permissions, 'group.member.remove')
  const canSetMemberRole = isSuperAdmin || can(detail?.permissions, 'group.member.role')
  const canConfigMemberPerm = isSuperAdmin || can(detail?.permissions, 'group.member.permission')
  // 成员 IP / 权限明细属于敏感信息：仅超管与具备「配置成员权限」的用户可见
  const canViewMemberDetail = isSuperAdmin || detail?.can_view_member_detail === true || canConfigMemberPerm
  const canCreateChild = isSuperAdmin || can(detail?.permissions, 'group.create_child')
  const canManageDomain = isSuperAdmin || can(detail?.permissions, 'group.domain.manage')
  // 删除：超管可删任意组；组管理员只能删自己管理组下的子组（需「删除子组」权限）
  const canDeleteGroup =
    isSuperAdmin || (!!detail?.group.parent_id && can(detail?.permissions, 'group.delete'))

  const openMemberModal = () => {
    setMemberRole('member')
    setMemberKeyword('')
    setMemberOpen(true)
  }

  // 打开绑定域名弹窗：按当前用户权限加载可绑定域名（组管理员只能复用自己管理范围内已有的域名）
  const openDomainModal = async () => {
    if (!selectedId) return
    setDomainId('')
    setBindableDomains([])
    setDomainOpen(true)
    setBindablesLoading(true)
    try {
      const data = await groupsApi.bindableDomains(selectedId)
      setBindableDomains(data.domains)
    } catch (err) {
      show((err as Error).message, 'error')
      setBindableDomains([])
    } finally {
      setBindablesLoading(false)
    }
  }

  // 新建项目组（超管）或在自己管理的组下新建子组
  const openCreateModal = (parentId?: number) => {
    setCreateForm({ name: '', description: '', parent_id: parentId ? String(parentId) : '' })
    setCreateError('')
    setCreateOpen(true)
  }

  // 已在组内的成员 ID，用于从候选里排除
  const memberIds = useMemo(() => new Set((detail?.members || []).map((m) => m.id)), [detail])

  // 超级管理员：本地搜索全部用户；组管理员：必须输入完整邮箱精确查找（不允许浏览用户列表）
  useEffect(() => {
    if (!memberOpen || isSuperAdmin || !selectedId) return
    const kw = memberKeyword.trim()
    if (!EMAIL_RE.test(kw)) {
      setMemberCandidates([])
      return
    }
    const timer = setTimeout(() => {
      groupsApi
        .memberCandidates(selectedId, kw)
        .then((data) => setMemberCandidates(data.users))
        .catch(() => setMemberCandidates([]))
    }, 250)
    return () => clearTimeout(timer)
  }, [memberOpen, isSuperAdmin, selectedId, memberKeyword])

  const matchedUsers = useMemo(() => {
    if (!isSuperAdmin) return memberCandidates
    const kw = memberKeyword.trim().toLowerCase()
    return allUsers
      .filter((u) => !memberIds.has(u.id) && u.status === 'active')
      .filter((u) => !kw || u.name.toLowerCase().includes(kw) || u.email.toLowerCase().includes(kw))
  }, [isSuperAdmin, memberCandidates, allUsers, memberIds, memberKeyword])

  const candidateList = isSuperAdmin ? matchedUsers.slice(0, 30) : matchedUsers
  const matchCount = matchedUsers.length

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">项目组</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            通过项目组细分团队，组内成员可共同查看短链，组管理员可管理成员与审核
          </p>
        </div>
        {isSuperAdmin && (
          <Button size="sm" onClick={() => openCreateModal()}>
            <FolderPlus className="h-4 w-4" />
            新建项目组
          </Button>
        )}
      </div>

      {error && <ErrorText>{error}</ErrorText>}

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <Card className="p-3">
          <p className="px-2 pb-2 text-xs font-medium uppercase tracking-wide text-gray-400">项目组结构</p>
          {loading ? (
            <LoadingBlock />
          ) : groups.length === 0 ? (
            isSuperAdmin ? (
              <EmptyState title="当前暂无项目组" description="点击右上角「新建项目组」开始创建" />
            ) : (
              <EmptyState title="当前暂无项目组" description="你还没有被加入任何项目组，请联系管理员" />
            )
          ) : (
            <div className="space-y-0.5">
              {groups.map((g) => (
                <GroupNode key={g.id} group={g} selectedId={selectedId} onSelect={setSelectedId} />
              ))}
            </div>
          )}
        </Card>

        <div className="space-y-4">
          {detailLoading && <LoadingBlock />}

          {!detailLoading && !detail && (
            <Card>
              <EmptyState title="请选择一个项目组" description="在左侧选择项目组查看详情" />
            </Card>
          )}

          {!detailLoading && detail && (
            <>
              <Card>
                <CardHeader
                  title={detail.group.name}
                  description={detail.group.description || '暂无描述'}
                  action={
                    <div className="flex flex-wrap gap-2">
                      {/* 超级管理员与项目组（含父组）管理员均可编辑组名称/描述 */}
                      {(isSuperAdmin || canManageSelected) && (
                        <Button variant="outline" size="sm" onClick={openEditModal}>
                          <Pencil className="h-4 w-4" />
                          编辑
                        </Button>
                      )}
                      {/* 超级管理员与项目组（含父组）管理员均可添加成员 */}
                      {(isSuperAdmin || canManageMembers) && (
                        <Button variant="outline" size="sm" onClick={openMemberModal}>
                          <UserPlus className="h-4 w-4" />
                          添加成员
                        </Button>
                      )}
                      {/* 项目组管理员可在自己管理的组下创建子组 */}
                      {canCreateChild && (
                        <Button variant="outline" size="sm" onClick={() => openCreateModal(detail.group.id)}>
                          <FolderPlus className="h-4 w-4" />
                          新建子组
                        </Button>
                      )}
                      {/* 超管可绑定任意域名；项目组管理员只能复用自己管理范围内已有的域名 */}
                      {canManageDomain && (
                        <Button variant="outline" size="sm" onClick={() => void openDomainModal()}>
                          <Globe className="h-4 w-4" />
                          绑定域名
                        </Button>
                      )}
                      {canDeleteGroup && (
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => setDeletingGroupId(detail.group.id)}
                          title={
                            isSuperAdmin && !detail.group.parent_id
                              ? undefined
                              : '删除当前子组（组内需已清空短链与子组）'
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                          删除
                        </Button>
                      )}
                    </div>
                  }
                />
                <div className="grid gap-3 p-5 text-sm sm:grid-cols-4">
                  <div>
                    <p className="text-xs text-gray-400">成员数</p>
                    <p className="mt-1 font-medium text-gray-900 dark:text-gray-100">{detail.members.length}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">子组数</p>
                    <p className="mt-1 font-medium text-gray-900 dark:text-gray-100">{detail.subGroups.length}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">组内短链</p>
                    <p className="mt-1 font-medium text-gray-900 dark:text-gray-100">{detail.links.length}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">创建者</p>
                    <p className="mt-1 truncate font-medium text-gray-900 dark:text-gray-100">
                      {detail.group.created_by_email || '-'}
                    </p>
                  </div>
                </div>
              </Card>

              {/* 组内短链 */}
              <Card>
                <CardHeader
                  title="组内短链"
                  description={`共 ${detail.links.length} 条，组内成员均可查看`}
                />
                {detail.links.length === 0 ? (
                  <EmptyState
                    title="该项目组暂无短链"
                    description={
                      detail.domains.length === 0
                        ? '该项目组暂无可用域名，请联系超级管理员绑定域名'
                        : '组内成员创建短链时选择该项目组即可在此查看'
                    }
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-sm">
                      <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">
                        <tr>
                          <th className="px-5 py-2.5 font-medium">短链 / 名称</th>
                          <th className="px-4 py-2.5 font-medium">目标链接</th>
                          <th className="px-4 py-2.5 font-medium">创建人</th>
                          <th className="px-4 py-2.5 font-medium">状态</th>
                          <th className="px-5 py-2.5 text-right font-medium">操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {detail.links.map((l) => (
                          <tr key={l.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                            <td className="px-5 py-3">
                              {/* 与短链管理一致：点击短码进入详情页 */}
                              <Link
                                to={`/dashboard/links/${l.id}`}
                                className="font-medium text-brand-600 hover:underline dark:text-brand-400"
                              >
                                {l.domain_name ? `${l.domain_name}/${l.short_code}` : `/${l.short_code}`}
                              </Link>
                              <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                                {l.name || '（未命名）'}
                              </p>
                            </td>
                            <td className="max-w-[220px] px-4 py-3">
                              <span className="block truncate text-gray-600 dark:text-gray-400" title={l.target_url}>
                                {l.target_url}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                              {l.creator_name || '-'}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <StatusBadge status={l.status} />
                                {l.review_status === 'pending' && <Badge tone="yellow">待审核</Badge>}
                                {l.review_status === 'rejected' && <Badge tone="red">未通过</Badge>}
                              </div>
                            </td>
                            <td className="px-5 py-3 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Link
                                  to={`/dashboard/links/${l.id}`}
                                  className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-brand-600 dark:hover:bg-gray-800"
                                  title="查看详情"
                                >
                                  <ChevronRight className="h-4 w-4" />
                                </Link>
                                {l.can_manage && (
                                  <button
                                    onClick={() => setEditingLink(l)}
                                    className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-brand-600 dark:hover:bg-gray-800"
                                    title="编辑"
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              <Card>
                <CardHeader title="成员" description={`共 ${detail.members.length} 位成员`} />
                {detail.members.length === 0 ? (
                  <EmptyState
                    title="暂无成员"
                    description={isSuperAdmin ? '点击「添加成员」将用户加入项目组' : '暂无成员，请联系超级管理员添加'}
                  />
                ) : (
                  <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                    {detail.members.map((m) => {
                      const isSelf = m.id === user?.id
                      // 超级管理员可以移除自己；组管理员不能移除自己、也不能移除其他管理员
                      const canRemove =
                        canRemoveMembers && (!isSelf || isSuperAdmin) && (isSuperAdmin || m.group_role !== 'admin')
                      // 同级组管理员不能互相改身份，需由上级管理员或超管处理；超管可改自己的身份
                      const canEditRole =
                        canSetMemberRole && (!isSelf || isSuperAdmin) && (isSuperAdmin || m.group_role !== 'admin')
                      const canEditPerm = canConfigMemberPerm && (!isSelf || isSuperAdmin)
                      const enabledPerms = Object.keys(m.permissions || {}).filter((k) => m.permissions?.[k]).length
                      return (
                        <li key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                              {m.name} <span className="text-xs font-normal text-gray-400">{m.email}</span>
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              {ROLE_LABELS[m.role] || m.role}
                              {typeof m.link_count === 'number' ? ` · ${m.link_count} 条短链` : ''}
                              {canViewMemberDetail ? ` · 已开启 ${enabledPerms} 项权限` : ''}
                            </p>
                            {canViewMemberDetail && (
                              <p className="font-mono text-[11px] text-gray-400">
                                IP：{m.last_login_ip || '-'}
                                {m.last_login_at ? ` · ${formatDateTime(m.last_login_at)}` : ''}
                              </p>
                            )}
                          </div>
                          <Badge tone={m.group_role === 'admin' ? 'purple' : 'gray'}>
                            {m.group_role === 'admin' ? '组管理员' : '成员'}
                          </Badge>
                          <StatusBadge status={m.status} />
                          <div className="flex items-center gap-1">
                            {canViewMemberDetail && (
                              <button
                                onClick={() => void openMemberOverview(m)}
                                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-brand-600 dark:hover:bg-gray-800"
                                title="查看成员资料（IP / 所在组 / 创建的短链）"
                              >
                                <Eye className="h-4 w-4" />
                              </button>
                            )}
                            {canEditPerm && (
                              <button
                                onClick={() => openMemberPermissions(m)}
                                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-brand-600 dark:hover:bg-gray-800"
                                title="配置成员权限"
                              >
                                <ShieldCheck className="h-4 w-4" />
                              </button>
                            )}
                            {canEditRole && (
                              <button
                                onClick={() =>
                                  setEditingMember({ id: m.id, name: m.name, role: m.group_role, origin: m.group_role })
                                }
                                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-brand-600 dark:hover:bg-gray-800"
                                title="编辑成员身份"
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                            )}
                            {canRemove && (
                              <button
                                onClick={() => setRemovingMember({ id: m.id, name: m.name })}
                                className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                                title="移除成员"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </Card>

              <Card>
                <CardHeader
                  title="可用域名"
                  description={
                    isSuperAdmin
                      ? '项目组内创建短链时可使用的域名'
                      : '项目组内创建短链时可使用的域名（组管理员可复用父组已有域名）'
                  }
                  action={
                    canManageDomain ? (
                      <Button variant="outline" size="sm" onClick={() => void openDomainModal()}>
                        <Plus className="h-4 w-4" />
                        绑定
                      </Button>
                    ) : undefined
                  }
                />
                {detail.domains.length === 0 ? (
                  <EmptyState
                    title="暂无可用域名"
                    description={
                      isSuperAdmin
                        ? '绑定域名后，组内成员即可使用该域名创建短链'
                        : canManageDomain
                          ? '可绑定自己管理范围内（含父组）已经绑定过的域名'
                          : '该项目组暂未绑定域名，请联系项目组管理员或超级管理员绑定'
                    }
                  />
                ) : (
                  <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                    {detail.domains.map((d) => (
                      <li key={d.id} className="flex items-center gap-3 px-5 py-3">
                        <Globe className="h-4 w-4 text-gray-400" />
                        <span className="flex-1 text-sm text-gray-900 dark:text-gray-100">{d.domain}</span>
                        <StatusBadge status={d.status} />
                        {canManageDomain && (
                          <button
                            onClick={() => handleUnbindDomain(d.id)}
                            className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                            title="解绑"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card>
                <CardHeader title="子项目组" description={`共 ${detail.subGroups.length} 个子组`} />
                {detail.subGroups.length === 0 ? (
                  <EmptyState
                    title="暂无子组"
                    description={
                    isSuperAdmin || canManageSelected
                      ? '点击上方「新建子组」即可创建，子组会继承父组的管理权限'
                      : '暂无子项目组'
                  }
                  />
                ) : (
                  <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                    {detail.subGroups.map((g) => (
                      <li key={g.id} className="flex items-center justify-between px-5 py-3">
                        <span className="text-sm text-gray-900 dark:text-gray-100">{g.name}</span>
                        <Button variant="ghost" size="sm" onClick={() => setSelectedId(g.id)}>
                          查看
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </>
          )}
        </div>
      </div>

      {/* 新建项目组（超管）或子组（项目组管理员） */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={isSuperAdmin ? '新建项目组' : '新建子组'}
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreate} loading={creating}>
              创建
            </Button>
          </>
        }
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <Label htmlFor="g-name">项目组名称 *</Label>
            <Input
              id="g-name"
              value={createForm.name}
              onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
              placeholder="如：市场部"
            />
          </div>
          {isSuperAdmin ? (
            <div>
              <Label htmlFor="g-parent">父项目组（可选，用于创建子组）</Label>
              <Select
                id="g-parent"
                value={createForm.parent_id}
                onChange={(e) => setCreateForm({ ...createForm, parent_id: e.target.value })}
              >
                <option value="">无（作为顶级项目组）</option>
                {flatGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.label}
                  </option>
                ))}
              </Select>
            </div>
          ) : (
            <div>
              <Label>父项目组</Label>
              <div className="flex h-10 items-center rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-300">
                {flatGroups.find((g) => String(g.id) === createForm.parent_id)?.label || '当前项目组'}
              </div>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                只能在你自己管理的项目组下创建子组，子组会继承父组的管理权限
              </p>
            </div>
          )}
          <div>
            <Label htmlFor="g-desc">描述</Label>
            <Textarea
              id="g-desc"
              rows={3}
              value={createForm.description}
              onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
              placeholder="项目组用途说明（可选）"
            />
          </div>
          {createError && <ErrorText>{createError}</ErrorText>}
        </form>
      </Modal>

      {/* 编辑项目组信息 */}
      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="编辑项目组"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              取消
            </Button>
            <Button onClick={handleSaveGroupInfo} loading={savingEdit}>
              保存
            </Button>
          </>
        }
      >
        <form onSubmit={handleSaveGroupInfo} className="space-y-4">
          <div>
            <Label htmlFor="g-edit-name">项目组名称 *</Label>
            <Input
              id="g-edit-name"
              value={editForm.name}
              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              placeholder="如：市场部"
            />
          </div>
          <div>
            <Label htmlFor="g-edit-desc">描述</Label>
            <Textarea
              id="g-edit-desc"
              rows={3}
              value={editForm.description}
              onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
              placeholder="项目组用途说明（可选）"
            />
          </div>
          {editError && <ErrorText>{editError}</ErrorText>}
        </form>
      </Modal>

      {/* 添加成员（超管或该组/父组管理员） */}
      <Modal
        open={memberOpen}
        onClose={() => setMemberOpen(false)}
        title="添加成员"
        footer={
          <Button variant="outline" onClick={() => setMemberOpen(false)}>
            关闭
          </Button>
        }
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="m-search">搜索成员</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                id="m-search"
                className="pl-9"
                placeholder={isSuperAdmin ? '输入姓名或邮箱搜索' : '输入对方完整邮箱精确查找'}
                value={memberKeyword}
                onChange={(e) => setMemberKeyword(e.target.value)}
                autoComplete="off"
              />
            </div>
            {!isSuperAdmin && (
              <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                为保护用户隐私，你的账号无法浏览用户列表，请向对方索取完整邮箱后精确查找
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="m-role">以什么身份添加</Label>
            <Select
              id="m-role"
              value={memberRole}
              disabled={!(isSuperAdmin || canSetMemberRole)}
              onChange={(e) => setMemberRole(e.target.value as 'member' | 'admin')}
            >
              <option value="member">成员（可创建并查看组内短链）</option>
              <option value="admin">组管理员（可管理组内成员、域名与短链）</option>
            </Select>
            {!(isSuperAdmin || canSetMemberRole) && (
              <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                你没有设置成员身份的权限，只能添加普通成员
              </p>
            )}
            {!isSuperAdmin && canSetMemberRole && (
              <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                你可以为该组（含子组）设置组管理员，被设置的组管理员默认拥有全部组内权限，也可在成员列表中逐项调整
              </p>
            )}
          </div>
          <div>
            <Label>
              {isSuperAdmin ? '可添加的成员' : '查找结果'}
              {matchCount > 0 ? `（${matchCount}）` : ''}
            </Label>
            <div className="max-h-72 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
              {candidateList.length === 0 ? (
                <p className="px-4 py-6 text-center text-xs text-gray-400">
                  {isSuperAdmin
                    ? memberKeyword.trim()
                      ? '没有匹配的可添加成员'
                      : '暂无可添加的成员'
                    : !memberKeyword.trim()
                      ? '请输入对方完整邮箱进行查找'
                      : !EMAIL_RE.test(memberKeyword.trim())
                        ? '请输入完整邮箱，例如 name@example.com'
                        : '未找到该邮箱对应的可添加用户'}
                </p>
              ) : (
                candidateList.map((u) => (
                  <div key={u.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{u.name}</p>
                      <p className="truncate text-xs text-gray-500 dark:text-gray-400">{u.email}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      loading={addingUserId === u.id}
                      disabled={addingUserId !== null && addingUserId !== u.id}
                      onClick={() => void handleQuickAddMember(u)}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      添加
                    </Button>
                  </div>
                ))
              )}
            </div>
            <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
              点击「添加」即可直接加入项目组，弹窗会保持打开，方便连续添加
            </p>
          </div>
        </div>
      </Modal>

      {/* 成员资料概览 */}
      <Modal
        open={!!overviewMember}
        onClose={() => {
          setOverviewMember(null)
          setMemberOverview(null)
        }}
        title={overviewMember ? `成员资料 · ${overviewMember.name}` : '成员资料'}
        wide
        footer={
          <Button
            variant="outline"
            onClick={() => {
              setOverviewMember(null)
              setMemberOverview(null)
            }}
          >
            关闭
          </Button>
        }
      >
        {overviewLoading ? (
          <LoadingBlock label="正在加载成员资料..." />
        ) : memberOverview ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
                <p className="text-xs text-gray-500 dark:text-gray-400">账号</p>
                <p className="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">
                  {memberOverview.user.email}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <Badge tone="gray">{ROLE_LABELS[memberOverview.user.role] || memberOverview.user.role}</Badge>
                  <StatusBadge status={memberOverview.user.status} />
                </div>
                <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                  注册于 {formatDateTime(memberOverview.user.created_at)}
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
                <p className="text-xs text-gray-500 dark:text-gray-400">最后登录</p>
                <p className="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">
                  {memberOverview.user.last_login_at
                    ? formatDateTime(memberOverview.user.last_login_at)
                    : '从未登录'}
                </p>
                <p className="mt-1 font-mono text-xs text-gray-500 dark:text-gray-400">
                  IP：{memberOverview.user.last_login_ip || '-'}
                  <span className="ml-2 font-sans text-gray-400">
                    {memberOverview.user.last_login_location || '未知归属地'}
                  </span>
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {[
                { label: '创建短链', value: memberOverview.link_summary.total },
                { label: '活跃短链', value: memberOverview.link_summary.active },
                { label: '累计点击', value: memberOverview.link_summary.clicks },
              ].map((item) => (
                <div key={item.label} className="rounded-lg bg-gray-50 p-3 text-center dark:bg-gray-800/60">
                  <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">{item.value || 0}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{item.label}</p>
                </div>
              ))}
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                所在项目组（{memberOverview.groups.length}）
              </p>
              {memberOverview.groups.length === 0 ? (
                <p className="rounded-lg border border-dashed border-gray-200 px-3 py-3 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  该用户尚未加入任何项目组
                </p>
              ) : (
                <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
                  {memberOverview.groups.map((g) => (
                    <li key={g.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                      <span className="flex-1 text-sm text-gray-900 dark:text-gray-100">{g.path}</span>
                      <Badge tone={g.group_role === 'admin' ? 'purple' : 'gray'}>
                        {g.group_role === 'admin' ? '组管理员' : '成员'}
                      </Badge>
                      <span className="text-[11px] text-gray-400">加入于 {formatDateTime(g.joined_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                最近创建的短链
              </p>
              {memberOverview.links.length === 0 ? (
                <p className="rounded-lg border border-dashed border-gray-200 px-3 py-3 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  该用户在你的管理范围内还没有创建短链
                </p>
              ) : (
                <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
                  {memberOverview.links.map((l) => (
                    <li key={l.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                      <Link
                        to={`/dashboard/links/${l.id}`}
                        className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
                      >
                        {l.domain_name ? `${l.domain_name}/${l.short_code}` : `/${l.short_code}`}
                      </Link>
                      <span className="min-w-0 flex-1 truncate text-xs text-gray-500 dark:text-gray-400">
                        {l.target_url}
                      </span>
                      <span className="text-[11px] text-gray-400">{l.group_name || '个人'}</span>
                      <StatusBadge status={l.status} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : (
          <ErrorText>加载失败，请重试</ErrorText>
        )}
      </Modal>

      {/* 配置成员权限 */}
      <Modal
        open={!!permMember}
        onClose={() => setPermMember(null)}
        title={permMember ? `配置权限 · ${permMember.name}` : '配置权限'}
        wide
        footer={
          <>
            <Button variant="outline" onClick={() => setPermMember(null)}>
              取消
            </Button>
            <Button onClick={handleSaveMemberPermissions} loading={permSaving}>
              保存
            </Button>
          </>
        }
      >
        {permMember && (() => {
          const baselineRole = permMember.permission_role || permMember.group_role
          const isAdminBaseline = baselineRole === 'admin'
          return (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:bg-gray-800/60 dark:text-gray-300">
                <Badge tone={isAdminBaseline ? 'purple' : 'gray'}>
                  {isAdminBaseline ? '组管理员' : '成员'}
                </Badge>
                <span>
                  默认权限：
                  {isAdminBaseline
                    ? '全部组内权限（含子组，可向下继承）'
                    : '创建短链、查看组内短链、编辑 / 删除自己的短链'}
                </span>
              </div>
              <PermissionEditor
                defs={GROUP_PERMISSION_DEFS}
                value={permValue}
                onChange={setPermValue}
                defaults={defaultPermissionMap(baselineRole)}
                description={`按需为 ${permMember.name} 单独开关权限，保存后立即生效；标记「已单独配置」的项与默认值不同`}
              />
              <div className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
                <span>重置为该身份默认权限</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPermValue(defaultPermissionMap(baselineRole))}
                >
                  恢复默认
                </Button>
              </div>
            </div>
          )
        })()}
      </Modal>

      {/* 编辑成员身份（仅超管） */}
      <Modal
        open={!!editingMember}
        onClose={() => setEditingMember(null)}
        title="编辑成员身份"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditingMember(null)}>
              取消
            </Button>
            <Button onClick={handleUpdateMemberRole} loading={savingRole}>
              保存
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-lg bg-gray-50 px-4 py-3 dark:bg-gray-800/60">
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{editingMember?.name}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">调整该用户在当前项目组内的身份</p>
          </div>
          <div>
            <Label htmlFor="m-edit-role">组内身份</Label>
            <Select
              id="m-edit-role"
              value={editingMember?.role ?? 'member'}
              onChange={(e) =>
                setEditingMember((prev) => (prev ? { ...prev, role: e.target.value as 'admin' | 'member' } : prev))
              }
            >
              <option value="member">成员（可查看组内短链）</option>
              <option value="admin">组管理员（可审核短链、管理组内成员）</option>
            </Select>
          </div>
        </div>
      </Modal>

      {/* 绑定域名（超管任意域名；项目组管理员仅限自己管理范围内已有域名） */}
      <Modal
        open={domainOpen}
        onClose={() => setDomainOpen(false)}
        title="绑定域名"
        footer={
          <>
            <Button variant="outline" onClick={() => setDomainOpen(false)}>
              取消
            </Button>
            <Button onClick={handleBindDomain} loading={bindingDomain}>
              绑定
            </Button>
          </>
        }
      >
        <form onSubmit={handleBindDomain} className="space-y-4">
          <div>
            <Label htmlFor="d-select">选择域名</Label>
            {bindablesLoading ? (
              <div className="flex h-10 items-center rounded-lg border border-gray-200 px-3 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
                可绑定域名加载中...
              </div>
            ) : (
              <Select id="d-select" value={domainId} onChange={(e) => setDomainId(e.target.value)}>
                <option value="">请选择域名</option>
                {bindableDomains.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.domain}
                    {d.status && d.status !== 'active' ? '（未激活）' : ''}
                  </option>
                ))}
              </Select>
            )}
            {!bindablesLoading && bindableDomains.length === 0 && (
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                {isSuperAdmin
                  ? '暂无可绑定域名，请先在「域名管理」中添加并验证域名'
                  : '暂无可用域名：只能绑定自己管理范围内（含父组）已经绑定过且可用的域名，如有需要请联系超级管理员'}
              </p>
            )}
            {!isSuperAdmin && (
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                为避免越权，项目组管理员只能把父组已有的域名分配给子组，无法绑定全站其它域名
              </p>
            )}
          </div>
        </form>
      </Modal>

      {/* 组内短链编辑：与短链管理使用同一套编辑弹窗 */}
      <EditLinkModal
        link={editingLink}
        groups={groups}
        onClose={() => setEditingLink(null)}
        onSaved={() => {
          if (selectedId) void loadDetail(selectedId)
        }}
      />

      <ConfirmDialog
        open={deletingGroupId !== null}
        title={isSuperAdmin && !detail?.group.parent_id ? '删除项目组' : '删除子项目组'}
        description="确定删除该子项目组吗？组内成员与域名绑定会一并解除，操作不可恢复。组内仍有子组或短链时无法删除。"
        confirmText="确认删除"
        loading={deleteLoading}
        onCancel={() => setDeletingGroupId(null)}
        onConfirm={handleDeleteGroup}
      />

      <ConfirmDialog
        open={!!removingMember}
        title="移除成员"
        description={`确定将「${removingMember?.name}」移出该项目组吗？`}
        confirmText="确认移除"
        loading={removeLoading}
        onCancel={() => setRemovingMember(null)}
        onConfirm={handleRemoveMember}
      />
    </div>
  )
}
