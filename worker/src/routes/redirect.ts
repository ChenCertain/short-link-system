// 短链跳转路由（公开访问，无需登录）

import { Hono } from 'hono';
import type { Env } from '../types';
import { getRequestIP, hashIP } from '../utils';

const redirect = new Hono<{ Bindings: Env }>();

// 保留路径：交给前端 SPA 处理，不作为短码解析
const RESERVED_PATHS = new Set(['login', 'init', 'dashboard', 'api', 'assets']);

// 统一的提示页面
function noticePage(title: string, description: string, status: number): Response {
  return new Response(
    `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f9fafb;color:#111827">
<div style="text-align:center"><h1 style="font-size:22px;margin:0 0 8px">${title}</h1>
<p style="color:#6b7280;font-size:14px;margin:0 0 20px">${description}</p>
<a href="/" style="color:#2563eb;font-size:14px;text-decoration:none">返回首页</a></div></body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

// 短链跳转: GET /{short_code}
redirect.get('/:code', async (c) => {
  const code = c.req.param('code');

  // 保留路径、静态文件（含扩展名）交给前端资源处理
  if (RESERVED_PATHS.has(code) || code.includes('.')) {
    const asset = await c.env.ASSETS.fetch(c.req.raw);
    if (asset.status === 404 && (c.req.header('Accept') || '').includes('text/html')) {
      const url = new URL(c.req.url);
      url.pathname = '/index.html';
      return c.env.ASSETS.fetch(new Request(url.toString(), { headers: { Accept: 'text/html' } }));
    }
    return asset;
  }

  // 查询短链
  const link = await c.env.DB.prepare(
    `SELECT sl.*, d.domain as domain_name FROM short_links sl
     LEFT JOIN domains d ON sl.domain_id = d.id
     WHERE sl.short_code = ?`
  ).bind(code).first<{
    id: number;
    target_url: string;
    status: string;
    redirect_type: number;
    password: string | null;
    expires_at: number | null;
    review_status: string;
    review_note: string | null;
  }>();

  if (!link) {
    return noticePage('短链不存在', '该短链可能已被删除或从未创建', 404);
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
    return new Response('此短链已被停用', { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  // 检查过期
  if (link.expires_at && link.expires_at < Math.floor(Date.now() / 1000)) {
    await c.env.DB.prepare("UPDATE short_links SET status = 'expired' WHERE id = ?").bind(link.id).run();
    return new Response('此短链已过期', { status: 410, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  if (link.status === 'expired') {
    return new Response('此短链已过期', { status: 410, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  // 如果有密码保护，检查密码
  if (link.password) {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ require_password: true }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
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
      return new Response(JSON.stringify({ error: '密码错误' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // 记录访问日志（异步不阻塞跳转）
  try {
    const cf = c.req.raw.cf as { country?: string; city?: string } | undefined;
    const ip = getRequestIP(c.req.raw);
    const ip_hash = await hashIP(ip, 'access-salt');
    const ua = c.req.header('User-Agent') || null;
    const referer = c.req.header('Referer') || null;

    // 写入访问日志
    c.executionCtx.waitUntil(
      Promise.all([
        c.env.DB.prepare(
          'INSERT INTO access_logs (short_link_id, ip, ip_hash, country, city, user_agent, referer) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).bind(link.id, ip, ip_hash, cf?.country || null, cf?.city || null, ua, referer).run(),
        c.env.DB.prepare('UPDATE short_links SET click_count = click_count + 1 WHERE id = ?').bind(link.id).run(),
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

  const link = await c.env.DB.prepare(
    'SELECT password, target_url, redirect_type FROM short_links WHERE short_code = ?'
  ).bind(code).first<{ password: string; target_url: string; redirect_type: number }>();

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
