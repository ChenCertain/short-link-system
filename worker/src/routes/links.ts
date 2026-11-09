// 短链管理路由

import { Hono } from 'hono';
import type { Env, JWTPayload } from '../types';
import { jsonResponse, generateShortCode, hashPassword, validateAlias } from '../utils';
import { authMiddleware, requireRole, logAudit } from '../middleware';
import {
  getManagedGroupIds,
  isGroupMember,
  isGroupAdminOf,
  resolveReviewGroupId,
  getGroupReviewerEmails,
  getSuperAdminEmails,
} from '../permissions';

const links = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();

// ========== 获取短链列表 ==========
links.get('/', authMiddleware, async (c) => {
  const currentUser = c.get('user');
  const page = parseInt(c.req.query('page') || '1');
  const pageSize = parseInt(c.req.query('pageSize') || '20');
  const search = c.req.query('search') || '';
  const status = c.req.query('status') || '';
  const groupId = c.req.query('groupId');
  const offset = (page - 1) * pageSize;

  let query = `
    SELECT sl.*, d.domain as domain_name, u.name as creator_name, u.email as creator_email,
      pg.name as group_name
    FROM short_links sl
    LEFT JOIN domains d ON sl.domain_id = d.id
    LEFT JOIN users u ON sl.created_by = u.id
    LEFT JOIN project_groups pg ON sl.group_id = pg.id
  `;
  let countQuery = 'SELECT COUNT(*) as total FROM short_links sl';
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  const isSuperAdmin = currentUser.role === 'super_admin';
  let managedIds: number[] = [];
  if (!isSuperAdmin) {
    // 普通用户 / 项目组管理员：自己创建的 + 所属项目组（含管理组及其子组）的
    managedIds = await expandManagedGroupIds(c.env.DB, currentUser.user_id);
    const groupPlaceholders = managedIds.length > 0 ? managedIds.map(() => '?').join(',') : 'NULL';
    conditions.push(`(
      sl.created_by = ?
      OR sl.group_id IN (SELECT group_id FROM user_group_relations WHERE user_id = ?)
      ${managedIds.length > 0 ? `OR sl.group_id IN (${groupPlaceholders})` : ''}
    )`);
    params.push(currentUser.user_id, currentUser.user_id, ...managedIds);
  }
  // super_admin 无额外条件

  if (search) {
    conditions.push('(sl.short_code LIKE ? OR sl.target_url LIKE ? OR sl.name LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  if (status) {
    conditions.push('sl.status = ?');
    params.push(status);
  }

  if (groupId) {
    conditions.push('sl.group_id = ?');
    params.push(parseInt(groupId));
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

// ========== 待审核短链列表（管理员） ==========
// 注意：必须注册在 /:id 之前，避免被详情路由吞掉
links.get('/pending-reviews', authMiddleware, async (c) => {
  const currentUser = c.get('user');

  let sql = `
    SELECT sl.*, d.domain as domain_name, u.name as creator_name, u.email as creator_email,
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
    // 项目组管理员：只能审核分配给自己的组（含子组）的短链
    const managedIds = await expandManagedGroupIds(c.env.DB, currentUser.user_id);
    if (managedIds.length === 0) {
      return jsonResponse({ links: [] });
    }
    sql += ` AND sl.review_group_id IN (${managedIds.map(() => '?').join(',')})`;
    params.push(...managedIds);
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

  // 审核权限：超级管理员可审核全部（兜底）；组管理员只能审核分配给其管理组的短链
  if (currentUser.role !== 'super_admin') {
    const managedIds = await expandManagedGroupIds(c.env.DB, currentUser.user_id);
    if (!link.review_group_id || !managedIds.includes(link.review_group_id)) {
      return jsonResponse({ error: '权限不足' }, 403);
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

  await logAudit(c.env.DB, c.env.KV, currentUser.user_id, approved ? 'approve_link' : 'reject_link', c.req.raw, 'link', linkId, JSON.stringify({ note }));

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

  if (!body.target_url) {
    return jsonResponse({ error: '请填写目标链接' }, 400);
  }

  // 验证 URL
  try {
    new URL(body.target_url);
  } catch {
    return jsonResponse({ error: '目标链接格式不正确' }, 400);
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
    // 未选择项目组：使用平台上可用的短链域名
    const domain = await c.env.DB.prepare(
      "SELECT id FROM domains WHERE id = ? AND type IN ('short_link', 'both') AND status = 'active'"
    ).bind(body.domain_id).first();
    if (!domain) {
      return jsonResponse({ error: '域名不可用' }, 400);
    }
  } else {
    // 使用默认域名
    const defaultDomain = await c.env.DB.prepare(
      "SELECT id FROM domains WHERE is_default_short_link = 1 AND type IN ('short_link', 'both') AND status = 'active' LIMIT 1"
    ).first<{ id: number }>();
    if (defaultDomain) {
      body.domain_id = defaultDomain.id;
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

  // 检查短码冲突
  let attempts = 0;
  while (attempts < 10) {
    const existing = await c.env.DB.prepare('SELECT id FROM short_links WHERE short_code = ?').bind(shortCode).first();
    if (!existing) break;
    if (body.custom_alias) {
      return jsonResponse({ error: '该自定义别名已被使用' }, 400);
    }
    shortCode = generateShortCode(6);
    attempts++;
  }

  // 密码保护
  let passwordHash = null;
  if (body.password) {
    passwordHash = await hashPassword(body.password);
  }

  const redirectType = body.redirect_type === 301 ? 301 : 302;

  // 是否需要审核（超级管理员创建的短链始终直接通过）
  let requireReview = false;
  let reviewGroupId: number | null = null;
  if (currentUser.role !== 'super_admin') {
    const owner = await c.env.DB.prepare('SELECT require_review, review_by FROM users WHERE id = ?')
      .bind(currentUser.user_id)
      .first<{ require_review: number; review_by: string }>();
    requireReview = !!owner?.require_review;
    if (requireReview) {
      // 审核人：默认优先由所属项目组的管理员审核；无组或组内无管理员则由超级管理员审核
      reviewGroupId = owner?.review_by === 'super_admin'
        ? null
        : await resolveReviewGroupId(c.env.DB, body.group_id || null);
    }
  }
  const reviewStatus = requireReview ? 'pending' : 'approved';

  const result = await c.env.DB.prepare(
    `INSERT INTO short_links (short_code, target_url, name, custom_alias, status, redirect_type, password, created_by, group_id, domain_id, expires_at, review_status, review_group_id)
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    shortCode, body.target_url, body.name || '', body.custom_alias || null,
    redirectType, passwordHash, currentUser.user_id, body.group_id || null,
    body.domain_id ?? null, body.expires_at ?? null, reviewStatus, reviewGroupId
  ).run();

  const linkId = result.meta.last_row_id;

  await logAudit(c.env.DB, c.env.KV, currentUser.user_id, 'create_link', c.req.raw, 'link', linkId as number, JSON.stringify({ short_code: shortCode, target_url: body.target_url, review_status: reviewStatus, review_group_id: reviewGroupId }));

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
  const currentUser = c.get('user');

  const link = await c.env.DB.prepare(
    `SELECT sl.*, d.domain as domain_name, u.name as creator_name, u.email as creator_email,
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

  return jsonResponse({ link });
});

// ========== 更新短链 ==========
links.put('/:id', authMiddleware, async (c) => {
  const linkId = parseInt(c.req.param('id'));
  const currentUser = c.get('user');
  const body = await c.req.json<{
    target_url?: string;
    name?: string;
    status?: 'active' | 'disabled';
    password?: string;
    expires_at?: number;
    redirect_type?: number;
    group_id?: number;
    short_code?: string;
  }>();

  const link = await c.env.DB.prepare('SELECT * FROM short_links WHERE id = ?').bind(linkId).first<{ id: number; created_by: number; group_id: number | null; domain_id: number | null; short_code: string }>();
  if (!link) {
    return jsonResponse({ error: '短链不存在' }, 404);
  }

  // 权限检查：仅创建者、所属项目组管理员、超级管理员可修改
  if (!await canManageLink(c.env.DB, currentUser, link)) {
    return jsonResponse({ error: '权限不足，只有创建者或项目组管理员可以修改' }, 403);
  }

  // 变更所属项目组时校验成员身份，并确保域名仍属于新项目组的可用域名
  let domainOverride: number | null = null;
  if (body.group_id !== undefined && body.group_id !== null) {
    if (currentUser.role !== 'super_admin'
      && !await isGroupMember(c.env.DB, currentUser.user_id, body.group_id)
      && !await isGroupAdminOf(c.env.DB, currentUser.user_id, body.group_id)) {
      return jsonResponse({ error: '您不在该项目组中' }, 403);
    }

    const available = await c.env.DB.prepare(
      `SELECT d.id FROM domains d
       JOIN group_domain_relations gdr ON d.id = gdr.domain_id
       WHERE gdr.group_id = ? AND d.type IN ('short_link', 'both') AND d.status = 'active'
       ORDER BY d.is_default_short_link DESC, d.id ASC`
    ).bind(body.group_id).all<{ id: number }>();

    if (available.results.length === 0) {
      return jsonResponse({ error: '该项目组暂无可用域名，请联系超级管理员绑定域名' }, 400);
    }
    // 原域名不在新项目组可用域名内时，自动切换为该组默认可用域名
    if (!available.results.some((d) => d.id === link.domain_id)) {
      domainOverride = available.results[0].id;
    }
  }

  const updates: string[] = [];
  const params: (string | number | null)[] = [];

  // 修改别名（短码）：格式校验 + 全局唯一性检查
  if (body.short_code !== undefined) {
    const alias = body.short_code.trim();
    if (!alias) {
      return jsonResponse({ error: '自定义别名不能为空' }, 400);
    }
    const aliasError = validateAlias(alias);
    if (aliasError) {
      return jsonResponse({ error: aliasError }, 400);
    }
    if (alias !== link.short_code) {
      const conflict = await c.env.DB.prepare('SELECT id FROM short_links WHERE short_code = ? AND id != ?')
        .bind(alias, linkId).first();
      if (conflict) {
        return jsonResponse({ error: '该自定义别名已被使用' }, 400);
      }
      updates.push('short_code = ?'); params.push(alias);
      updates.push('custom_alias = ?'); params.push(alias);
    }
  }

  if (body.target_url) {
    try { new URL(body.target_url); } catch { return jsonResponse({ error: '目标链接格式不正确' }, 400); }
    updates.push('target_url = ?'); params.push(body.target_url);
  }
  if (body.name !== undefined) { updates.push('name = ?'); params.push(body.name); }
  if (body.status) { updates.push('status = ?'); params.push(body.status); }
  if (body.redirect_type) { updates.push('redirect_type = ?'); params.push(body.redirect_type === 301 ? 301 : 302); }
  if (body.expires_at !== undefined) { updates.push('expires_at = ?'); params.push(body.expires_at || null); }
  if (body.group_id !== undefined) {
    updates.push('group_id = ?');
    params.push(body.group_id || null);
    if (domainOverride !== null) {
      updates.push('domain_id = ?');
      params.push(domainOverride);
    }
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

  updates.push('updated_at = ?');
  params.push(Math.floor(Date.now() / 1000), linkId);

  await c.env.DB.prepare(`UPDATE short_links SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run();

  await logAudit(c.env.DB, c.env.KV, currentUser.user_id, 'update_link', c.req.raw, 'link', linkId, JSON.stringify(body));

  return jsonResponse({ success: true });
});

// ========== 删除短链 ==========
links.delete('/:id', authMiddleware, async (c) => {
  const linkId = parseInt(c.req.param('id'));
  const currentUser = c.get('user');

  const link = await c.env.DB.prepare('SELECT * FROM short_links WHERE id = ?').bind(linkId).first<{ id: number; created_by: number; group_id: number | null }>();
  if (!link) {
    return jsonResponse({ error: '短链不存在' }, 404);
  }

  if (!await canManageLink(c.env.DB, currentUser, link)) {
    return jsonResponse({ error: '权限不足，只有创建者或项目组管理员可以删除' }, 403);
  }

  await c.env.DB.prepare('DELETE FROM short_links WHERE id = ?').bind(linkId).run();

  await logAudit(c.env.DB, c.env.KV, currentUser.user_id, 'delete_link', c.req.raw, 'link', linkId);

  return jsonResponse({ success: true });
});

// ========== 设置/取消首页展示 ==========
links.post('/:id/display', authMiddleware, requireRole('super_admin'), async (c) => {
  const linkId = parseInt(c.req.param('id'));
  const body = await c.req.json<{ displayed: boolean; order?: number }>();

  await c.env.DB.prepare(
    'UPDATE short_links SET is_displayed = ?, display_order = ?, updated_at = ? WHERE id = ?'
  ).bind(body.displayed ? 1 : 0, body.order || 0, Math.floor(Date.now() / 1000), linkId).run();

  await logAudit(c.env.DB, c.env.KV, c.get('user').user_id, 'toggle_display', c.req.raw, 'link', linkId, JSON.stringify(body));

  return jsonResponse({ success: true });
});

// ========== 批量导入（管理员） ==========
links.post('/batch-import', authMiddleware, requireRole('super_admin'), async (c) => {
  const currentUser = c.get('user');
  const body = await c.req.json<{ links: { target_url: string; name?: string; custom_alias?: string }[] }>();

  if (!body.links || !Array.isArray(body.links) || body.links.length === 0) {
    return jsonResponse({ error: '没有要导入的短链' }, 400);
  }

  // 获取默认域名
  const defaultDomain = await c.env.DB.prepare(
    "SELECT id FROM domains WHERE is_default_short_link = 1 AND type IN ('short_link', 'both') AND status = 'active' LIMIT 1"
  ).first<{ id: number }>();

  const results: { success: boolean; short_code?: string; error?: string; target_url: string }[] = [];

  for (const item of body.links) {
    try {
      new URL(item.target_url);
    } catch {
      results.push({ success: false, error: 'URL格式错误', target_url: item.target_url });
      continue;
    }

    const aliasInput = item.custom_alias?.trim();
    if (aliasInput) {
      const aliasError = validateAlias(aliasInput);
      if (aliasError) {
        results.push({ success: false, error: aliasError, target_url: item.target_url });
        continue;
      }
    }

    let shortCode = aliasInput || generateShortCode(6);
    const existing = await c.env.DB.prepare('SELECT id FROM short_links WHERE short_code = ?').bind(shortCode).first();
    if (existing) {
      if (aliasInput) {
        results.push({ success: false, error: '别名已存在', target_url: item.target_url });
        continue;
      }
      shortCode = generateShortCode(6);
    }

    const result = await c.env.DB.prepare(
      `INSERT INTO short_links (short_code, target_url, name, custom_alias, status, redirect_type, created_by, domain_id)
       VALUES (?, ?, ?, ?, 'active', 302, ?, ?)`
    ).bind(shortCode, item.target_url, item.name || '', aliasInput || null, currentUser.user_id, defaultDomain?.id || null).run();

    results.push({ success: true, short_code: shortCode, target_url: item.target_url });
  }

  await logAudit(c.env.DB, c.env.KV, currentUser.user_id, 'batch_import_links', c.req.raw, 'link', undefined, JSON.stringify({ count: body.links.length }));

  return jsonResponse({ results });
});

// 展开用户管理的项目组：管理组自身 + 其所有子组
async function expandManagedGroupIds(db: D1Database, userId: number): Promise<number[]> {
  const managed = await getManagedGroupIds(db, userId);
  if (managed.length === 0) return [];

  const all = await db.prepare('SELECT id, parent_id FROM project_groups').all<{ id: number; parent_id: number | null }>();
  const result = new Set<number>(managed);
  let changed = true;
  while (changed) {
    changed = false;
    for (const g of all.results) {
      if (g.parent_id && result.has(g.parent_id) && !result.has(g.id)) {
        result.add(g.id);
        changed = true;
      }
    }
  }
  return [...result];
}

// 检查用户是否有权查看短链（创建者 / 项目组成员 / 项目组管理员 / 超级管理员）
async function canAccessLink(db: D1Database, user: JWTPayload, link: { created_by: number; group_id: number | null }): Promise<boolean> {
  if (user.role === 'super_admin') return true;
  if (link.created_by === user.user_id) return true;

  if (link.group_id) {
    if (await isGroupMember(db, user.user_id, link.group_id)) return true;
    if (await isGroupAdminOf(db, user.user_id, link.group_id)) return true;
  }

  return false;
}

// 检查用户是否有权修改/删除短链（创建者 / 项目组管理员 / 超级管理员）
async function canManageLink(db: D1Database, user: JWTPayload, link: { created_by: number; group_id: number | null }): Promise<boolean> {
  if (user.role === 'super_admin') return true;
  if (link.created_by === user.user_id) return true;
  if (link.group_id && await isGroupAdminOf(db, user.user_id, link.group_id)) return true;
  return false;
}

export default links;
