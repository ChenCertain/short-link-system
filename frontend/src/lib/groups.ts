// 项目组层级工具：把扁平/树状的项目组数据转换成「父组 / 子组」路径

export interface FlatGroup {
  id: number
  name: string
  parent_id: number | null
}

/** 项目组树节点（兼容 groupsApi.list 返回的 ProjectGroup 结构） */
export interface TreeGroup {
  id: number
  name: string
  children?: TreeGroup[]
}

/**
 * 项目组树 → 带缩进的下拉选项（父组排在子组之前）。
 * indent：每层缩进字符；arrow：子组前是否加「└ 」标记。
 */
export function flattenGroupTree(
  groups: TreeGroup[],
  opts: { indent?: string; arrow?: boolean } = {},
): { id: number; label: string }[] {
  const indent = opts.indent ?? '　'
  const result: { id: number; label: string }[] = []
  const walk = (list: TreeGroup[], depth: number) => {
    for (const g of list) {
      result.push({
        id: g.id,
        label: `${indent.repeat(depth)}${opts.arrow && depth > 0 ? '└ ' : ''}${g.name}`,
      })
      if (g.children?.length) walk(g.children, depth + 1)
    }
  }
  walk(groups, 0)
  return result
}

/** 构建 id → 完整路径（父组 / 子组）的映射 */
export function buildGroupPaths(groups: FlatGroup[]): Map<number, string> {
  const byId = new Map(groups.map((group) => [group.id, group]))
  const cache = new Map<number, string>()

  const resolve = (id: number, guard = 0): string => {
    const cachedValue = cache.get(id)
    if (cachedValue) return cachedValue
    const group = byId.get(id)
    if (!group || guard > 10) return ''
    const path = group.parent_id ? [resolve(group.parent_id, guard + 1), group.name].filter(Boolean).join(' / ') : group.name
    cache.set(id, path)
    return path
  }

  for (const group of groups) resolve(group.id)
  return cache
}

/** 扁平项目组列表 → 带缩进的下拉选项，父组排在子组之前 */
export function groupSelectOptions(groups: FlatGroup[]): { id: number; label: string; depth: number }[] {
  const children = new Map<number | null, FlatGroup[]>()
  for (const group of groups) {
    const key = group.parent_id ?? null
    const list = children.get(key) || []
    list.push(group)
    children.set(key, list)
  }

  const result: { id: number; label: string; depth: number }[] = []
  const walk = (parentId: number | null, depth: number, guard: number) => {
    if (guard > 10) return
    const list = (children.get(parentId) || []).slice().sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    for (const group of list) {
      result.push({ id: group.id, label: group.name, depth })
      walk(group.id, depth + 1, guard + 1)
    }
  }
  walk(null, 0, 0)

  // 兜底：上级不在可见范围内的组，作为根节点展示
  if (result.length < groups.length) {
    const seen = new Set(result.map((item) => item.id))
    for (const group of groups) {
      if (!seen.has(group.id)) result.push({ id: group.id, label: group.name, depth: 0 })
    }
  }
  return result
}
