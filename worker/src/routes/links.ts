// 短链管理路由

import { Hono } from 'hono';
import type { Env, JWTPayload } from '../types';
import {
  jsonResponse,
  generateShortCode,
  hashPassword,
  validateAlias,
  isSafeHttpUrl,
  parseIntClamped,
} from '../utils';
import { authMiddleware, requireRole, logAudit } from '../middleware';
import { invalidateLinkCache } from '../cache';
import {
  getManagedGroupIds,
  getVisibleGroupIds,
  expandGroupIdsWithDescendants,
  isGroupMember,
  isGroupAdminOf,
  isGroupVisibleToUser,
  resolveReviewGroupId,
  getGroupReviewerEmails,
  getSuperAdminEmails,
  hasGroupPermission,
  filterGroupsWithPermission,
} from '../permissions';

const links = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();

// 返回给前端的短链字段：显式列出，避免 SELECT * 把 password 哈希带到接口响应里
const LINK_PUBLIC_COLUMNS = `sl.id, sl.short_code, sl.target_url, sl.name, sl.custom_alias, sl.status,
  sl.redirect_type, sl.created_by, sl.group_id, sl.domain_id, sl.expires_at, sl.click_count,
  sl.review_status, sl.review_note, sl.reviewed_by, sl.reviewed_at, sl.review_group_id,
  sl.created_at, sl.updated_at,
  CASE WHEN sl.password IS NOT NULL AND sl.password <> '' THEN 1 ELSE 0 END AS has_password`;

/** 读取系统设置中的默认跳转类型（缺失或非法时回退 302） */
async function getDefaultRedirectType(db: D1Database): Promise<number> {
  try {
    const row = await db
      .prepare("SELECT value FROM system_config WHERE key = 'default_redirect_type'")
      .first<{ value: string }>();
    return row?.value === '301' ? 301 : 302;
  } catch {
    return 302;
  }
}

// ========== 获取短链列表 ==========
links.get('/', authMiddleware, async (c) => {
  const currentUser = c.get('user');
  const page = parseIntClamped(c.req.query('page'), 1, 1, 1_000_000);
  const pageSize = parseIntClamped(c.req.query('pageSize'), 20, 1, 100);
  const search = c.req.query('search') || '';
  const status = c.req.query('status') || '';
  const groupId = c.req.query('groupId');
  const domainId = c.req.query('domainId');
  const creatorId = c.req.query('creatorId');
  const offset = (page - 1) * pageSize;

  // 列表与计数共用同一套 JOIN，保证关键词可以命中创建人、域名
  const fromClause = `
    FROM short_links sl
    LEFT JOIN domains d ON sl.domain_id = d.id
    LEFT JOIN users u ON sl.created_by = u.id
    LEFT JOIN project_groups pg ON sl.group_id = pg.id
  `;
  let query = `
    SELECT ${LINK_PUBLIC_COLUMNS}, d.domain as domain_name, u.name as creator_name, u.email as creator_email,
      pg.name as group_name
    ${fromClause}
  `;
  let countQuery = `SELECT COUNT(*) as total ${fromClause}`;
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  // 记录当前用户可见的项目组（含子组），用于列表过滤
  let visibleGroupIds: number[] = [];

  const isSuperAdmin = currentUser.role === 'super_admin';
  let managedIds: number[] = [];
  if (!isSuperAdmin) {
    // 普通用户 / 项目组管理员：自己创建的 + 具备「查看组内短链」权限的可见组（所在组及子组、管理组及子组）的
    managedIds = await expandManagedGroupIds(c.env.DB, currentUser.user_id);
    const allVisibleGroupIds = await getVisibleGroupIds(c.env.DB, currentUser.user_id);
    // 关闭「查看组内短链」后，组内他人短链不再出现在列表中
    visibleGroupIds = await filterGroupsWithPermission(
      c.env.DB,
      currentUser.user_id,
      allVisibleGroupIds,
      'link.view.group',
    );
    const groupPlaceholders = visibleGroupIds.length > 0
      ? ` OR sl.group_id IN (${visibleGroupIds.map(() => '?').join(',')})`
      : '';
    conditions.push(`(sl.created_by = ?${groupPlaceholders})`);
    params.push(currentUser.user_id, ...visibleGroupIds);
  }
  // super_admin 无额外条件

  if (search) {
    // 关键词模糊匹配：短码、别名、名称、目标链接、创建人（姓名/邮箱）、域名
    const like = `%${search}%`;
    conditions.push(
      `(sl.short_code LIKE ? OR sl.custom_alias LIKE ? OR sl.name LIKE ? OR sl.target_url LIKE ?
        OR u.name LIKE ? OR u.email LIKE ? OR d.domain LIKE ?)`,
    );
    params.push(like, like, like, like, like, like, like);
  }

  if (status) {
    conditions.push('sl.status = ?');
    params.push(status);
  }

  if (groupId) {
    const selected = parseInt(groupId);
    if (Number.isFinite(selected)) {
      // 选择父组时，连同其所有子组的短链一并展示
      const selfAndChildren = await expandGroupIdsWithDescendants(c.env.DB, [selected]);
      // 非超管只保留自己可见 / 可管理的组，避免越权探测
      const allowed = isSuperAdmin
        ? selfAndChildren
        : selfAndChildren.filter((id) => visibleGroupIds.includes(id) || managedIds.includes(id));
      if (allowed.length === 0) {
        return jsonResponse({ links: [], total: 0, page, pageSize });
      }
      conditions.push(`sl.group_id IN (${allowed.map(() => '?').join(',')})`);
      params.push(...allowed);
    }
  }

  if (domainId) {
    const parsedDomainId = Number.parseInt(domainId, 10);
    if (Number.isFinite(parsedDomainId)) {
      conditions.push('sl.domain_id = ?');
      params.push(parsedDomainId);
    }
  }

  if (creatorId) {
    const parsedCreatorId = Number.parseInt(creatorId, 10);
    if (Number.isFinite(parsedCreatorId)) {
      conditions.push('sl.created_by = ?');
      params.push(parsedCreatorId);
    }
  }

  // 自动标记过期
  await c.env.DB.prepare(
    "UPDATE short_links SET status = 'expired' WHERE expires_at IS NOT NULL AND expires_at < ? AND status = 'active'"
  ).bind(Math.floor(Date.now() / 1000)).run();

  const whereClause = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';
  query += whereClause + ' ORDER BY sl.created_at DESC LIMIT ? OFFSET ?';
  countQuery += whereClause;

  const list = await c.env.DB.prepare(query).bind(...params, pageSize, offset).all();
  const countResult = await c.env.DB.prepare(countQuery).bind(...params).first<{ total: number }>();

  // 标记当前用户是否有权修改/删除该短链，前端据此决定操作按钮是否展示
  const rows = list.results.map((row) => {
    const item = row as { created_by: number; group_id: number | null };
    const canManage = isSuperAdmin
      || item.created_by === currentUser.user_id
      || (item.group_id !== null && managedIds.includes(item.group_id));
    return { ...row, can_manage: canManage };
  });

  return jsonResponse({
    links: rows,
    total: countResult?.total || 0,
    page,
    pageSize,
  });
});

