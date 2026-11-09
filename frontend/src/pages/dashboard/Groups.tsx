import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, FolderPlus, Globe, Link2, Plus, Trash2, UserPlus, X } from 'lucide-react'
import { domainsApi, groupsApi, usersApi } from '@/lib/api'
import type { Domain, GroupDetail, ProjectGroup, UserItem } from '@/lib/types'
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
import { useToast } from '@/components/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { formatDateTime, ROLE_LABELS } from '@/lib/utils'

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
  const [allDomains, setAllDomains] = useState<Domain[]>([])

  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState({ name: '', description: '', parent_id: '' })
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  // 删除确认
  const [deletingGroupId, setDeletingGroupId] = useState<number | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  // 移除成员确认
  const [removingMember, setRemovingMember] = useState<{ id: number; name: string } | null>(null)
  const [removeLoading, setRemoveLoading] = useState(false)

  const [memberOpen, setMemberOpen] = useState(false)
  const [memberForm, setMemberForm] = useState({ user_id: '', role: 'member' as 'member' | 'admin' })
  const [addingMember, setAddingMember] = useState(false)

  const [domainOpen, setDomainOpen] = useState(false)
  const [domainId, setDomainId] = useState('')
  const [bindingDomain, setBindingDomain] = useState(false)

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

  // 用户列表与域名列表仅超级管理员可获取
  useEffect(() => {
    if (!isSuperAdmin) return
    usersApi
      .list({ pageSize: 200 })
      .then((data) => setAllUsers(data.users))
      .catch(() => setAllUsers([]))
    domainsApi
      .list()
      .then((data) => setAllDomains(data.domains))
      .catch(() => setAllDomains([]))
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

  const handleDeleteGroup = async () => {
    if (!deletingGroupId) return
    setDeleteLoading(true)
    try {
      await groupsApi.remove(deletingGroupId)
      show('项目组已删除', 'success')
      setDetail(null)
      if (selectedId === deletingGroupId) setSelectedId(null)
      setDeletingGroupId(null)
      await loadGroups()
    } catch (err) {
      show((err as Error).message, 'error')
    } finally {
      setDeleteLoading(false)
    }
  }

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedId || !memberForm.user_id) {
      show('请选择用户', 'error')
      return
    }
    setAddingMember(true)
    try {
      await groupsApi.addMember(selectedId, {
        user_id: Number(memberForm.user_id),
        role: memberForm.role,
      })
      show('成员已添加', 'success')
      setMemberOpen(false)
      setMemberForm({ user_id: '', role: 'member' })
      await loadDetail(selectedId)
      await loadGroups()
    } catch (err) {
      show((err as Error).message, 'error')
    } finally {
      setAddingMember(false)
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

  // 是否有管理该组的权限（超管或该项目组管理员）
  const canManageSelected = !!detail?.can_manage
  const canManageMembers = canManageSelected

  const boundDomainIds = new Set((detail?.domains || []).map((d) => d.id))
  const availableDomains = allDomains.filter(
    (d) => !boundDomainIds.has(d.id) && (d.type === 'short_link' || d.type === 'both'),
  )

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
          <Button
            size="sm"
            onClick={() => {
              setCreateOpen(true)
              setCreateError('')
            }}
          >
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
                      {/* 添加成员仅超级管理员可用 */}
                      {isSuperAdmin && (
                        <Button variant="outline" size="sm" onClick={() => setMemberOpen(true)}>
                          <UserPlus className="h-4 w-4" />
                          添加成员
                        </Button>
                      )}
                      {/* 绑定域名仅超级管理员可用 */}
                      {isSuperAdmin && (
                        <Button variant="outline" size="sm" onClick={() => setDomainOpen(true)}>
                          <Globe className="h-4 w-4" />
                          绑定域名
                        </Button>
                      )}
                      {isSuperAdmin && (
                        <Button variant="danger" size="sm" onClick={() => setDeletingGroupId(detail.group.id)}>
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
                    <table className="w-full min-w-[560px] text-sm">
                      <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">
                        <tr>
                          <th className="px-5 py-2.5 font-medium">短链 / 名称</th>
                          <th className="px-4 py-2.5 font-medium">目标链接</th>
                          <th className="px-4 py-2.5 font-medium">创建人</th>
                          <th className="px-4 py-2.5 font-medium">状态</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {detail.links.map((l) => (
                          <tr key={l.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                            <td className="px-5 py-3">
                              <p className="font-medium text-brand-600 dark:text-brand-400">
                                {l.domain_name ? `${l.domain_name}/${l.short_code}` : `/${l.short_code}`}
                              </p>
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
                      // 组管理员不能移除其他管理员；超级管理员可以
                      const canRemove = canManageMembers && !isSelf && (isSuperAdmin || m.group_role !== 'admin')
                      return (
                        <li key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                              {m.name} <span className="text-xs font-normal text-gray-400">{m.email}</span>
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              {ROLE_LABELS[m.role] || m.role}
                            </p>
                          </div>
                          <Badge tone={m.group_role === 'admin' ? 'purple' : 'gray'}>
                            {m.group_role === 'admin' ? '组管理员' : '成员'}
                          </Badge>
                          <StatusBadge status={m.status} />
                          {canRemove && (
                            <button
                              onClick={() => setRemovingMember({ id: m.id, name: m.name })}
                              className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                              title="移除成员"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          )}
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
                      : '项目组内创建短链时可使用的域名（仅超级管理员可修改）'
                  }
                  action={
                    isSuperAdmin ? (
                      <Button variant="outline" size="sm" onClick={() => setDomainOpen(true)}>
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
                        : '该项目组暂未绑定域名，请联系超级管理员绑定'
                    }
                  />
                ) : (
                  <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                    {detail.domains.map((d) => (
                      <li key={d.id} className="flex items-center gap-3 px-5 py-3">
                        <Globe className="h-4 w-4 text-gray-400" />
                        <span className="flex-1 text-sm text-gray-900 dark:text-gray-100">{d.domain}</span>
                        <StatusBadge status={d.status} />
                        {isSuperAdmin && (
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
                    description={isSuperAdmin ? '新建项目组时选择父组即可创建子组' : '暂无子项目组'}
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

      {/* 新建项目组（仅超管） */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="新建项目组"
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

      {/* 添加成员（仅超管） */}
      <Modal
        open={memberOpen}
        onClose={() => setMemberOpen(false)}
        title="添加成员"
        footer={
          <>
            <Button variant="outline" onClick={() => setMemberOpen(false)}>
              取消
            </Button>
            <Button onClick={handleAddMember} loading={addingMember}>
              添加
            </Button>
          </>
        }
      >
        <form onSubmit={handleAddMember} className="space-y-4">
          <div>
            <Label htmlFor="m-user">选择用户</Label>
            <Select
              id="m-user"
              value={memberForm.user_id}
              onChange={(e) => setMemberForm({ ...memberForm, user_id: e.target.value })}
            >
              <option value="">请选择用户</option>
              {allUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}（{u.email}）
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="m-role">组内角色</Label>
            <Select
              id="m-role"
              value={memberForm.role}
              onChange={(e) => setMemberForm({ ...memberForm, role: e.target.value as 'member' | 'admin' })}
            >
              <option value="member">成员（可查看组内短链）</option>
              <option value="admin">组管理员（可审核短链、管理组内成员）</option>
            </Select>
          </div>
        </form>
      </Modal>

      {/* 绑定域名（仅超管） */}
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
            <Select id="d-select" value={domainId} onChange={(e) => setDomainId(e.target.value)}>
              <option value="">请选择域名</option>
              {availableDomains.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.domain}
                  {d.status !== 'active' ? '（未激活）' : ''}
                </option>
              ))}
            </Select>
            {availableDomains.length === 0 && (
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                暂无可用域名，请先在「域名管理」中添加并验证域名
              </p>
            )}
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={deletingGroupId !== null}
        title="删除项目组"
        description="确定删除该项目组吗？组内短链将解除归属，操作不可恢复。"
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
