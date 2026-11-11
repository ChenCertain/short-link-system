// 域名管理路由

import { Hono } from 'hono';
import type { Env, JWTPayload } from '../types';
import { jsonResponse, normalizeHost } from '../utils';
import { authMiddleware, requireRole, logAudit } from '../middleware';
import { getVisibleGroupIds, isGroupVisibleToUser } from '../permissions';
import { invalidateLinkCache } from '../cache';

const domains = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();

domains.use('*', authMiddleware);

// ========== 获取域名列表（仅超级管理员，项目组域名在项目组详情中查看） ==========
domains.get('/', requireRole('super_admin'), async (c) => {
  const allDomains = await c.env.DB.prepare(
    `SELECT d.*, u.email as added_by_email FROM domains d JOIN users u ON d.added_by = u.id ORDER BY d.created_at DESC`
  ).all();
  return jsonResponse({ domains: allDomains.results });
});

// ========== 获取可用短链域名（按权限范围返回） ==========
domains.get('/short-link-domains', async (c) => {
  const user = c.get('user');
  const groupIdParam = c.req.query('groupId');

  // 超级管理员：平台全部可用短链域名
  if (user.role === 'super_admin') {
    const list = await c.env.DB.prepare(
      "SELECT id, domain, is_default_short_link FROM domains WHERE type IN ('short_link', 'both') AND status = 'active' ORDER BY is_default_short_link DESC, domain ASC"
    ).all();
    return jsonResponse({ domains: list.results });
  }

  // 普通用户：仅所在项目组（含子组）绑定的域名；未绑定则为空
  let groupIds: number[];
  const groupId = groupIdParam ? parseInt(groupIdParam) : NaN;
  if (!Number.isNaN(groupId)) {
    if (!(await isGroupVisibleToUser(c.env.DB, user.user_id, groupId))) {
      return jsonResponse({ domains: [] });
    }
    groupIds = [groupId];
  } else {
    groupIds = await getVisibleGroupIds(c.env.DB, user.user_id);
  }

  if (groupIds.length === 0) {
    return jsonResponse({ domains: [] });
  }

  const list = await c.env.DB.prepare(
    `SELECT DISTINCT d.id, d.domain, d.is_default_short_link FROM domains d
     JOIN group_domain_relations gdr ON gdr.domain_id = d.id
     WHERE gdr.group_id IN (${groupIds.map(() => '?').join(',')})
       AND d.type IN ('short_link', 'both') AND d.status = 'active'
     ORDER BY d.is_default_short_link DESC, d.domain ASC`
  ).bind(...groupIds).all();

  return jsonResponse({ domains: list.results });
});

// ========== 本实例的 CNAME 目标地址 ==========

/**
 * 推断本 Worker 的 workers.dev 主机名，作为用户需要配置的 CNAME 目标：
 * 1) 环境变量 WORKER_HOST
 * 2) 环境变量 PAGES_DOMAIN（仅当其本身是 workers.dev 域名）
 * 3) 当前请求所在的 workers.dev 域名
 */
async function resolveWorkerHost(c: { env: Env; req: { url: string } }): Promise<string> {
  const configured = normalizeHost(c.env.WORKER_HOST || '');
  if (configured) return configured;

  const pagesDomain = normalizeHost(c.env.PAGES_DOMAIN || '');
  if (pagesDomain.endsWith('.workers.dev')) return pagesDomain;

  const current = normalizeHost(new URL(c.req.url).hostname);
  if (current.endsWith('.workers.dev')) return current;

  return '';
}

// 获取 CNAME 目标地址（前端直接展示，无需用户自己去 Worker 后台查看）
domains.get('/worker-host', async (c) => {
  const host = await resolveWorkerHost(c);
  return jsonResponse({ host, available: !!host });
});