// ========== 列表筛选项（按当前用户权限范围返回） ==========
links.get('/filter-options', authMiddleware, async (c) => {
  const currentUser = c.get('user');
  const isSuperAdmin = currentUser.role === 'super_admin';

  const visibleGroupIds = isSuperAdmin ? [] : await getVisibleGroupIds(c.env.DB, currentUser.user_id);
  // 「查看组内短链」被关闭的组，其组内他人短链不参与筛选统计，避免泄露创建人信息
  const readableGroupIds = isSuperAdmin
    ? []
    : await filterGroupsWithPermission(c.env.DB, currentUser.user_id, visibleGroupIds, 'link.view.group');
  const groupPlaceholders = visibleGroupIds.map(() => '?').join(',');
  const readablePlaceholders = readableGroupIds.map(() => '?').join(',');

  // 项目组
  const groups = isSuperAdmin
    ? await c.env.DB.prepare('SELECT id, name, parent_id FROM project_groups ORDER BY COALESCE(parent_id, 0), name')
        .all<{ id: number; name: string; parent_id: number | null }>()
    : visibleGroupIds.length > 0
      ? await c.env.DB.prepare(
          `SELECT id, name, parent_id FROM project_groups WHERE id IN (${groupPlaceholders})
           ORDER BY COALESCE(parent_id, 0), name`
        ).bind(...visibleGroupIds).all<{ id: number; name: string; parent_id: number | null }>()
      : { results: [] as { id: number; name: string; parent_id: number | null }[] };

  // 域名：超管看全部可用短链域名，普通用户只看所在组绑定的域名
  const domains = isSuperAdmin
    ? await c.env.DB.prepare(
        `SELECT DISTINCT d.id, d.domain FROM domains d
         WHERE d.type IN ('short_link', 'both') AND d.status = 'active'
         ORDER BY d.domain`
      ).all<{ id: number; domain: string }>()
    : visibleGroupIds.length > 0
      ? await c.env.DB.prepare(
          `SELECT DISTINCT d.id, d.domain FROM domains d
           JOIN group_domain_relations gdr ON gdr.domain_id = d.id
           WHERE gdr.group_id IN (${groupPlaceholders})
             AND d.type IN ('short_link', 'both') AND d.status = 'active'
           ORDER BY d.domain`
        ).bind(...visibleGroupIds).all<{ id: number; domain: string }>()
      : { results: [] as { id: number; domain: string }[] };

  // 创建人：仅统计当前用户可见范围内的短链创建者
  const creators = isSuperAdmin
    ? await c.env.DB.prepare(
        `SELECT DISTINCT u.id, u.name, u.email FROM short_links sl
         JOIN users u ON u.id = sl.created_by
         ORDER BY u.name LIMIT 500`
      ).all<{ id: number; name: string; email: string }>()
    : await c.env.DB.prepare(
        `SELECT DISTINCT u.id, u.name, u.email FROM short_links sl
         JOIN users u ON u.id = sl.created_by
         WHERE sl.created_by = ?
           ${readableGroupIds.length > 0 ? `OR sl.group_id IN (${readablePlaceholders})` : ''}
         ORDER BY u.name LIMIT 500`
         ).bind(currentUser.user_id, ...readableGroupIds).all<{ id: number; name: string; email: string }>();

  return jsonResponse({
    groups: groups.results,
    domains: domains.results,
    creators: creators.results,
  });
});

// ========== 待审核短链列表（管理员） ==========
// 注意：必须注册在 /:id 之前，避免被详情路由吞掉
links.get('/pending-reviews', authMiddleware, async (c) => {
  const currentUser = c.get('user');

  let sql = `
    SELECT ${LINK_PUBLIC_COLUMNS}, d.domain as domain_name, u.name as creator_name, u.email as creator_email,
      pg.name as group_name, rg.name as review_group_name
    FROM short_links sl
    LEFT JOIN domains d ON sl.domain_id = d.id
    LEFT JOIN users u ON sl.created_by = u.id
    LEFT JOIN project_groups pg ON sl.group_id = pg.id
    LEFT JOIN project_groups rg ON sl.review_group_id = rg.id
    WHERE sl.review_status = 'pending'
  `;
  const params: (string | number)[] = [];

  if (currentUser.role !== 'super_admin') {
    // 可见范围：自己管理的组（含子组）+ 自己所在的组，再按「审核组内短链」权限过滤
    const managedIds = await expandManagedGroupIds(c.env.DB, currentUser.user_id);
    const relations = await c.env.DB.prepare(
      'SELECT group_id FROM user_group_relations WHERE user_id = ?'
    ).bind(currentUser.user_id).all<{ group_id: number }>();
    const candidates = [...new Set([...managedIds, ...relations.results.map((r) => r.group_id)])];

    // 一次性算出具备「审核组内短链」权限的组（避免逐组串行查询）
    const reviewIds = await filterGroupsWithPermission(
      c.env.DB,
      currentUser.user_id,
      candidates,
      'link.review',
    );
    if (reviewIds.length === 0) {
      return jsonResponse({ links: [] });
    }
    sql += ` AND sl.review_group_id IN (${reviewIds.map(() => '?').join(',')})`;
    params.push(...reviewIds);
  }

  sql += ' ORDER BY sl.created_at ASC LIMIT 200';

  const list = await c.env.DB.prepare(sql).bind(...params).all();
  return jsonResponse({ links: list.results });
});

