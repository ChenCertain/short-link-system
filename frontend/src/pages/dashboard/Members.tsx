import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ExternalLink,
  FileCheck2,
  Link2,
  Pencil,
  Search,
  ShieldCheck,
  Trash2,
  UserMinus,
  UserPlus,
  UserRoundPlus,
} from 'lucide-react'
import { groupsApi, linksApi, membersApi } from '@/lib/api'
import type { ScopedMember, ScopedMemberGroup } from '@/lib/api'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorText,
  Input,
  Label,
  LoadingBlock,
  Modal,
  Select,
  Spinner,
  StatusBadge,
} from '@/components/ui'
import { EditLinkModal } from '@/components/EditLinkModal'
import { PermissionEditor } from '@/components/PermissionEditor'
import { useToast } from '@/components/Toast'
import { GROUP_PERMISSION_DEFS, defaultPermissionMap, diffFromDefaults } from '@/lib/permissions'
import type { PermissionMap, ProjectGroup, ShortLink } from '@/lib/types'
import { formatDateTime } from '@/lib/utils'

/** 成员管理：组管理员 / 超级管理员在「自己管理的项目组」内统一管理成员 */
export default function Members() {
  const { show } = useToast()

  const [groups, setGroups] = useState<ScopedMemberGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [keyword, setKeyword] = useState('')
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)

  // 权限配置弹窗
  const [permMember, setPermMember] = useState<ScopedMember | null>(null)
  const [permValue, setPermValue] = useState<PermissionMap>({})
  const [permDefaults, setPermDefaults] = useState<PermissionMap>({})
  const [permSaving, setPermSaving] = useState(false)

  // 移除确认
  const [removing, setRemoving] = useState<ScopedMember | null>(null)
  const [removeLoading, setRemoveLoading] = useState(false)

  // 添加成员
  const [addOpen, setAddOpen] = useState(false)
  const [candidates, setCandidates] = useState<{ id: number; name: string; email: string }[]>([])
  const [candidateSearch, setCandidateSearch] = useState('')
  const [candidateLoading, setCandidateLoading] = useState(false)
  const [addUserId, setAddUserId] = useState(0)
  const [addRole, setAddRole] = useState<'admin' | 'member'>('member')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')

  // 成员短链（组管理员可直接管理组内成员的短链）
  const [groupTree, setGroupTree] = useState<ProjectGroup[]>([])
  const [linkMember, setLinkMember] = useState<ScopedMember | null>(null)
  const [memberLinks, setMemberLinks] = useState<ShortLink[]>([])
  const [memberLinksTotal, setMemberLinksTotal] = useState(0)
  const [memberLinksPage, setMemberLinksPage] = useState(1)
  const [memberLinksLoading, setMemberLinksLoading] = useState(false)
  const [editingLink, setEditingLink] = useState<ShortLink | null>(null)
  const [deletingLink, setDeletingLink] = useState<ShortLink | null>(null)
  const [linkDeleteLoading, setLinkDeleteLoading] = useState(false)
  const memberLinkPageSize = 10

  // 创建用户（仅管理范围内）
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState<{
    name: string
    email: string
    password: string
    group_id: number
    group_role: 'admin' | 'member'
    require_review: boolean
    review_by: 'auto' | 'parent' | 'super_admin'
  }>({
    name: '',
    email: '',
    password: '',
    group_id: 0,
    group_role: 'member',
    require_review: true,
    review_by: 'auto',
  })
  const [createLoading, setCreateLoading] = useState(false)
  const [createError, setCreateError] = useState('')

  // 审核方式配置弹窗
  const [reviewMember, setReviewMember] = useState<ScopedMember | null>(null)
  const [reviewForm, setReviewForm] = useState<{
    require_review: boolean
    review_by: 'auto' | 'parent' | 'super_admin'
  }>({
    require_review: true,
    review_by: 'auto',
  })
  const [reviewSaving, setReviewSaving] = useState(false)

  /** 可创建用户的目标组（树形拍平，仅含自己有创建权限的组） */
  const createGroupOptions = useMemo(() => {
    const result: { id: number; label: string; is_direct: boolean }[] = []
    const walk = (group: ScopedMemberGroup, depth: number) => {
      if (group.can_create_user) {
        result.push({
          id: group.id,
          label: `${'　'.repeat(depth)}${depth > 0 ? '└ ' : ''}${group.path}`,
          is_direct: group.is_direct,
        })
      }
      for (const child of groups.filter((item) => item.parent_id === group.id)) walk(child, depth + 1)
    }
    const roots = groups.filter((group) => !groups.some((item) => item.id === group.parent_id))
    roots.forEach((root) => walk(root, 0))
    return result
  }, [groups])

  const createTargetIsDirect = useMemo(
    () => createGroupOptions.find((option) => option.id === createForm.group_id)?.is_direct ?? true,
    [createGroupOptions, createForm.group_id],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await membersApi.scope()
      setGroups(data.groups)
      setIsSuperAdmin(data.is_super_admin)
      setSelectedId((prev) =>
        prev && data.groups.some((group) => group.id === prev) ? prev : (data.groups[0]?.id ?? null),
      )
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // 短链编辑需要组树（用于修改归属组）
  useEffect(() => {
    groupsApi
      .list()
      .then((data) => setGroupTree(data.groups))
      .catch(() => undefined)
  }, [])

  const current = useMemo(() => groups.find((group) => group.id === selectedId) || null, [groups, selectedId])

  const members = useMemo(() => {
    if (!current) return []
    const kw = keyword.trim().toLowerCase()
    if (!kw) return current.members
    return current.members.filter(
      (member) => member.name.toLowerCase().includes(kw) || member.email.toLowerCase().includes(kw),
    )
  }, [current, keyword])

  const loadCandidates = useCallback(async (groupId: number, search: string) => {
    setCandidateLoading(true)
    try {
      const data = await groupsApi.memberCandidates(groupId, search)
      setCandidates(data.users)
    } catch {
      setCandidates([])
    } finally {
      setCandidateLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!addOpen || !current) return
    void loadCandidates(current.id, candidateSearch)
  }, [addOpen, current, candidateSearch, loadCandidates])

  const openAdd = () => {
    setAddError('')
    setAddUserId(0)
    setAddRole('member')
    setCandidateSearch('')
    setAddOpen(true)
  }

  const handleAdd = async () => {
    if (!current) return
    if (!addUserId) {
      setAddError('请选择要添加的用户')
      return
    }
    setAdding(true)
    setAddError('')
    try {
      await groupsApi.addMember(current.id, { user_id: addUserId, role: addRole })
      show('成员已添加', 'success')
      setAddOpen(false)
      void load()
    } catch (err) {
      setAddError((err as Error).message)
    } finally {
      setAdding(false)
    }
  }

  const openCreate = () => {
    const first = createGroupOptions[0]
    setCreateError('')
    setCreateForm({
      name: '',
      email: '',
      password: '',
      group_id: first?.id ?? 0,
      group_role: 'member',
      require_review: true,
      review_by: 'auto',
    })
    setCreateOpen(true)
  }

  const handleCreateUser = async () => {
    if (!createForm.name.trim() || !createForm.email.trim()) {
      setCreateError('请填写姓名和邮箱')
      return
    }
    if (!createForm.group_id) {
      setCreateError('请选择目标项目组')
      return
    }
    if (createForm.password && createForm.password.length < 8) {
      setCreateError('密码长度至少 8 位')
      return
    }
    setCreateLoading(true)
    setCreateError('')
    try {
      await membersApi.createUser({
        name: createForm.name.trim(),
        email: createForm.email.trim(),
        password: createForm.password || undefined,
        group_id: createForm.group_id,
        group_role: createTargetIsDirect ? 'member' : createForm.group_role,
        require_review: createForm.require_review,
        review_by: createForm.review_by,
      })
      show('用户创建成功', 'success')
      setCreateOpen(false)
      void load()
    } catch (err) {
      setCreateError((err as Error).message)
    } finally {
      setCreateLoading(false)
    }
  }

  const openReview = (member: ScopedMember) => {
    setReviewForm({
      require_review: member.require_review,
      review_by: member.review_by || 'auto',
    })
    setReviewMember(member)
  }

  const saveReview = async () => {
    if (!current || !reviewMember) return
    setReviewSaving(true)
    try {
      await membersApi.updateMemberReview(current.id, reviewMember.id, reviewForm)
      show('审核方式已保存', 'success')
      setReviewMember(null)
      void load()
    } catch (err) {
      show((err as Error).message, 'error')
    } finally {
      setReviewSaving(false)
    }
  }

  const toggleRole = async (member: ScopedMember) => {
    if (!current) return
    const nextRole = member.group_role === 'admin' ? 'member' : 'admin'
    try {
      await groupsApi.updateMemberRole(current.id, member.id, nextRole)
      show(nextRole === 'admin' ? '已设为组管理员' : '已取消组管理员', 'success')
      void load()
    } catch (err) {
      show((err as Error).message, 'error')
    }
  }

  const openPermission = (member: ScopedMember) => {
    // 以「生效身份」为基线：父组管理员即使在子组是普通成员，默认也按管理员权限计算
    const defaults = defaultPermissionMap(member.permission_role || member.group_role)
    setPermDefaults(defaults)
    setPermValue({ ...defaults, ...member.permissions_override })
    setPermMember(member)
  }

  const savePermission = async () => {
    if (!current || !permMember) return
    setPermSaving(true)
    try {
      await groupsApi.updateMemberPermissions(
        current.id,
        permMember.id,
        diffFromDefaults(permValue, permMember.permission_role || permMember.group_role),
      )
      show('权限已保存', 'success')
      setPermMember(null)
      void load()
    } catch (err) {
      show((err as Error).message, 'error')
    } finally {
      setPermSaving(false)
    }
  }

  const handleRemove = async () => {
    if (!current || !removing) return
    setRemoveLoading(true)
    try {
      await groupsApi.removeMember(current.id, removing.id)
      show('成员已移出项目组', 'success')
      setRemoving(null)
      void load()
    } catch (err) {
      show((err as Error).message, 'error')
    } finally {
      setRemoveLoading(false)
    }
  }

  const loadMemberLinks = useCallback(async (memberId: number, page: number) => {
    setMemberLinksLoading(true)
    try {
      const data = await linksApi.list({ creatorId: memberId, page, pageSize: memberLinkPageSize })
      setMemberLinks(data.links)
      setMemberLinksTotal(data.total)
      setMemberLinksPage(data.page)
    } catch (err) {
      show((err as Error).message, 'error')
    } finally {
      setMemberLinksLoading(false)
    }
  }, [show])

  const openMemberLinks = (member: ScopedMember) => {
    setLinkMember(member)
    void loadMemberLinks(member.id, 1)
  }

  const handleDeleteLink = async () => {
    if (!deletingLink) return
    setLinkDeleteLoading(true)
    try {
      await linksApi.remove(deletingLink.id)
      show('短链已删除', 'success')
      setDeletingLink(null)
      if (linkMember) void loadMemberLinks(linkMember.id, memberLinksPage)
      void load()
    } catch (err) {
      show((err as Error).message, 'error')
    } finally {
      setLinkDeleteLoading(false)
    }
  }

  const enabledCount = (member: ScopedMember) => {
    const effective = {
      ...defaultPermissionMap(member.permission_role || member.group_role),
      ...member.permissions_override,
    }
    return GROUP_PERMISSION_DEFS.filter((def) => effective[def.key] === true).length
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">成员管理</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {isSuperAdmin
            ? '查看并管理全部项目组的成员：添加 / 移除成员、设置组管理员、逐项配置成员权限'
            : '管理你负责的项目组成员：添加 / 移除成员、设置子组管理员、逐项配置成员权限'}
        </p>
        <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
          同级组管理员之间不能互相调整身份或权限，需要由上级管理员或超级管理员处理
        </p>
      </div>

      {error && <ErrorText>{error}</ErrorText>}

      {loading ? (
        <Card>
          <LoadingBlock />
        </Card>
      ) : groups.length === 0 ? (
        <Card>
          <EmptyState
            title="没有可管理的项目组"
            description="你当前还不是任何项目组的组管理员，请让上级管理员在「项目组 → 成员」中把你设为组管理员"
          />
        </Card>
      ) : (
        <Card>
          <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-3 dark:border-gray-800">
            <div className="flex items-center gap-2">
              <Label htmlFor="member-group" className="sr-only">
                项目组
              </Label>
              <Select
                id="member-group"
                className="h-10 w-64"
                value={selectedId ?? 0}
                onChange={(e) => {
                  setSelectedId(Number(e.target.value))
                  setKeyword('')
                }}
              >
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.path}（{group.member_count} 人）
                  </option>
                ))}
              </Select>
              {current && current.can_set_role && <Badge tone="blue">可管理身份</Badge>}
            </div>
            <div className="relative ml-auto w-full max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                className="pl-9"
                placeholder="搜索成员姓名或邮箱"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              />
            </div>
            {createGroupOptions.length > 0 && (
              <Button size="sm" variant="outline" onClick={openCreate}>
                <UserRoundPlus className="h-4 w-4" />
                创建用户
              </Button>
            )}
            {current?.can_set_role && (
              <Button size="sm" onClick={openAdd}>
                <UserPlus className="h-4 w-4" />
                添加成员
              </Button>
            )}
          </div>

          {members.length === 0 ? (
            <EmptyState
              title="暂无成员"
              description={keyword ? '没有匹配的成员，试试其他关键词' : current?.can_set_role ? '点击「添加成员」把用户加入该组' : '该组还没有成员'}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">成员</th>
                    <th className="px-4 py-3 font-medium">组内身份</th>
                    <th className="px-4 py-3 font-medium">状态</th>
                    <th className="px-4 py-3 font-medium">已开权限</th>
                    <th className="hidden px-4 py-3 font-medium xl:table-cell">加入时间</th>
                    <th className="px-4 py-3 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {members.map((member) => (
                    <tr key={member.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900 dark:text-gray-100">
                          {member.name}
                          {member.is_self && <span className="ml-1.5 text-[11px] text-gray-400">（我）</span>}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{member.email}</p>
                        {member.link_count > 0 && (
                          <p className="mt-0.5 text-[11px] text-gray-400">{member.link_count} 条短链</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge tone={member.group_role === 'admin' ? 'purple' : 'gray'}>
                            {member.group_role === 'admin' ? '组管理员' : '成员'}
                          </Badge>
                          {member.role === 'super_admin' && <Badge tone="blue">超级管理员</Badge>}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1">
                          <StatusBadge status={member.status === 'active' ? 'active' : 'disabled'} />
                          {member.require_review ? (
                            <Badge tone="yellow">
                              {member.review_by === 'parent'
                                ? '父组审核'
                                : member.review_by === 'super_admin'
                                  ? '超管审核'
                                  : '组内审核'}
                            </Badge>
                          ) : (
                            <Badge tone="gray">免审核</Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                        {enabledCount(member)} / {GROUP_PERMISSION_DEFS.length} 项
                      </td>
                      <td className="hidden px-4 py-3 text-xs text-gray-500 dark:text-gray-400 xl:table-cell">
                        {formatDateTime(member.joined_at)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openReview(member)}
                            disabled={!member.can_config_review}
                            className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-brand-600 disabled:opacity-30 dark:hover:bg-gray-800"
                            title={
                              member.can_config_review
                                ? '设置短链审核方式（子组管理员 / 父组管理员 / 超管）'
                                : '不能调整该成员的审核方式'
                            }
                          >
                            <FileCheck2 className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => openMemberLinks(member)}
                            className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-brand-600 dark:hover:bg-gray-800"
                            title="查看并管理该成员的短链"
                          >
                            <Link2 className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => openPermission(member)}
                            disabled={!member.can_edit_permission}
                            className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-brand-600 disabled:opacity-30 dark:hover:bg-gray-800"
                            title={member.can_edit_permission ? '配置组内权限' : '同级管理员 / 自身权限需由上级或本人之外的管理员调整'}
                          >
                            <ShieldCheck className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => void toggleRole(member)}
                            disabled={!member.can_edit_role}
                            className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 dark:hover:bg-gray-800"
                            title={
                              member.can_edit_role
                                ? member.group_role === 'admin'
                                  ? '取消组管理员'
                                  : '设为组管理员'
                                : '同级管理员 / 自身的身份需由上级管理员调整'
                            }
                          >
                            <UserPlus className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setRemoving(member)}
                            disabled={!member.can_remove}
                            className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30 dark:hover:bg-red-900/20"
                            title={member.can_remove ? '移出项目组' : '不能移出该成员'}
                          >
                            <UserMinus className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* 权限配置 */}
      <Modal
        open={!!permMember}
        onClose={() => setPermMember(null)}
        title={`配置组内权限 · ${permMember?.name || ''}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setPermMember(null)}>
              取消
            </Button>
            <Button onClick={savePermission} loading={permSaving}>
              保存
            </Button>
          </>
        }
      >
        {permMember && (
          <div className="space-y-4">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              项目组：{current?.path} · 身份：
              {permMember.group_role === 'admin' ? '组管理员' : '成员'}
            </p>
            <PermissionEditor
              defs={GROUP_PERMISSION_DEFS}
              value={permValue}
              onChange={setPermValue}
              defaults={permDefaults}
              description="与身份默认权限相同的项不会被单独保存；关闭即不生效"
            />
          </div>
        )}
      </Modal>

      {/* 移除确认 */}
      <Modal
        open={!!removing}
        onClose={() => setRemoving(null)}
        title="移出项目组"
        footer={
          <>
            <Button variant="outline" onClick={() => setRemoving(null)}>
              取消
            </Button>
            <Button variant="danger" onClick={handleRemove} loading={removeLoading}>
              确认移出
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-700 dark:text-gray-300">
          确定把「{removing?.name}」（{removing?.email}）移出项目组「{current?.path}」吗？
        </p>
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">
          移出后该成员将失去该组及其子组的访问权限，其短链仍保留在原组中。
        </p>
      </Modal>

      {/* 添加成员 */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title={`添加成员 · ${current?.path || ''}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              取消
            </Button>
            <Button onClick={handleAdd} loading={adding}>
              添加
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {addError && <ErrorText>{addError}</ErrorText>}
          <div>
            <Label htmlFor="candidate-search">搜索用户</Label>
            <Input
              id="candidate-search"
              placeholder={isSuperAdmin ? '输入姓名或邮箱搜索不在该组的用户' : '输入对方完整邮箱精确查找'}
              value={candidateSearch}
              onChange={(e) => setCandidateSearch(e.target.value)}
            />
          </div>
          <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-800">
            {candidateLoading ? (
              <div className="flex items-center justify-center py-6 text-gray-400">
                <Spinner className="h-4 w-4" />
              </div>
            ) : candidates.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-gray-400">没有可添加的用户</p>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {candidates.map((candidate) => (
                  <li key={candidate.id}>
                    <button
                      type="button"
                      onClick={() => setAddUserId(candidate.id)}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-800/60 ${
                        addUserId === candidate.id ? 'bg-brand-50 dark:bg-brand-900/20' : ''
                      }`}
                    >
                      <span>
                        <span className="font-medium text-gray-900 dark:text-gray-100">{candidate.name}</span>
                        <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">{candidate.email}</span>
                      </span>
                      {addUserId === candidate.id && <Badge tone="blue">已选择</Badge>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <Label htmlFor="candidate-role">组内身份</Label>
            <Select
              id="candidate-role"
              value={current?.is_direct ? 'member' : addRole}
              disabled={current?.is_direct}
              onChange={(e) => setAddRole(e.target.value as 'admin' | 'member')}
            >
              <option value="member">成员</option>
              <option value="admin">组管理员</option>
            </Select>
            {current?.is_direct && (
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                同级组内只能添加普通成员，组管理员请在子组内设置
              </p>
            )}
          </div>
        </div>
      </Modal>

      {/* 创建用户 */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="创建用户"
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreateUser} loading={createLoading}>
              创建
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {createError && <ErrorText>{createError}</ErrorText>}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="c-name">姓名</Label>
              <Input
                id="c-name"
                value={createForm.name}
                onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                placeholder="用户姓名"
              />
            </div>
            <div>
              <Label htmlFor="c-email">邮箱</Label>
              <Input
                id="c-email"
                type="email"
                value={createForm.email}
                onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                placeholder="name@example.com"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="c-password">初始密码（可选）</Label>
            <Input
              id="c-password"
              type="password"
              value={createForm.password}
              onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
              placeholder="至少 8 位；留空则用户通过邮箱验证码自行设置"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="c-group">目标项目组</Label>
              <Select
                id="c-group"
                value={createForm.group_id}
                onChange={(e) =>
                  setCreateForm({ ...createForm, group_id: Number(e.target.value), group_role: 'member' })
                }
              >
                {createGroupOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                同级组只能创建普通成员，组管理员请在子组内设置
              </p>
            </div>
            <div>
              <Label htmlFor="c-group-role">组内身份</Label>
              <Select
                id="c-group-role"
                value={createTargetIsDirect ? 'member' : createForm.group_role}
                disabled={createTargetIsDirect}
                onChange={(e) =>
                  setCreateForm({ ...createForm, group_role: e.target.value as 'admin' | 'member' })
                }
              >
                <option value="member">普通成员</option>
                <option value="admin">组管理员（仅子组）</option>
              </Select>
            </div>
          </div>
          <label className="flex items-start gap-2.5 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
              checked={createForm.require_review}
              onChange={(e) => setCreateForm({ ...createForm, require_review: e.target.checked })}
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              该用户创建的短链需要审核（默认开启）
              <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                未配置审核人时，系统会从所属组向上寻找有审核权限的管理员，最终由超级管理员审核
              </span>
            </span>
          </label>
          {createForm.require_review && (
            <div>
              <Label htmlFor="c-review-by">审核方式</Label>
              <Select
                id="c-review-by"
                value={createForm.review_by}
                onChange={(e) =>
                  setCreateForm({
                    ...createForm,
                    review_by: e.target.value as 'auto' | 'parent' | 'super_admin',
                  })
                }
              >
                <option value="auto">自动：子组管理员优先，无管理员则逐级向上</option>
                <option value="parent">父组管理员：跳过本组，由上级管理员审核</option>
                <option value="super_admin">超级管理员</option>
              </Select>
            </div>
          )}
        </div>
      </Modal>

      {/* 审核方式配置 */}
      <Modal
        open={!!reviewMember}
        onClose={() => setReviewMember(null)}
        title={`审核方式 · ${reviewMember?.name || ''}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setReviewMember(null)}>
              取消
            </Button>
            <Button onClick={saveReview} loading={reviewSaving}>
              保存
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            项目组：{current?.path} · 该配置对该用户创建的所有短链生效
          </p>
          <label className="flex items-start gap-2.5 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
              checked={reviewForm.require_review}
              onChange={(e) => setReviewForm({ ...reviewForm, require_review: e.target.checked })}
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              该用户创建的短链需要审核
              <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                关闭后该用户新建的短链直接生效，不再进入待审核
              </span>
            </span>
          </label>
          {reviewForm.require_review && (
            <div>
              <Label htmlFor="m-review-by">审核人</Label>
              <Select
                id="m-review-by"
                value={reviewForm.review_by}
                onChange={(e) =>
                  setReviewForm({
                    ...reviewForm,
                    review_by: e.target.value as 'auto' | 'parent' | 'super_admin',
                  })
                }
              >
                <option value="auto">子组管理员：最近的有审核权限管理员</option>
                <option value="parent">父组管理员：跳过本组，由上级管理员审核</option>
                <option value="super_admin">超级管理员</option>
              </Select>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                若配置范围内没有具备审核权限的管理员（例如子组暂无管理员），会自动继续向更上层寻找，最终由超级管理员兜底
              </p>
            </div>
          )}
        </div>
      </Modal>

      {/* 成员短链 */}
      <Modal
        open={!!linkMember}
        onClose={() => setLinkMember(null)}
        title={`短链管理 · ${linkMember?.name || ''}`}
        wide
      >
        <div className="space-y-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {linkMember?.email} · 共 {memberLinksTotal} 条短链（可修改归属项目组、目标链接、状态；删除不可恢复）
          </p>
          {memberLinksLoading ? (
            <div className="flex items-center justify-center py-8 text-gray-400">
              <Spinner className="h-5 w-5" />
            </div>
          ) : memberLinks.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">该成员暂无短链</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
              <table className="w-full min-w-[680px] text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">短链</th>
                    <th className="px-3 py-2 font-medium">目标链接</th>
                    <th className="px-3 py-2 font-medium">归属组</th>
                    <th className="px-3 py-2 font-medium">状态</th>
                    <th className="px-3 py-2 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {memberLinks.map((link) => (
                    <tr key={link.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                      <td className="px-3 py-2">
                        <p className="font-medium text-brand-600 dark:text-brand-400">
                          {link.domain_name ? `${link.domain_name}/${link.short_code}` : `/${link.short_code}`}
                        </p>
                        <p className="truncate text-xs text-gray-500 dark:text-gray-400">{link.name || '（未命名）'}</p>
                      </td>
                      <td className="max-w-[180px] px-3 py-2">
                        <span className="block truncate text-xs text-gray-600 dark:text-gray-400" title={link.target_url}>
                          {link.target_url}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
                        {link.group_name || '个人'}
                      </td>
                      <td className="px-3 py-2">
                        {link.review_status === 'pending' ? (
                          <Badge tone="yellow">待审核</Badge>
                        ) : link.review_status === 'rejected' ? (
                          <Badge tone="red">已驳回</Badge>
                        ) : link.status === 'active' ? (
                          <Badge tone="green">正常</Badge>
                        ) : link.status === 'expired' ? (
                          <Badge tone="gray">已过期</Badge>
                        ) : (
                          <Badge tone="gray">已停用</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() =>
                              window.open(
                                link.domain_name
                                  ? `https://${link.domain_name}/${link.short_code}`
                                  : `${window.location.origin}/${link.short_code}`,
                                '_blank',
                                'noopener',
                              )
                            }
                            className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-brand-600 dark:hover:bg-gray-800"
                            title="打开短链"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setEditingLink(link)}
                            className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800"
                            title="编辑短链"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setDeletingLink(link)}
                            className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                            title="删除短链"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {memberLinksTotal > memberLinkPageSize && (
            <div className="flex items-center justify-end gap-2 text-xs text-gray-500 dark:text-gray-400">
              <Button
                variant="outline"
                size="sm"
                disabled={memberLinksPage <= 1 || memberLinksLoading}
                onClick={() => linkMember && void loadMemberLinks(linkMember.id, memberLinksPage - 1)}
              >
                上一页
              </Button>
              <span>
                {memberLinksPage} / {Math.ceil(memberLinksTotal / memberLinkPageSize)}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={memberLinksPage >= Math.ceil(memberLinksTotal / memberLinkPageSize) || memberLinksLoading}
                onClick={() => linkMember && void loadMemberLinks(linkMember.id, memberLinksPage + 1)}
              >
                下一页
              </Button>
            </div>
          )}
        </div>
      </Modal>

      {/* 短链编辑（可调整归属组，即「组长」） */}
      <EditLinkModal
        link={editingLink}
        groups={groupTree}
        onClose={() => setEditingLink(null)}
        onSaved={() => {
          if (linkMember) void loadMemberLinks(linkMember.id, memberLinksPage)
        }}
      />

      {/* 删除短链确认 */}
      <Modal
        open={!!deletingLink}
        onClose={() => setDeletingLink(null)}
        title="删除短链"
        footer={
          <>
            <Button variant="outline" onClick={() => setDeletingLink(null)}>
              取消
            </Button>
            <Button variant="danger" onClick={handleDeleteLink} loading={linkDeleteLoading}>
              确认删除
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-700 dark:text-gray-300">
          确定删除短链「
          {deletingLink?.domain_name
            ? `${deletingLink.domain_name}/${deletingLink.short_code}`
            : `/${deletingLink?.short_code}`}
          」吗？
        </p>
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">
          删除后短链立即失效，访问数据将一并清除，操作不可恢复。
        </p>
      </Modal>
    </div>
  )
}
