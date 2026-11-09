// 短链跳转路由（公开访问，无需登录）

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import { escapeHtml, getRequestIP, hashIP, normalizeHost, RESERVED_CODES } from '../utils';
import { fetchIndexHtml, serveStatic, HTML_SECURITY_HEADERS } from '../assets';
import { LINK_CACHE_EDGE_TTL, LINK_CACHE_TTL, linkCacheKey } from '../cache';

const redirect = new Hono<{ Bindings: Env }>();

// 保留路径：交给前端 SPA 处理，不作为短码解析（与自定义别名保留字保持一致）
const RESERVED_PATHS = RESERVED_CODES;

// 统一的提示页面
function noticePage(title: string, description: string, status: number): Response {
  const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root{color-scheme:light dark}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;
    background:radial-gradient(circle at 20% 0%,#e8f0ff 0%,#f8fafc 45%,#f1f5f9 100%);color:#0f172a}
  .card{width:100%;max-width:420px;background:#fff;border:1px solid #e6ebf3;border-radius:20px;
    padding:36px 28px;text-align:center;box-shadow:0 24px 60px -30px rgba(15,23,42,.35);
    animation:rise .45s ease-out both}
  .badge{width:56px;height:56px;margin:0 auto 18px;display:flex;align-items:center;justify-content:center;
    border-radius:18px;background:#eff6ff;color:#2563eb}
  h1{margin:0 0 10px;font-size:20px;font-weight:600;letter-spacing:-.01em}
  p{margin:0 0 24px;font-size:14px;line-height:1.7;color:#64748b}
  a.btn{display:inline-flex;align-items:center;justify-content:center;height:42px;padding:0 22px;
    border-radius:12px;background:#2563eb;color:#fff;font-size:14px;font-weight:500;text-decoration:none;
    box-shadow:0 10px 24px -12px rgba(37,99,235,.9);transition:background .2s}
  a.btn:hover{background:#1d4ed8}
  .code{margin-top:22px;font-size:12px;color:#94a3b8;letter-spacing:.18em}
  @keyframes rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
  @media (prefers-color-scheme: dark){
    body{background:radial-gradient(circle at 20% 0%,#111c33 0%,#0b1220 45%,#070b14 100%);color:#e2e8f0}
    .card{background:#101827;border-color:#1e293b;box-shadow:0 24px 60px -30px rgba(0,0,0,.9)}
    .badge{background:rgba(37,99,235,.15);color:#60a5fa}
    p{color:#94a3b8}
    .code{color:#475569}
  }
</style></head>
<body>
  <div class="card">
    <div class="badge">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
        stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 0 1 0 10h-2"/><path d="M8 12h8"/>
      </svg>
    </div>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(description)}</p>
    <a class="btn" href="/">返回首页</a>
    <div class="code">HTTP ${status}</div>
  </div>
</body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

interface ShortLinkRow {
  id: number;
  short_code: string;
  target_url: string;
  status: string;
  redirect_type: number;
  password: string | null;
  expires_at: number | null;
  review_status: string;
  review_note: string | null;
  domain_id: number | null;
  domain_name: string | null;
}

/** 按短码查询候选短链（只取跳转所需字段） */
async function queryCandidates(db: D1Database, code: string): Promise<ShortLinkRow[]> {
  const rows = await db
    .prepare(
      `SELECT sl.id, sl.short_code, sl.target_url, sl.status, sl.redirect_type, sl.password,
              sl.expires_at, sl.review_status, sl.review_note, sl.domain_id, d.domain as domain_name
       FROM short_links sl
       LEFT JOIN domains d ON sl.domain_id = d.id
       WHERE sl.short_code = ?
       LIMIT 10`
    )
    .bind(code)
    .all<ShortLinkRow>();
  return rows.results;
}

type WaitUntilCtx = { waitUntil(promise: Promise<unknown>): void };

/** 读取候选短链：优先走 KV 缓存，未命中再查 D1 并异步回填 */
async function loadCandidates(
  env: Env,
  code: string,
  ctx?: WaitUntilCtx
): Promise<ShortLinkRow[]> {
  const key = linkCacheKey(code);
  try {
    const cached = (await env.KV.get(key, { type: 'json', cacheTtl: LINK_CACHE_EDGE_TTL })) as
      | ShortLinkRow[]
      | null;
    if (Array.isArray(cached) && cached.length > 0) return cached;
  } catch {
    // 缓存异常时回退数据库
  }

  const list = await queryCandidates(env.DB, code);
  // 不缓存空结果，避免新建短链后短时间内仍然 404
  if (list.length > 0) {
    const write = env.KV.put(key, JSON.stringify(list), { expirationTtl: LINK_CACHE_TTL }).catch(
      () => undefined
    );
    if (ctx) ctx.waitUntil(write);
    else await write;
  }
  return list;
}

/**
 * 按短码解析短链：别名在不同域名下相互独立，
 * 优先匹配当前访问域名下的短链，其次是无域名归属的短链。
 */
async function resolveLinkByCode(
  env: Env,
  code: string,
  host: string,
  ctx?: WaitUntilCtx
): Promise<ShortLinkRow | null> {
  const list = await loadCandidates(env, code, ctx);
  if (list.length === 0) return null;

  const target = normalizeHost(host);
  const hostMatched = list.find((l) => l.domain_name && normalizeHost(l.domain_name) === target);
  if (hostMatched) return hostMatched;

  const noDomain = list.find((l) => !l.domain_id);
  if (noDomain) return noDomain;

  // 兼容历史数据：全局唯一时只可能存在一条
  return list.length === 1 ? list[0] : null;
}

/** 密码访问页面（替代原来的 JSON 响应），短链编码由页面脚本从 location 中读取 */
function passwordPage(status = 401): Response {
  const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>请输入访问密码</title>
<style>
  :root{color-scheme:light dark}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;
    background:radial-gradient(circle at 20% 0%,#e8f0ff 0%,#f8fafc 45%,#f1f5f9 100%);color:#0f172a}
  .card{width:100%;max-width:420px;background:#fff;border:1px solid #e6ebf3;border-radius:20px;
    padding:34px 28px;box-shadow:0 24px 60px -30px rgba(15,23,42,.35);animation:rise .4s ease-out both}
  .badge{width:56px;height:56px;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;
    border-radius:18px;background:#eff6ff;color:#2563eb}
  h1{margin:0 0 8px;font-size:19px;font-weight:600;text-align:center;letter-spacing:-.01em}
  p.sub{margin:0 0 22px;font-size:13px;line-height:1.6;color:#64748b;text-align:center}
  label{display:block;font-size:13px;font-weight:500;margin-bottom:8px;color:#334155}
  input{width:100%;height:44px;padding:0 14px;border-radius:12px;border:1px solid #dbe3ee;background:#f8fafc;
    font-size:15px;color:#0f172a;outline:none;transition:border-color .2s,box-shadow .2s}
  input:focus{border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.15);background:#fff}
  button{width:100%;height:44px;margin-top:16px;border:0;border-radius:12px;background:#2563eb;color:#fff;
    font-size:14px;font-weight:500;cursor:pointer;transition:background .2s}
  button:hover:not(:disabled){background:#1d4ed8}
  button:disabled{opacity:.65;cursor:not-allowed}
  .err{margin-top:12px;font-size:13px;color:#dc2626;min-height:18px;text-align:center}
  .code{margin-top:20px;font-size:12px;color:#94a3b8;letter-spacing:.18em;text-align:center}
  @keyframes rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
  @media (prefers-color-scheme: dark){
    body{background:radial-gradient(circle at 20% 0%,#111c33 0%,#0b1220 45%,#070b14 100%);color:#e2e8f0}
    .card{background:#101827;border-color:#1e293b;box-shadow:0 24px 60px -30px rgba(0,0,0,.9)}
    .badge{background:rgba(37,99,235,.15);color:#60a5fa}
    h1{color:#e2e8f0}
    p.sub{color:#94a3b8}
    label{color:#cbd5e1}
    input{background:#0b1220;border-color:#233047;color:#e2e8f0}
    input:focus{background:#0b1220;border-color:#3b82f6}
    .code{color:#475569}
  }
</style></head>
<body>
  <div class="card">
    <div class="badge">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
        stroke-linecap="round" stroke-linejoin="round">
        <rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>
      </svg>
    </div>
    <h1>该短链需要密码访问</h1>
    <p class="sub">请输入访问密码后继续</p>
    <form id="f" autocomplete="off">
      <label for="pwd">访问密码</label>
      <input id="pwd" type="password" name="password" placeholder="请输入密码" autofocus required>
      <button id="btn" type="submit">进入短链</button>
      <div class="err" id="err"></div>
    </form>
    <div class="code">HTTP ${status}</div>
  </div>
  <script>
    (function () {
      var form = document.getElementById('f');
      var input = document.getElementById('pwd');
      var btn = document.getElementById('btn');
      var err = document.getElementById('err');
      var endpoint = location.pathname.replace(/\\/+$/, '') + '/verify-password';

      function fail(msg) {
        err.textContent = msg;
        btn.disabled = false;
      }

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        err.textContent = '';
        var pwd = input.value;
        if (!pwd) { fail('请输入密码'); return; }
        btn.disabled = true;
        fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pwd })
        })
          .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
          .then(function (r) {
            if (r.ok && r.data && r.data.redirect_url) {
              location.replace(r.data.redirect_url);
              return;
            }
            fail((r.data && r.data.error) || '密码错误，请重试');
          })
          .catch(function () { fail('网络异常，请稍后重试'); });
      });
    })();
  </script>
</body></html>`;
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/** 返回前端 SPA 页面（由 React Router 渲染 NotFound），同时保留指定的状态码 */
async function spaPage(c: Context<{ Bindings: Env }>, status: number): Promise<Response> {
  const asset = await fetchIndexHtml(c.env, c.req.url);

  if (asset.status !== 200) {
    return noticePage('短链不存在', '该短链可能已被删除或从未创建', status);
  }

  return new Response(asset.body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      ...HTML_SECURITY_HEADERS,
    },
  });
}

// 短链跳转: GET /{short_code}
redirect.get('/:code', async (c) => {
  const code = c.req.param('code');

  // 保留路径、静态文件（含扩展名）交给前端资源处理
  if (RESERVED_PATHS.has(code) || code.includes('.')) {
    return serveStatic(c);
  }

  // 查询短链（按访问域名解析，别名在不同域名下互不干扰）
  const link = await resolveLinkByCode(c.env, code, new URL(c.req.url).host, c.executionCtx);

  if (!link) {
    // 交由前端 404 页面渲染，保持 404 状态码
    return spaPage(c, 404);
  }

  // 审核状态检查
  if (link.review_status === 'pending') {
    return noticePage('短链审核中', '该短链正在等待管理员审核，审核通过后即可访问', 403);
  }
  if (link.review_status === 'rejected') {
    return noticePage('短链未通过审核', link.review_note ? `原因：${link.review_note}` : '该短链未通过管理员审核', 403);
  }

  // 检查状态
  if (link.status === 'disabled') {
    return noticePage('短链已停用', '该短链已被管理员停用，暂时无法访问', 403);
  }

  // 检查过期
  if (link.expires_at && link.expires_at < Math.floor(Date.now() / 1000)) {
    await c.env.DB.prepare("UPDATE short_links SET status = 'expired' WHERE id = ?").bind(link.id).run();
    return noticePage('短链已过期', '该短链已超过有效期，无法继续访问', 410);
  }

  if (link.status === 'expired') {
    return noticePage('短链已过期', '该短链已超过有效期，无法继续访问', 410);
  }

  // 如果有密码保护，检查密码
  if (link.password) {
    const wantsJson = (c.req.header('Accept') || '').includes('application/json');
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      if (wantsJson) {
        return new Response(JSON.stringify({ require_password: true }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // 浏览器访问：直接渲染密码输入页面
      return passwordPage(401);
    }
    const { verifyPassword } = await import('../utils');
    let password = '';
    try {
      password = decodeURIComponent(atob(authHeader.substring(7)));
    } catch {
      password = '';
    }
    const valid = password ? await verifyPassword(password, link.password) : false;
    if (!valid) {
      if (wantsJson) {
        return new Response(JSON.stringify({ error: '密码错误' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return passwordPage(403);
    }
  }

  // 记录访问日志（异步不阻塞跳转）
  try {
    const cf = c.req.raw.cf as { country?: string; city?: string } | undefined;
    const ip = getRequestIP(c.req.raw);
    const ip_hash = await hashIP(ip, 'access-salt');
    const ua = c.req.header('User-Agent') || null;
    const referer = c.req.header('Referer') || null;

    // 写入访问日志（batch 合并为一次往返，且不阻塞跳转）
    c.executionCtx.waitUntil(
      c.env.DB.batch([
        c.env.DB.prepare(
          'INSERT INTO access_logs (short_link_id, ip, ip_hash, country, city, user_agent, referer) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).bind(link.id, ip, ip_hash, cf?.country || null, cf?.city || null, ua, referer),
        c.env.DB.prepare('UPDATE short_links SET click_count = click_count + 1 WHERE id = ?').bind(link.id),
      ])
    );
  } catch {
    // 日志记录失败不影响跳转
  }

  // 执行跳转（302）
  return Response.redirect(link.target_url, link.redirect_type || 302);
});

// 密码验证页面跳转
redirect.post('/:code/verify-password', async (c) => {
  const code = c.req.param('code');
  const body = await c.req.json<{ password: string }>();

  const link = await resolveLinkByCode(c.env, code, new URL(c.req.url).host, c.executionCtx);

  if (!link || !link.password) {
    return new Response(JSON.stringify({ error: '短链不存在或无需密码' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { verifyPassword } = await import('../utils');
  const valid = await verifyPassword(body.password, link.password);
  if (!valid) {
    return new Response(JSON.stringify({ error: '密码错误' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ redirect_url: link.target_url, redirect_type: link.redirect_type }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});

export default redirect;