// ========== 审核短链（通过 / 驳回） ==========
links.post('/:id/review', authMiddleware, async (c) => {
  const linkId = parseInt(c.req.param('id'));
  if (!Number.isFinite(linkId)) return jsonResponse({ error: '无效的短链 ID' }, 400);
  const currentUser = c.get('user');
  const body = await c.req.json<{ approved: boolean; note?: string }>();

  const link = await c.env.DB.prepare(
    'SELECT id, short_code, name, target_url, created_by, group_id, review_status, review_group_id FROM short_links WHERE id = ?'
  ).bind(linkId).first<{ id: number; short_code: string; name: string; created_by: number; group_id: number | null; review_status: string; review_group_id: number | null }>();

  if (!link) {
    return jsonResponse({ error: '短链不存在' }, 404);
  }

  // 审核权限：超级管理员可审核全部（兜底）；其余用户需具备审核组的「审核组内短链」权限。
  // 与「待审核列表」的可见范围保持一致：只要组内拥有该权限即可操作，不强制要求是组管理员。
  if (currentUser.role !== 'super_admin') {
    const allowed = link.review_group_id
      ? await hasGroupPermission(c.env.DB, currentUser.user_id, link.review_group_id, 'link.review')
      : false;
    if (!allowed) {
      return jsonResponse({ error: '你没有审核该短链的权限' }, 403);
    }
  }
  if (link.review_status !== 'pending') {
    return jsonResponse({ error: '该短链不在待审核状态' }, 400);
  }

  const approved = !!body.approved;
  const note = body.note?.trim() || null;
  const now = Math.floor(Date.now() / 1000);

  await c.env.DB.prepare(
    `UPDATE short_links
     SET review_status = ?, review_note = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
     WHERE id = ?`
  ).bind(approved ? 'approved' : 'rejected', note, currentUser.user_id, now, now, linkId).run();

  await logAudit(c.env.DB, currentUser.user_id, approved ? 'approve_link' : 'reject_link', c.req.raw, 'link', linkId, JSON.stringify({ note }));

  // 审核结果立即生效，清除跳转缓存
  c.executionCtx.waitUntil(invalidateLinkCache(c.env, link.short_code));

  // 邮件通知创建者
  const creator = await c.env.DB.prepare('SELECT email FROM users WHERE id = ?')
    .bind(link.created_by)
    .first<{ email: string }>();
  if (creator?.email) {
    const { sendReviewResultEmail } = await import('../services/email');
    c.executionCtx.waitUntil(
      sendReviewResultEmail(creator.email, { approved, linkName: link.name, shortCode: link.short_code, note }, c.env)
    );
  }

  return jsonResponse({ success: true, review_status: approved ? 'approved' : 'rejected' });
});

