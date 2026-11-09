// 域名管理路由

import { Hono } from 'hono';
import type { Env, JWTPayload } from '../types';
import { jsonResponse } from '../utils';
import { authMiddleware, requireRole, logAudit } from '../middleware';

const domains = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();

domains.use('*', authMiddleware);

// ========== 获取域名列表（仅超级管理员，项目组域名在项目组详情中查看） ==========
domains.get('/', requireRole('super_admin'), async (c) => {
  const allDomains = await c.env.DB.prepare(
    `SELECT d.*, u.email as added_by_email FROM domains d JOIN users u ON d.added_by = u.id ORDER BY d.created_at DESC`
  ).all();
  return jsonResponse({ domains: allDomains.results });
});

// ========== 获取可用短链域名 ==========
domains.get('/short-link-domains', async (c) => {
  const list = await c.env.DB.prepare(
    "SELECT id, domain, is_default_short_link FROM domains WHERE type IN ('short_link', 'both') AND status = 'active' ORDER BY is_default_short_link DESC, domain ASC"
  ).all();
  return jsonResponse({ domains: list.results });
});

// ========== 添加域名 ==========
domains.post('/', requireRole('super_admin'), async (c) => {
  const body = await c.req.json<{
    domain: string;
    type: 'short_link' | 'admin' | 'both';
    is_default_short_link?: boolean;
  }>();

  if (!body.domain) {
    return jsonResponse({ error: '请填写域名' }, 400);
  }

  // 清理域名格式
  let domain = body.domain.trim().toLowerCase();
  domain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');

  if (!/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(domain)) {
    return jsonResponse({ error: '域名格式不正确' }, 400);
  }

  // 检查是否已存在
  const existing = await c.env.DB.prepare('SELECT id FROM domains WHERE domain = ?').bind(domain).first();
  if (existing) {
    return jsonResponse({ error: '域名已存在' }, 400);
  }

  const type = body.type && ['short_link', 'admin', 'both'].includes(body.type) ? body.type : 'both';

  const result = await c.env.DB.prepare(
    'INSERT INTO domains (domain, type, is_default_short_link, status, added_by) VALUES (?, ?, ?, ?, ?)'
  ).bind(domain, type, body.is_default_short_link ? 1 : 0, 'pending_verification', c.get('user').user_id).run();

  const domainId = result.meta.last_row_id;

  // 如果设为默认，取消其他默认
  if (body.is_default_short_link) {
    await c.env.DB.prepare('UPDATE domains SET is_default_short_link = 0 WHERE id != ?').bind(domainId).run();
  }

  await logAudit(c.env.DB, c.env.KV, c.get('user').user_id, 'add_domain', c.req.raw, 'domain', domainId as number, JSON.stringify(body));

  // 返回需要配置的 DNS 记录（PAGES_DOMAIN 可留空，此时提示手动填写 Worker 域名）
  const workerHost = (c.env.PAGES_DOMAIN || '').trim();
  return jsonResponse({
    success: true,
    id: domainId,
    domain,
    dns_config: {
      type: 'CNAME',
      name: domain,
      target: workerHost,
      instructions: workerHost
        ? '请在 Cloudflare DNS 中添加以上 CNAME 记录，然后在下方点击验证。'
        : '请到 Worker → Settings → Domains & Routes 查看 xxx.workers.dev 地址，把它作为 CNAME 目标填入 DNS，然后点击验证。',
    },
  }, 201);
});

// ========== 更新域名 ==========
domains.put('/:id', requireRole('super_admin'), async (c) => {
  const domainId = parseInt(c.req.param('id'));
  const body = await c.req.json<{
    type?: 'short_link' | 'admin' | 'both';
    is_default_short_link?: boolean;
    status?: 'active' | 'disabled' | 'pending_verification';
  }>();

  const domain = await c.env.DB.prepare('SELECT * FROM domains WHERE id = ?').bind(domainId).first<{ id: number }>();
  if (!domain) {
    return jsonResponse({ error: '域名不存在' }, 404);
  }

  const updates: string[] = [];
  const params: (string | number)[] = [];

  if (body.type) { updates.push('type = ?'); params.push(body.type); }
  if (body.status) { updates.push('status = ?'); params.push(body.status); }
  if (body.is_default_short_link !== undefined) {
    updates.push('is_default_short_link = ?');
    params.push(body.is_default_short_link ? 1 : 0);
  }

  if (updates.length === 0) {
    return jsonResponse({ error: '没有需要更新的字段' }, 400);
  }

  updates.push('updated_at = ?');
  params.push(Math.floor(Date.now() / 1000), domainId);

  await c.env.DB.prepare(`UPDATE domains SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run();

  // 如果设为默认，取消其他默认
  if (body.is_default_short_link) {
    await c.env.DB.prepare('UPDATE domains SET is_default_short_link = 0 WHERE id != ?').bind(domainId).run();
  }

  await logAudit(c.env.DB, c.env.KV, c.get('user').user_id, 'update_domain', c.req.raw, 'domain', domainId, JSON.stringify(body));

  return jsonResponse({ success: true });
});

// ========== 验证域名 DNS ==========
domains.post('/:id/verify', requireRole('super_admin'), async (c) => {
  const domainId = parseInt(c.req.param('id'));

  const domain = await c.env.DB.prepare('SELECT * FROM domains WHERE id = ?').bind(domainId).first<{ id: number; domain: string }>();
  if (!domain) {
    return jsonResponse({ error: '域名不存在' }, 404);
  }

  // 通过 DNS over HTTPS 检查 CNAME 记录
  let verified = false;
  try {
    const resp = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain.domain)}&type=CNAME`, {
      headers: { Accept: 'application/dns-json' },
    });
    const data = (await resp.json()) as { Answer?: { data?: string }[] };
    if (data.Answer) {
      const expected = (c.env.PAGES_DOMAIN || '').trim().replace(/\.$/, '').toLowerCase();
      verified = data.Answer.some((a) => {
        const value = (a.data || '').toLowerCase();
        // 未配置 PAGES_DOMAIN 时，只要存在 CNAME 记录即视为已验证
        if (!expected) return true;
        return value.includes(expected) || value.includes('workers.dev');
      });
    }
  } catch {
    // DNS 查询失败
  }

  if (verified) {
    await c.env.DB.prepare("UPDATE domains SET status = 'active', updated_at = ? WHERE id = ?")
      .bind(Math.floor(Date.now() / 1000), domainId).run();
    return jsonResponse({ success: true, verified: true, message: '域名验证成功' });
  } else {
    return jsonResponse({ success: false, verified: false, message: 'DNS 记录尚未生效，请检查 CNAME 配置' }, 400);
  }
});

// ========== 删除域名 ==========
domains.delete('/:id', requireRole('super_admin'), async (c) => {
  const domainId = parseInt(c.req.param('id'));

  await c.env.DB.prepare('DELETE FROM domains WHERE id = ?').bind(domainId).run();

  await logAudit(c.env.DB, c.env.KV, c.get('user').user_id, 'delete_domain', c.req.raw, 'domain', domainId);

  return jsonResponse({ success: true });
});

export default domains;