// ========== 添加域名 ==========
domains.post('/', requireRole('super_admin'), async (c) => {
  const body = await c.req.json<{
    domain: string;
    type: 'short_link' | 'admin' | 'both';
    is_default_short_link?: boolean;
  }>();

  if (typeof body.domain !== 'string' || !body.domain.trim()) {
    return jsonResponse({ error: '请填写域名' }, 400);
  }
  if (body.type !== undefined && !['short_link', 'admin', 'both'].includes(body.type)) {
    return jsonResponse({ error: '域名类型不正确' }, 400);
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

  const type: 'short_link' | 'admin' | 'both' = body.type ?? 'both';
  if (type === 'admin' && body.is_default_short_link) {
    return jsonResponse({ error: '管理域名不能设为默认短链域名' }, 400);
  }

  const result = await c.env.DB.prepare(
    'INSERT INTO domains (domain, type, is_default_short_link, status, added_by) VALUES (?, ?, ?, ?, ?)'
  ).bind(domain, type, body.is_default_short_link ? 1 : 0, 'pending_verification', c.get('user').user_id).run();

  const domainId = result.meta.last_row_id;

  // 如果设为默认，取消其他默认
  if (body.is_default_short_link) {
    await c.env.DB.prepare('UPDATE domains SET is_default_short_link = 0 WHERE id != ?').bind(domainId).run();
  }

  await logAudit(c.env.DB, c.get('user').user_id, 'add_domain', c.req.raw, 'domain', domainId as number, JSON.stringify(body));

  // 返回需要配置的 DNS 记录（CNAME 目标自动取本 Worker 的 workers.dev 域名）
  const workerHost = await resolveWorkerHost(c);
  const hostedOnCloudflare = await isCloudflareHosted(domain);
  return jsonResponse({
    success: true,
    id: domainId,
    domain,
    hosted_on_cloudflare: hostedOnCloudflare,
    dns_config: {
      type: 'CNAME',
      name: domain,
      target: workerHost,
      instructions: hostedOnCloudflare
        ? `推荐方式：在 Worker → Settings → Domains & Routes 直接绑定该域名（Cloudflare 自动生成记录与证书），绑定后点击验证。\n也可手动在 Cloudflare DNS 添加 CNAME：${domain} → ${workerHost || '（本 Worker 的 workers.dev 域名）'}。`
        : `该域名未托管在 Cloudflare（NS 不指向 Cloudflare）：\n① 推荐把域名的 NS 记录迁移到 Cloudflare，然后在 Worker → Settings → Domains & Routes 绑定该域名；\n② 或在第三方 DNS 添加 CNAME：${domain} → ${workerHost || '（本 Worker 的 workers.dev 域名）'}，但 Cloudflare 无法为该域名签发证书，通常无法以 HTTPS 打开（需使用 Cloudflare for SaaS）；\n③ 也可以继续用第三方 CDN 回源到该地址。`,
    },
  }, 201);
});

// ========== 更新域名 ==========
domains.put('/:id', requireRole('super_admin'), async (c) => {
  const domainId = parseInt(c.req.param('id'));
  if (!Number.isFinite(domainId)) return jsonResponse({ error: '无效的域名 ID' }, 400);
  const body = await c.req.json<{
    type?: 'short_link' | 'admin' | 'both';
    is_default_short_link?: boolean;
    status?: 'active' | 'disabled' | 'pending_verification';
  }>();

  if (body.type !== undefined && !['short_link', 'admin', 'both'].includes(body.type)) {
    return jsonResponse({ error: '域名类型不正确' }, 400);
  }
  if (body.status !== undefined && !['active', 'disabled', 'pending_verification'].includes(body.status)) {
    return jsonResponse({ error: '域名状态不正确' }, 400);
  }

  const domain = await c.env.DB.prepare('SELECT * FROM domains WHERE id = ?')
    .bind(domainId)
    .first<{ id: number; type: string; status: string; is_default_short_link: number }>();
  if (!domain) {
    return jsonResponse({ error: '域名不存在' }, 404);
  }

  const nextType = body.type ?? domain.type;
  const nextStatus = body.status ?? domain.status;
  if (body.is_default_short_link === true) {
    if (nextType === 'admin') {
      return jsonResponse({ error: '管理域名不能设为默认短链域名' }, 400);
    }
    if (nextStatus !== 'active') {
      return jsonResponse({ error: '只有已验证启用的域名才能设为默认短链域名' }, 400);
    }
  }

  const updates: string[] = [];
  const params: (string | number)[] = [];

  if (body.type !== undefined) { updates.push('type = ?'); params.push(body.type); }
  if (body.status !== undefined) { updates.push('status = ?'); params.push(body.status); }
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

  // 域名停用 / 类型变更会直接影响跳转，必须清掉该域名下所有短链的缓存
  const affectsRouting = (body.status !== undefined && body.status !== domain.status)
    || (body.type !== undefined && body.type !== domain.type);
  if (affectsRouting) {
    const affected = await c.env.DB.prepare('SELECT short_code FROM short_links WHERE domain_id = ?')
      .bind(domainId)
      .all<{ short_code: string }>();
    if (affected.results.length > 0) {
      c.executionCtx.waitUntil(
        invalidateLinkCache(c.env, ...affected.results.map((row) => row.short_code)),
      );
    }
  }

  await logAudit(c.env.DB, c.get('user').user_id, 'update_domain', c.req.raw, 'domain', domainId, JSON.stringify(body));

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

async function dohQuery(name: string, type: 'A' | 'AAAA' | 'CNAME' | 'NS'): Promise<string[]> {
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
 * 判断域名是否由 Cloudflare 托管 DNS（NS 指向 *.ns.cloudflare.com）。
 * 子域本身可能没有 NS 记录（或返回被展平的 CNAME），逐级向上查找所属 zone。
 */
async function isCloudflareHosted(domain: string): Promise<boolean> {
  const labels = domain.split('.');
  for (let i = 0; i <= labels.length - 2; i++) {
    const zone = labels.slice(i).join('.');
    const records = (await dohQuery(zone, 'NS'))
      // 排除被 DNS 展平的 CNAME 目标（不是真实的 NS）
      .filter((r) => !r.toLowerCase().includes('workers.dev'));
    if (records.length > 0) {
      return records.some((ns) => /\.ns\.cloudflare\.com\.?$/i.test(ns.trim()));
    }
  }
  return false;
}

/** 探测域名是否可以正常打开本系统（HTTP 可达 + 返回本系统标识） */
async function probeSite(domain: string): Promise<boolean> {
  try {
    const resp = await fetch(`https://${domain}/api/health`, {
      headers: { Accept: 'application/json' },
      redirect: 'follow',
    });
    if (!resp.ok) return false;
    const data = (await resp.json()) as { status?: string; service?: string };
    return data.status === 'ok' && data.service === 'short-link-system';
  } catch {
    // 同账号同区域的回环请求可能被 Cloudflare 拦截（1042）
    return false;
  }
}

/**
 * 判断域名是否已接入本系统，支持两种方式：
 * 1) CNAME 指向 Worker（要求站点可访问：第三方 DNS 直接 CNAME 到 workers.dev 无法签发证书）
 * 2) Worker 自定义域名（Custom Domain）：Cloudflare 会自动生成代理 A/AAAA 记录，不存在 CNAME
 */
async function verifyDomain(domain: string, expectedTarget: string): Promise<VerifyResult> {
  const expected = expectedTarget.replace(/\.$/, '').toLowerCase();

  // 方式一：直接请求站点健康检查接口，返回本系统标识即认为已接入
  if (await probeSite(domain)) {
    return { verified: true, method: 'http', message: '域名验证成功：站点已指向本系统' };
  }

  const cnames = await dohQuery(domain, 'CNAME');
  if (cnames.length > 0) {
    const pointsToWorker = cnames.some((value) => {
      const v = value.toLowerCase();
      // workers.dev：本 Worker 地址；cdn.cloudflare.net：Cloudflare for SaaS 的接入端点
      if (!expected) return v.includes('workers.dev') || v.includes('cdn.cloudflare.net');
      return v.includes(expected) || v.includes('workers.dev') || v.includes('cdn.cloudflare.net');
    });

    if (!pointsToWorker) {
      return {
        verified: false,
        message: `CNAME 当前指向 ${cnames[0]}，未指向本系统（应指向 ${expected || '本 Worker 的 workers.dev 域名'}）`,
      };
    }

    // CNAME 已指向本 Worker，但站点打不开：多为域名 DNS 不在 Cloudflare 托管
    const hosted = await isCloudflareHosted(domain);
    return {
      verified: false,
      message: hosted
        ? 'CNAME 已生效，但站点暂不可访问：若刚修改解析请等待几分钟后重试；也可改用在 Worker → Settings → Domains & Routes 绑定该域名。'
        : `CNAME 已指向本 Worker，但 HTTPS 无法访问：该域名的 DNS 不在 Cloudflare 托管，Cloudflare 无法为其签发证书（不支持第三方 DNS 直接 CNAME 到 workers.dev）。请把域名 NS 迁移到 Cloudflare 后绑定，或使用 Cloudflare for SaaS。`,
    };
  }

  // 方式二：Workers 自定义域名会生成代理 A/AAAA 记录，解析到 Cloudflare 网段即视为已接入
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
    message: '未检测到有效解析：请在 DNS 添加指向本实例 workers.dev 的 CNAME，或在 Worker → Settings → Domains & Routes 绑定该域名后再验证',
  };
}

// ========== 验证域名 DNS ==========
domains.post('/:id/verify', requireRole('super_admin'), async (c) => {
  const domainId = parseInt(c.req.param('id'));
  if (!Number.isFinite(domainId)) return jsonResponse({ error: '无效的域名 ID' }, 400);

  const domain = await c.env.DB.prepare('SELECT * FROM domains WHERE id = ?').bind(domainId).first<{ id: number; domain: string }>();
  if (!domain) {
    return jsonResponse({ error: '域名不存在' }, 404);
  }

  const workerHost = await resolveWorkerHost(c);
  const result = await verifyDomain(domain.domain, workerHost);

  if (result.verified) {
    await c.env.DB.prepare("UPDATE domains SET status = 'active', updated_at = ? WHERE id = ?")
      .bind(Math.floor(Date.now() / 1000), domainId).run();
    await logAudit(c.env.DB, c.get('user').user_id, 'verify_domain', c.req.raw, 'domain', domainId, result.method || '');
    return jsonResponse({ success: true, verified: true, method: result.method, message: result.message });
  }

  return jsonResponse({
    success: false,
    verified: false,
    message: result.message,
    worker_host: workerHost,
    hosted_on_cloudflare: await isCloudflareHosted(domain.domain),
  }, 400);
});

// ========== 删除域名 ==========
domains.delete('/:id', requireRole('super_admin'), async (c) => {
  const domainId = parseInt(c.req.param('id'));
  if (!Number.isFinite(domainId)) return jsonResponse({ error: '无效的域名 ID' }, 400);

  const existing = await c.env.DB.prepare('SELECT id FROM domains WHERE id = ?').bind(domainId).first();
  if (!existing) return jsonResponse({ error: '域名不存在' }, 404);

  // 删除前取出受影响的短码，用于清理跳转缓存
  const affected = await c.env.DB.prepare('SELECT short_code FROM short_links WHERE domain_id = ?')
    .bind(domainId)
    .all<{ short_code: string }>();

  await c.env.DB.prepare('DELETE FROM domains WHERE id = ?').bind(domainId).run();

  if (affected.results.length > 0) {
    c.executionCtx.waitUntil(
      invalidateLinkCache(c.env, ...affected.results.map((row) => row.short_code))
    );
  }

  await logAudit(c.env.DB, c.get('user').user_id, 'delete_domain', c.req.raw, 'domain', domainId);

  return jsonResponse({ success: true });
});

export default domains;