// ========== 创建短链（需登录） ==========
links.post('/', authMiddleware, async (c) => {
  const currentUser = c.get('user');
  const body = await c.req.json<{
    target_url: string;
    name?: string;
    custom_alias?: string;
    group_id?: number;
    domain_id?: number;
    password?: string;
    expires_at?: number;
    redirect_type?: number;
  }>();

  if (typeof body.target_url !== 'string' || !body.target_url.trim()) {
    return jsonResponse({ error: '请填写目标链接' }, 400);
  }
  body.target_url = body.target_url.trim();

  // 验证 URL（仅允许 http/https，拒绝 javascript:、data: 等协议）
  if (!isSafeHttpUrl(body.target_url)) {
    return jsonResponse({ error: '目标链接格式不正确，仅支持 http:// 或 https://' }, 400);
  }
  if (body.name !== undefined && typeof body.name !== 'string') {
    return jsonResponse({ error: '名称格式不正确' }, 400);
  }
  if (body.custom_alias !== undefined && typeof body.custom_alias !== 'string') {
    return jsonResponse({ error: '自定义别名格式不正确' }, 400);
  }
  if (body.password !== undefined && (typeof body.password !== 'string' || body.password.length > 128)) {
    return jsonResponse({ error: '访问密码格式不正确（最长 128 个字符）' }, 400);
  }
  if (body.group_id !== undefined && (!Number.isInteger(body.group_id) || body.group_id <= 0)) {
    return jsonResponse({ error: '项目组 ID 不正确' }, 400);
  }
  if (body.domain_id !== undefined && (!Number.isInteger(body.domain_id) || body.domain_id <= 0)) {
    return jsonResponse({ error: '域名 ID 不正确' }, 400);
  }
  if (body.expires_at !== undefined && (!Number.isInteger(body.expires_at) || body.expires_at <= 0)) {
    return jsonResponse({ error: '过期时间格式不正确' }, 400);
  }
  if (body.redirect_type !== undefined && body.redirect_type !== 301 && body.redirect_type !== 302) {
    return jsonResponse({ error: '跳转类型只能是 301 或 302' }, 400);
  }

  // 如果指定了项目组，检查权限
  if (body.group_id) {
    const group = await c.env.DB.prepare('SELECT id FROM project_groups WHERE id = ?').bind(body.group_id).first();
    if (!group) {
      return jsonResponse({ error: '项目组不存在' }, 400);
    }
    if (currentUser.role !== 'super_admin' && !await isGroupMember(c.env.DB, currentUser.user_id, body.group_id)
      && !await isGroupAdminOf(c.env.DB, currentUser.user_id, body.group_id)) {
      return jsonResponse({ error: '您不在该项目组中' }, 403);
    }
    // 组内创建短链需要「创建短链」权限（可由组管理员按人配置）
    if (currentUser.role !== 'super_admin'
      && !(await hasGroupPermission(c.env.DB, currentUser.user_id, body.group_id, 'link.create'))) {
      return jsonResponse({ error: '你没有在该项目组创建短链的权限' }, 403);
    }
  }

  // 域名：项目组短链只能使用该项目组已绑定的可用域名
  if (body.group_id) {
    const available = await c.env.DB.prepare(
      `SELECT d.id, d.domain FROM domains d
       JOIN group_domain_relations gdr ON d.id = gdr.domain_id
       WHERE gdr.group_id = ? AND d.type IN ('short_link', 'both') AND d.status = 'active'
       ORDER BY d.is_default_short_link DESC, d.id ASC`
    ).bind(body.group_id).all<{ id: number; domain: string }>();

    if (available.results.length === 0) {
      return jsonResponse({ error: '该项目组暂无可用域名，请联系超级管理员绑定域名' }, 400);
    }
    if (body.domain_id) {
      if (!available.results.some((d) => d.id === body.domain_id)) {
        return jsonResponse({ error: '该项目组未绑定该域名' }, 400);
      }
    } else {
      body.domain_id = available.results[0].id;
    }
  } else if (body.domain_id) {
    // 未选择项目组：域名必须可用；普通用户只能使用自己所在项目组绑定的域名
    const domain = await c.env.DB.prepare(
      "SELECT id FROM domains WHERE id = ? AND type IN ('short_link', 'both') AND status = 'active'"
    ).bind(body.domain_id).first();
    if (!domain) {
      return jsonResponse({ error: '域名不可用' }, 400);
    }
    if (currentUser.role !== 'super_admin') {
      const allowedIds = await getAccessibleDomainIds(c.env.DB, currentUser.user_id);
      if (!allowedIds.includes(body.domain_id)) {
        return jsonResponse({ error: '无权使用该域名' }, 403);
      }
    }
  } else if (currentUser.role === 'super_admin') {
    // 超级管理员未指定域名：使用平台默认短链域名（未设置则留空）
    const defaultDomain = await c.env.DB.prepare(
      "SELECT id FROM domains WHERE is_default_short_link = 1 AND type IN ('short_link', 'both') AND status = 'active' LIMIT 1"
    ).first<{ id: number }>();
    if (defaultDomain) {
      body.domain_id = defaultDomain.id;
    }
  } else {
    // 普通用户未指定域名：仅在其所在项目组的域名中取默认域名（未设置则留空）
    const allowedIds = await getAccessibleDomainIds(c.env.DB, currentUser.user_id);
    if (allowedIds.length > 0) {
      const defaultDomain = await c.env.DB.prepare(
        `SELECT id FROM domains
         WHERE id IN (${allowedIds.map(() => '?').join(',')})
           AND is_default_short_link = 1 AND type IN ('short_link', 'both') AND status = 'active'
         LIMIT 1`
      ).bind(...allowedIds).first<{ id: number }>();
      if (defaultDomain) {
        body.domain_id = defaultDomain.id;
      }
    }
  }

  // 生成短码
  const aliasInput = body.custom_alias?.trim();
  if (aliasInput) {
    const aliasError = validateAlias(aliasInput);
    if (aliasError) {
      return jsonResponse({ error: aliasError }, 400);
    }
    body.custom_alias = aliasInput;
  }
  let shortCode = aliasInput || generateShortCode(6);

  // 检查短码冲突（同一域名内唯一；不同域名互不影响）
  let aliasConflict = await findAliasConflict(c.env.DB, shortCode, body.domain_id ?? null);
  let attempts = 0;
  while (aliasConflict && !body.custom_alias && attempts < 10) {
    shortCode = generateShortCode(6);
    aliasConflict = await findAliasConflict(c.env.DB, shortCode, body.domain_id ?? null);
    attempts++;
  }
  if (aliasConflict) {
    if (body.custom_alias) {
      const domainName = body.domain_id ? await getDomainName(c.env.DB, body.domain_id) : '';
      return jsonResponse(
        { error: domainName ? `该别名已被域名 ${domainName} 下的短链使用` : '该自定义别名已被使用' },
        400
      );
    }
    return jsonResponse({ error: '短码生成失败，请重试' }, 500);
  }

  // 密码保护
  let passwordHash = null;
  if (body.password) {
    passwordHash = await hashPassword(body.password);
  }

  // 显式指定优先；未指定时使用「系统设置 → 默认跳转类型」，而不是写死 302
  const redirectType = body.redirect_type === 301 || body.redirect_type === 302
    ? body.redirect_type
    : await getDefaultRedirectType(c.env.DB);

  // 是否需要审核（超级管理员创建的短链始终直接通过）
  let requireReview = false;
  let reviewGroupId: number | null = null;
  if (currentUser.role !== 'super_admin') {
    const owner = await c.env.DB.prepare('SELECT require_review, review_by FROM users WHERE id = ?')
      .bind(currentUser.user_id)
      .first<{ require_review: number; review_by: string }>();
    requireReview = !!owner?.require_review;
    if (requireReview) {
      // 审核人：auto = 从所属组向上找最近有审核权限的管理员；parent = 从父组开始向上找；super_admin = 超管
      reviewGroupId = owner?.review_by === 'super_admin'
        ? null
        : await resolveReviewGroupId(
            c.env.DB,
            body.group_id || null,
            owner?.review_by === 'parent' ? 'parent' : 'auto',
          );
    }
  }
  const reviewStatus = requireReview ? 'pending' : 'approved';

  let result: D1Result;
  try {
    result = await c.env.DB.prepare(
      `INSERT INTO short_links (short_code, target_url, name, custom_alias, status, redirect_type, password, created_by, group_id, domain_id, expires_at, review_status, review_group_id)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      shortCode, body.target_url, body.name || '', body.custom_alias || null,
      redirectType, passwordHash, currentUser.user_id, body.group_id || null,
      body.domain_id ?? null, body.expires_at ?? null, reviewStatus, reviewGroupId
    ).run();
  } catch {
    // 并发创建时仍可能撞唯一索引，返回可读的冲突提示而不是 500
    return jsonResponse(
      { error: body.custom_alias ? '该自定义别名已被使用' : '短码生成冲突，请重试' },
      409,
    );
  }

  const linkId = result.meta.last_row_id;

  await logAudit(c.env.DB, currentUser.user_id, 'create_link', c.req.raw, 'link', linkId as number, JSON.stringify({ short_code: shortCode, target_url: body.target_url, review_status: reviewStatus, review_group_id: reviewGroupId }));

  // 待审核：邮件提醒对应的审核人（组管理员优先，否则超级管理员）
  if (requireReview) {
    const recipients = reviewGroupId
      ? await getGroupReviewerEmails(c.env.DB, reviewGroupId)
      : await getSuperAdminEmails(c.env.DB);

    if (recipients.length > 0) {
      const { sendReviewRequestEmail } = await import('../services/email');
      const applicant = await c.env.DB.prepare('SELECT name, email FROM users WHERE id = ?')
        .bind(currentUser.user_id)
        .first<{ name: string; email: string }>();
      const payload = {
        applicantName: applicant?.name || currentUser.email,
        applicantEmail: applicant?.email || currentUser.email,
        linkName: body.name || '',
        shortCode,
        targetUrl: body.target_url,
      };
      c.executionCtx.waitUntil(
        Promise.all(recipients.map((email) => sendReviewRequestEmail(email, payload, c.env)))
      );
    }
  }

  // 获取域名
  const domain = body.domain_id
    ? await c.env.DB.prepare('SELECT domain FROM domains WHERE id = ?').bind(body.domain_id).first<{ domain: string }>()
    : null;
  const fullUrl = domain ? `https://${domain.domain}/${shortCode}` : `/${shortCode}`;

  return jsonResponse({
    success: true,
    id: linkId,
    short_code: shortCode,
    short_url: fullUrl,
    review_status: reviewStatus,
  }, 201);
});

// ========== 获取短链详情 ==========
links.get('/:id', authMiddleware, async (c) => {
  const linkId = parseInt(c.req.param('id'));
  if (!Number.isFinite(linkId)) return jsonResponse({ error: '无效的短链 ID' }, 400);
  const currentUser = c.get('user');

  const link = await c.env.DB.prepare(
    `SELECT ${LINK_PUBLIC_COLUMNS}, d.domain as domain_name, u.name as creator_name, u.email as creator_email,
      pg.name as group_name
     FROM short_links sl
     LEFT JOIN domains d ON sl.domain_id = d.id
     LEFT JOIN users u ON sl.created_by = u.id
     LEFT JOIN project_groups pg ON sl.group_id = pg.id
     WHERE sl.id = ?`
  ).bind(linkId).first();

  if (!link) {
    return jsonResponse({ error: '短链不存在' }, 404);
  }

  // 权限检查
  if (!await canAccessLink(c.env.DB, currentUser, link as { created_by: number; group_id: number | null })) {
    return jsonResponse({ error: '权限不足' }, 403);
  }
  // 组内他人短链：还需具备「查看组内短链」权限（管理员默认拥有，可被单独关闭）
  const target = link as { created_by: number; group_id: number | null };
  if (
    currentUser.role !== 'super_admin' &&
    target.created_by !== currentUser.user_id &&
    target.group_id !== null &&
    !(await hasGroupPermission(c.env.DB, currentUser.user_id, target.group_id, 'link.view.group'))
  ) {
    return jsonResponse({ error: '没有查看该短链的权限' }, 403);
  }

  return jsonResponse({ link });
});

// ========== 更新短链 ==========
links.put('/:id', authMiddleware, async (c) => {
  const linkId = parseInt(c.req.param('id'));
  if (!Number.isFinite(linkId)) return jsonResponse({ error: '无效的短链 ID' }, 400);
  const currentUser = c.get('user');
  const body = await c.req.json<{
    target_url?: string;
    name?: string;
    status?: 'active' | 'disabled';
    password?: string;
    expires_at?: number | null;
    redirect_type?: number;
    group_id?: number | null;
    domain_id?: number | null;
    short_code?: string;
  }>();

  if (body.short_code !== undefined && typeof body.short_code !== 'string') {
    return jsonResponse({ error: '自定义别名格式不正确' }, 400);
  }
  if (body.name !== undefined && typeof body.name !== 'string') {
    return jsonResponse({ error: '名称格式不正确' }, 400);
  }
  if (body.password !== undefined && (typeof body.password !== 'string' || body.password.length > 128)) {
    return jsonResponse({ error: '访问密码格式不正确（最长 128 个字符）' }, 400);
  }
  if (body.status !== undefined && body.status !== 'active' && body.status !== 'disabled') {
    return jsonResponse({ error: '状态只能是 active 或 disabled' }, 400);
  }
  if (body.redirect_type !== undefined && body.redirect_type !== 301 && body.redirect_type !== 302) {
    return jsonResponse({ error: '跳转类型只能是 301 或 302' }, 400);
  }
  if (body.expires_at !== undefined && body.expires_at !== null
    && (!Number.isInteger(body.expires_at) || body.expires_at <= 0)) {
    return jsonResponse({ error: '过期时间格式不正确' }, 400);
  }
  if (body.group_id !== undefined && body.group_id !== null
    && (!Number.isInteger(body.group_id) || body.group_id <= 0)) {
    return jsonResponse({ error: '项目组 ID 不正确' }, 400);
  }
  if (body.domain_id !== undefined && body.domain_id !== null
    && (!Number.isInteger(body.domain_id) || body.domain_id <= 0)) {
    return jsonResponse({ error: '域名 ID 不正确' }, 400);
  }

  const link = await c.env.DB.prepare('SELECT * FROM short_links WHERE id = ?').bind(linkId).first<{
    id: number;
    created_by: number;
    group_id: number | null;
    domain_id: number | null;
    short_code: string;
    review_status: string;
    review_group_id: number | null;
  }>();
  if (!link) {
    return jsonResponse({ error: '短链不存在' }, 404);
  }

  // 权限检查：仅创建者、所属项目组管理员、超级管理员可修改
  if (!await canManageLink(c.env.DB, currentUser, link)) {
    return jsonResponse({ error: '权限不足，只有创建者或项目组管理员可以修改' }, 403);
  }

  // 目标项目组：仅在「所属项目组真的发生变化」时校验创建权限与域名归属。
  // 前端编辑弹窗总会带上 group_id，若每次都要求 link.create，编辑自己短链的权限会被误伤。
  const targetGroupId = body.group_id !== undefined ? body.group_id ?? null : link.group_id;
  const groupChanged = targetGroupId !== link.group_id;

  // 变更所属项目组时校验成员身份，并确保域名仍属于新项目组的可用域名
  let domainOverride: number | null = null;
  if (groupChanged && targetGroupId !== null) {
    if (currentUser.role !== 'super_admin'
      && !await isGroupMember(c.env.DB, currentUser.user_id, targetGroupId)
      && !await isGroupAdminOf(c.env.DB, currentUser.user_id, targetGroupId)) {
      return jsonResponse({ error: '您不在该项目组中' }, 403);
    }
    if (currentUser.role !== 'super_admin'
      && !(await hasGroupPermission(c.env.DB, currentUser.user_id, targetGroupId, 'link.create'))) {
      return jsonResponse({ error: '你没有在该项目组创建短链的权限' }, 403);
    }

    const available = await c.env.DB.prepare(
      `SELECT d.id FROM domains d
       JOIN group_domain_relations gdr ON d.id = gdr.domain_id
       WHERE gdr.group_id = ? AND d.type IN ('short_link', 'both') AND d.status = 'active'
       ORDER BY d.is_default_short_link DESC, d.id ASC`
    ).bind(targetGroupId).all<{ id: number }>();

    if (available.results.length === 0) {
      return jsonResponse({ error: '该项目组暂无可用域名，请联系超级管理员绑定域名' }, 400);
    }
    // 原域名不在新项目组可用域名内时，自动切换为该组默认可用域名
    if (!available.results.some((d) => d.id === link.domain_id)) {
      domainOverride = available.results[0].id;
    }
  }

  // 目标域名（用于别名唯一性与域名权限校验）
  const targetDomainId = body.domain_id !== undefined ? body.domain_id ?? null : (domainOverride ?? link.domain_id);

  // 修改域名：必须可用，且只允许选择有权限的域名
  if (body.domain_id !== undefined && body.domain_id !== null) {
    const domain = await c.env.DB.prepare(
      "SELECT id FROM domains WHERE id = ? AND type IN ('short_link', 'both') AND status = 'active'"
    ).bind(body.domain_id).first();
    if (!domain) {
      return jsonResponse({ error: '域名不可用' }, 400);
    }
    if (currentUser.role !== 'super_admin') {
      if (targetGroupId) {
        const bound = await c.env.DB.prepare(
          'SELECT id FROM group_domain_relations WHERE group_id = ? AND domain_id = ?'
        ).bind(targetGroupId, body.domain_id).first();
        if (!bound) {
          return jsonResponse({ error: '该项目组未绑定该域名' }, 403);
        }
      } else {
        const allowedIds = await getAccessibleDomainIds(c.env.DB, currentUser.user_id);
        if (!allowedIds.includes(body.domain_id)) {
          return jsonResponse({ error: '无权使用该域名' }, 403);
        }
      }
    }
  }

  const updates: string[] = [];
  const params: (string | number | null)[] = [];

  // 修改别名（短码）：格式校验
  const targetAlias = body.short_code !== undefined ? body.short_code.trim() : link.short_code;
  if (body.short_code !== undefined) {
    if (!targetAlias) {
      return jsonResponse({ error: '自定义别名不能为空' }, 400);
    }
    const aliasError = validateAlias(targetAlias);
    if (aliasError) {
      return jsonResponse({ error: aliasError }, 400);
    }
    if (targetAlias !== link.short_code) {
      updates.push('short_code = ?'); params.push(targetAlias);
      updates.push('custom_alias = ?'); params.push(targetAlias);
    }
  }

  // 别名或所属域名任一变化，都要检查目标域名内是否已被占用
  if (targetAlias !== link.short_code || targetDomainId !== link.domain_id) {
    const conflict = await findAliasConflict(c.env.DB, targetAlias, targetDomainId, linkId);
    if (conflict) {
      const domainName = targetDomainId ? await getDomainName(c.env.DB, targetDomainId) : '';
      return jsonResponse(
        { error: domainName ? `该别名已被域名 ${domainName} 下的短链使用` : '该自定义别名已被使用' },
        400
      );
    }
  }

  if (body.target_url !== undefined) {
    if (typeof body.target_url !== 'string' || !body.target_url.trim()) {
      return jsonResponse({ error: '请填写目标链接' }, 400);
    }
    const targetUrl = body.target_url.trim();
    if (!isSafeHttpUrl(targetUrl)) {
      return jsonResponse({ error: '目标链接格式不正确，仅支持 http:// 或 https://' }, 400);
    }
    updates.push('target_url = ?'); params.push(targetUrl);
  }
  if (body.name !== undefined) { updates.push('name = ?'); params.push(body.name); }
  if (body.status !== undefined) { updates.push('status = ?'); params.push(body.status); }
  if (body.redirect_type !== undefined) {
    updates.push('redirect_type = ?');
    params.push(body.redirect_type === 301 ? 301 : 302);
  }
  if (body.expires_at !== undefined) {
    updates.push('expires_at = ?');
    params.push(body.expires_at ?? null);
  }
  if (body.group_id !== undefined) {
    updates.push('group_id = ?');
    params.push(targetGroupId);
  }
  // 域名：显式指定优先，其次跟随项目组自动切换
  if (body.domain_id !== undefined) {
    updates.push('domain_id = ?');
    params.push(body.domain_id ?? null);
  } else if (domainOverride !== null) {
    updates.push('domain_id = ?');
    params.push(domainOverride);
  }
  if (body.password !== undefined) {
    if (body.password) {
      const hash = await hashPassword(body.password);
      updates.push('password = ?'); params.push(hash);
    } else {
      updates.push('password = ?'); params.push(null);
    }
  }

  if (updates.length === 0) {
    return jsonResponse({ error: '没有需要更新的字段' }, 400);
  }

  // 被驳回的短链：用户修改后自动重新提交审核
  let resubmitReviewGroupId: number | null = null;
  const resubmit = link.review_status === 'rejected';
  if (resubmit) {
    const owner = await c.env.DB.prepare('SELECT review_by FROM users WHERE id = ?')
      .bind(link.created_by)
      .first<{ review_by: string }>();
    resubmitReviewGroupId = owner?.review_by === 'super_admin'
      ? null
      : await resolveReviewGroupId(
          c.env.DB,
          targetGroupId,
          owner?.review_by === 'parent' ? 'parent' : 'auto',
        );
    updates.push("review_status = 'pending'", 'review_note = NULL', 'reviewed_by = NULL', 'reviewed_at = NULL');
    updates.push('review_group_id = ?');
    params.push(resubmitReviewGroupId);
  }

  updates.push('updated_at = ?');
  params.push(Math.floor(Date.now() / 1000), linkId);

  try {
    await c.env.DB.prepare(`UPDATE short_links SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run();
  } catch {
    // 并发下别名可能被其他请求占用
    return jsonResponse({ error: '该别名已被使用，请更换后重试' }, 409);
  }

  await logAudit(
    c.env.DB,
    currentUser.user_id,
    resubmit ? 'resubmit_link' : 'update_link',
    c.req.raw,
    'link',
    linkId,
    JSON.stringify(body)
  );

  // 重新提交审核时再次通知审核人
  if (resubmit) {
    const recipients = resubmitReviewGroupId
      ? await getGroupReviewerEmails(c.env.DB, resubmitReviewGroupId)
      : await getSuperAdminEmails(c.env.DB);

    if (recipients.length > 0) {
      const detail = await c.env.DB.prepare(
        'SELECT name, short_code, target_url FROM short_links WHERE id = ?'
      ).bind(linkId).first<{ name: string; short_code: string; target_url: string }>();

      const applicant = await c.env.DB.prepare('SELECT name, email FROM users WHERE id = ?')
        .bind(link.created_by)
        .first<{ name: string; email: string }>();

      if (detail && applicant) {
        const { sendReviewRequestEmail } = await import('../services/email');
        c.executionCtx.waitUntil(
          Promise.all(
            recipients.map((email) =>
              sendReviewRequestEmail(
                email,
                {
                  applicantName: applicant.name,
                  applicantEmail: applicant.email,
                  linkName: detail.name || '',
                  shortCode: detail.short_code,
                  targetUrl: detail.target_url,
                },
                c.env
              )
            )
          )
        );
      }
    }
  }

  // 短码或配置变更后立即失效跳转缓存（新旧短码都清）
  c.executionCtx.waitUntil(invalidateLinkCache(c.env, link.short_code, body.short_code));

  return jsonResponse({ success: true, review_status: resubmit ? 'pending' : link.review_status });
});

// ========== 删除短链 ==========
links.delete('/:id', authMiddleware, async (c) => {
  const linkId = parseInt(c.req.param('id'));
  if (!Number.isFinite(linkId)) return jsonResponse({ error: '无效的短链 ID' }, 400);
  const currentUser = c.get('user');

  const link = await c.env.DB.prepare('SELECT * FROM short_links WHERE id = ?').bind(linkId).first<{ id: number; created_by: number; group_id: number | null; short_code: string }>();
  if (!link) {
    return jsonResponse({ error: '短链不存在' }, 404);
  }

  if (!await canManageLink(c.env.DB, currentUser, link, 'delete')) {
    return jsonResponse({ error: '权限不足，你没有删除该短链的权限' }, 403);
  }

  await c.env.DB.prepare('DELETE FROM short_links WHERE id = ?').bind(linkId).run();

  // 删除后立即释放别名缓存
  c.executionCtx.waitUntil(invalidateLinkCache(c.env, link.short_code));

  await logAudit(c.env.DB, currentUser.user_id, 'delete_link', c.req.raw, 'link', linkId);

  return jsonResponse({ success: true });
});


// ========== 批量导入（管理员） ==========
links.post('/batch-import', authMiddleware, requireRole('super_admin'), async (c) => {
  const currentUser = c.get('user');
  const body = await c.req.json<{ links: { target_url: string; name?: string; custom_alias?: string }[] }>();

  if (!body.links || !Array.isArray(body.links) || body.links.length === 0) {
    return jsonResponse({ error: '没有要导入的短链' }, 400);
  }
  if (body.links.length > 500) {
    return jsonResponse({ error: '单次最多导入 500 条短链' }, 400);
  }

  // 获取默认域名与默认跳转类型
  const defaultDomain = await c.env.DB.prepare(
    "SELECT id FROM domains WHERE is_default_short_link = 1 AND type IN ('short_link', 'both') AND status = 'active' LIMIT 1"
  ).first<{ id: number }>();
  const defaultRedirectType = await getDefaultRedirectType(c.env.DB);

  const results: { success: boolean; short_code?: string; error?: string; target_url: string }[] = [];

  for (const item of body.links) {
    if (!item || typeof item !== 'object') {
      results.push({ success: false, error: '数据格式错误', target_url: '' });
      continue;
    }
    const targetUrl = typeof item?.target_url === 'string' ? item.target_url.trim() : '';
    if (!targetUrl || !isSafeHttpUrl(targetUrl)) {
      results.push({ success: false, error: 'URL格式错误，仅支持 http:// 或 https://', target_url: targetUrl });
      continue;
    }
    if (item.name !== undefined && typeof item.name !== 'string') {
      results.push({ success: false, error: '名称格式不正确', target_url: targetUrl });
      continue;
    }
    if (item.custom_alias !== undefined && typeof item.custom_alias !== 'string') {
      results.push({ success: false, error: '别名格式不正确', target_url: targetUrl });
      continue;
    }

    const aliasInput = item.custom_alias?.trim();
    if (aliasInput) {
      const aliasError = validateAlias(aliasInput);
      if (aliasError) {
        results.push({ success: false, error: aliasError, target_url: targetUrl });
        continue;
      }
    }

    let shortCode = aliasInput || generateShortCode(6);
    let conflict = await findAliasConflict(c.env.DB, shortCode, defaultDomain?.id || null);
    for (let attempt = 0; attempt < 10 && conflict && !aliasInput; attempt++) {
      shortCode = generateShortCode(6);
      conflict = await findAliasConflict(c.env.DB, shortCode, defaultDomain?.id || null);
    }
    if (conflict) {
      results.push({
        success: false,
        error: aliasInput ? '别名已存在' : '短码生成冲突，请重试',
        target_url: targetUrl,
      });
      continue;
    }

    try {
      await c.env.DB.prepare(
        `INSERT INTO short_links (short_code, target_url, name, custom_alias, status, redirect_type, created_by, domain_id)
         VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`
      ).bind(
        shortCode,
        targetUrl,
        item.name || '',
        aliasInput || null,
        defaultRedirectType,
        currentUser.user_id,
        defaultDomain?.id || null,
      ).run();
    } catch {
      // 并发下仍可能撞唯一索引，单条失败不影响整批
      results.push({ success: false, error: '该别名已被占用', target_url: targetUrl });
      continue;
    }

    results.push({ success: true, short_code: shortCode, target_url: targetUrl });
  }

  await logAudit(c.env.DB, currentUser.user_id, 'batch_import_links', c.req.raw, 'link', undefined, JSON.stringify({ count: body.links.length }));

  return jsonResponse({ results });
});

// 展开用户管理的项目组：管理组自身 + 其所有子组
async function expandManagedGroupIds(db: D1Database, userId: number): Promise<number[]> {
  const managed = await getManagedGroupIds(db, userId);
  if (managed.length === 0) return [];
  return expandGroupIdsWithDescendants(db, managed);
}

// 别名冲突检测：同一域名内唯一（domain_id 为空视为同一「无域名」分组）
async function findAliasConflict(
  db: D1Database,
  shortCode: string,
  domainId: number | null,
  excludeId?: number
): Promise<{ id: number } | null> {
  const row = await db
    .prepare(
      `SELECT id FROM short_links
       WHERE short_code = ? AND COALESCE(domain_id, 0) = COALESCE(?, 0)
       ${excludeId ? 'AND id != ?' : ''}
       LIMIT 1`
    )
    .bind(...(excludeId ? [shortCode, domainId, excludeId] : [shortCode, domainId]))
    .first<{ id: number }>();
  return row || null;
}

async function getDomainName(db: D1Database, domainId: number): Promise<string> {
  const row = await db.prepare('SELECT domain FROM domains WHERE id = ?').bind(domainId).first<{ domain: string }>();
  return row?.domain || '';
}

/** 普通用户可使用的域名：所在项目组（含子组）绑定的、可用的短链域名 */
async function getAccessibleDomainIds(db: D1Database, userId: number): Promise<number[]> {
  const groupIds = await getVisibleGroupIds(db, userId);
  if (groupIds.length === 0) return [];

  const rows = await db
    .prepare(
      `SELECT DISTINCT d.id FROM domains d
       JOIN group_domain_relations gdr ON gdr.domain_id = d.id
       WHERE gdr.group_id IN (${groupIds.map(() => '?').join(',')})
         AND d.type IN ('short_link', 'both') AND d.status = 'active'`
    )
    .bind(...groupIds)
    .all<{ id: number }>();

  return rows.results.map((r) => r.id);
}

// 检查用户是否有权查看短链（创建者 / 所在项目组及父组成员 / 项目组管理员 / 超级管理员）
async function canAccessLink(db: D1Database, user: JWTPayload, link: { created_by: number; group_id: number | null }): Promise<boolean> {
  if (user.role === 'super_admin') return true;
  if (link.created_by === user.user_id) return true;

  if (link.group_id) {
    if (await isGroupMember(db, user.user_id, link.group_id)) return true;
    if (await isGroupAdminOf(db, user.user_id, link.group_id)) return true;
    if (await isGroupVisibleToUser(db, user.user_id, link.group_id)) return true;
  }

  return false;
}

// 检查用户是否有权修改/删除短链
// 个人短链：仅创建者本人
// 项目组短链：创建者需「编辑/删除自己的短链」权限，其他人需「编辑/删除组内任意短链」权限
async function canManageLink(
  db: D1Database,
  user: JWTPayload,
  link: { created_by: number; group_id: number | null },
  kind: 'update' | 'delete' = 'update',
): Promise<boolean> {
  if (user.role === 'super_admin') return true;
  const own = link.created_by === user.user_id;
  if (!link.group_id) return own;
  if (own && (await hasGroupPermission(db, user.user_id, link.group_id, kind === 'update' ? 'link.update.own' : 'link.delete.own'))) {
    return true;
  }
  return hasGroupPermission(db, user.user_id, link.group_id, kind === 'update' ? 'link.update.any' : 'link.delete.any');
}

export default links;
