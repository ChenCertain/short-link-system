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
        ? '方式一：在 Cloudflare DNS 添加以上 CNAME 记录；方式二：在 Worker → Settings → Domains & Routes 直接绑定该域名。两种方式配置完成后点击验证。'
        : '方式一：到 Worker → Settings → Domains & Routes 查看 xxx.workers.dev 地址，作为 CNAME 目标填入 DNS；方式二：在 Worker → Settings → Domains & Routes 里直接添加该域名。配置完成后点击验证。',
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

// ========== 域名接入检测 ==========

type VerifyResult = { verified: boolean; method?: 'http' | 'cname' | 'cloudflare_proxy'; message: string };

// Cloudflare 边缘 IPv4 网段（域名经 Cloudflare 代理接入时，A 记录会落在这些网段）
const CF_IPV4_CIDRS = [
  '104.16.0.0/13', '172.64.0.0/13', '162.158.0.0/15', '198.41.128.0/17',
  '197.234.240.0/22', '188.114.96.0/20', '173.245.48.0/20', '103.21.244.0/22',
  '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18',
  '190.93.240.0/20', '131.0.72.0/22',
];

const CF_IPV6_PREFIXES = ['2606:4700:', '2803:f800:', '2405:b500:', '2405:8100:', '2a06:98c0:', '2c0f:f248:'];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    value = (value << 8) + n;
  }
  return value >>> 0;
}

function isCloudflareIp(ip: string): boolean {
  const value = ipv4ToInt(ip);
  if (value !== null) {
    return CF_IPV4_CIDRS.some((cidr) => {
      const [base, bitsRaw] = cidr.split('/');
      const baseValue = ipv4ToInt(base);
      if (baseValue === null) return false;
      const bits = Number(bitsRaw);
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return (value & mask) === (baseValue & mask);
    });
  }
  const lower = ip.toLowerCase();
  return lower.includes(':') && CF_IPV6_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

async function dohQuery(name: string, type: 'A' | 'AAAA' | 'CNAME'): Promise<string[]> {
  try {
    const resp = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`,
      { headers: { Accept: 'application/dns-json' } }
    );
    const data = (await resp.json()) as { Answer?: { data?: string }[] };
    return (data.Answer || []).map((a) => (a.data || '').trim());
  } catch {
    return [];
  }
}

/**
 * 判断域名是否已接入本系统，支持两种方式：
 * 1) CNAME 指向 Worker（传统方式）
 * 2) Worker 自定义域名（Custom Domain）：Cloudflare 会自动生成代理 A/AAAA 记录，不存在 CNAME
 */
async function verifyDomain(domain: string, expectedTarget: string): Promise<VerifyResult> {
  const expected = expectedTarget.replace(/\.$/, '').toLowerCase();

  // 方式一：直接请求站点健康检查接口，返回本系统标识即认为已接入
  try {
    const resp = await fetch(`https://${domain}/api/health`, {
      headers: { Accept: 'application/json' },
      redirect: 'follow',
    });
    if (resp.ok) {
      const data = (await resp.json()) as { status?: string; service?: string };
      if (data.status === 'ok' && data.service === 'short-link-system') {
        return { verified: true, method: 'http', message: '域名验证成功：站点已指向本系统' };
      }
    }
  } catch {
    // 同账号同区域的回环请求可能被 Cloudflare 拦截（1042），继续走 DNS 检测
  }

  // 方式二：检查 CNAME 记录
  const cnames = await dohQuery(domain, 'CNAME');
  if (cnames.length > 0) {
    const hit = cnames.some((value) => {
      const v = value.toLowerCase();
      if (!expected) return true;
      return v.includes(expected) || v.includes('workers.dev');
    });
    if (hit) {
      return { verified: true, method: 'cname', message: '域名验证成功：CNAME 记录已生效' };
    }
  }

  // 方式三：Workers 自定义域名会生成代理 A/AAAA 记录，解析到 Cloudflare 网段即视为已接入
  const addresses = [...(await dohQuery(domain, 'A')), ...(await dohQuery(domain, 'AAAA'))];
  if (addresses.some((ip) => isCloudflareIp(ip))) {
    return {
      verified: true,
      method: 'cloudflare_proxy',
      message: '域名验证成功：已通过 Cloudflare（Workers 自定义域名）接入',
    };
  }

  return {
    verified: false,
    message: '未检测到有效解析：请在 DNS 添加指向 Worker 的 CNAME，或在 Worker → Settings → Domains & Routes 绑定该域名后再验证',
  };
}

// ========== 验证域名 DNS ==========
domains.post('/:id/verify', requireRole('super_admin'), async (c) => {
  const domainId = parseInt(c.req.param('id'));

  const domain = await c.env.DB.prepare('SELECT * FROM domains WHERE id = ?').bind(domainId).first<{ id: number; domain: string }>();
  if (!domain) {
    return jsonResponse({ error: '域名不存在' }, 404);
  }

  const result = await verifyDomain(domain.domain, (c.env.PAGES_DOMAIN || '').trim());

  if (result.verified) {
    await c.env.DB.prepare("UPDATE domains SET status = 'active', updated_at = ? WHERE id = ?")
      .bind(Math.floor(Date.now() / 1000), domainId).run();
    await logAudit(c.env.DB, c.env.KV, c.get('user').user_id, 'verify_domain', c.req.raw, 'domain', domainId, result.method || '');
    return jsonResponse({ success: true, verified: true, method: result.method, message: result.message });
  }

  return jsonResponse({ success: false, verified: false, message: result.message }, 400);
});

// ========== 删除域名 ==========
domains.delete('/:id', requireRole('super_admin'), async (c) => {
  const domainId = parseInt(c.req.param('id'));

  await c.env.DB.prepare('DELETE FROM domains WHERE id = ?').bind(domainId).run();

  await logAudit(c.env.DB, c.env.KV, c.get('user').user_id, 'delete_domain', c.req.raw, 'domain', domainId);

  return jsonResponse({ success: true });
});

export default domains;
