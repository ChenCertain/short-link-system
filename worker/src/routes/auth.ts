// 认证路由：管理员初始化、登录、验证码验证

import { Hono } from 'hono';
import type { Env } from '../types';
import {
  jsonResponse,
  generateVerifyCode,
  hashPassword,
  verifyPassword,
  signJWT,
  getRequestIP,
} from '../utils';
import { logAudit } from '../middleware';
import { getManagedGroupIds, getGlobalPermissions, getGroupPermissions } from '../permissions';

const auth = new Hono<{ Bindings: Env }>();

// 是否启用了 Turnstile：未配置或仍是模板占位符时视为未启用，自动跳过人机验证
function turnstileEnabled(env: Env): boolean {
  const secret = (env.TURNSTILE_SECRET_KEY || '').trim();
  return secret !== '' && !secret.startsWith('REPLACE_WITH');
}

// 返回给前端渲染的 Site Key，占位符或空值时返回空串（前端不渲染组件）
function turnstileSiteKey(env: Env): string {
  const key = (env.TURNSTILE_SITE_KEY || '').trim();
  return key.startsWith('REPLACE_WITH') ? '' : key;
}

// Turnstile 验证
async function verifyTurnstile(token: string, secret: string): Promise<boolean> {
  const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      secret,
      response: token,
    }),
  });
  const data = (await resp.json()) as { success?: boolean };
  return data.success === true;
}

// ========== 系统初始化状态检查 ==========
auth.get('/init-status', async (c) => {
  const result = await c.env.DB.prepare(
    "SELECT value FROM system_config WHERE key = 'initialized'"
  ).first<{ value: string }>();
  const initialized = result?.value === 'true';
  const siteNameResult = await c.env.DB.prepare(
    "SELECT value FROM system_config WHERE key = 'site_name'"
  ).first<{ value: string }>();
  return jsonResponse({
    initialized,
    site_name: siteNameResult?.value || '短链管理系统',
    turnstile_site_key: turnstileSiteKey(c.env),
  });
});

// ========== 管理员初始化 ==========
auth.post('/init', async (c) => {
  // 检查是否已初始化
  const result = await c.env.DB.prepare(
    "SELECT value FROM system_config WHERE key = 'initialized'"
  ).first<{ value: string }>();
  if (result?.value === 'true') {
    return jsonResponse({ error: '系统已初始化' }, 400);
  }

  const body = await c.req.json<{
    email: string;
    password: string;
    name: string;
    turnstile_token: string;
    verify_code: string;
  }>();

  if (!body.email || !body.password || !body.name || !body.verify_code) {
    return jsonResponse({ error: '请填写所有必填字段' }, 400);
  }

  if (body.password.length < 8) {
    return jsonResponse({ error: '密码长度至少 8 位' }, 400);
  }

  // Turnstile 验证（未启用时自动跳过）
  if (turnstileEnabled(c.env)) {
    if (!body.turnstile_token) {
      return jsonResponse({ error: '请完成人机验证' }, 400);
    }
    const turnstileValid = await verifyTurnstile(body.turnstile_token, c.env.TURNSTILE_SECRET_KEY);
    if (!turnstileValid) {
      return jsonResponse({ error: '人机验证失败' }, 400);
    }
  }

  // 验证码验证
  const codeRecord = await c.env.DB.prepare(
    "SELECT * FROM verification_codes WHERE email = ? AND purpose = 'init_admin' AND used = 0 AND expires_at > ? ORDER BY created_at DESC LIMIT 1"
  ).bind(body.email, Math.floor(Date.now() / 1000)).first<{
    id: number;
    code: string;
  }>();

  if (!codeRecord || codeRecord.code !== body.verify_code) {
    return jsonResponse({ error: '验证码错误或已过期' }, 400);
  }

  // 标记验证码已使用
  await c.env.DB.prepare('UPDATE verification_codes SET used = 1 WHERE id = ?').bind(codeRecord.id).run();

  // 创建管理员账户：初始化时创建的这个超级管理员是「最高权限账户」（is_root = 1）
  const passwordHash = await hashPassword(body.password);
  let userId: number;
  try {
    const created = await c.env.DB.prepare(
      'INSERT INTO users (email, password_hash, name, role, status, is_root) VALUES (?, ?, ?, ?, ?, 1)'
    ).bind(body.email, passwordHash, body.name, 'super_admin', 'active').run();
    userId = Number(created.meta.last_row_id);
  } catch {
    // 迁移 0009 未执行时降级
    const created = await c.env.DB.prepare(
      'INSERT INTO users (email, password_hash, name, role, status) VALUES (?, ?, ?, ?, ?)'
    ).bind(body.email, passwordHash, body.name, 'super_admin', 'active').run();
    userId = Number(created.meta.last_row_id);
  }

  // 标记系统已初始化
  await c.env.DB.prepare(
    "UPDATE system_config SET value = 'true', updated_at = ? WHERE key = 'initialized'"
  ).bind(Math.floor(Date.now() / 1000)).run();

  // 记录审计日志
  await logAudit(c.env.DB, userId as number, 'init_admin', c.req.raw, 'system', undefined, JSON.stringify({ email: body.email }));

  // 签发 JWT
  const token = await signJWT(
    { user_id: userId as number, email: body.email, role: 'super_admin' },
    c.env.JWT_SECRET
  );

  return jsonResponse({
    success: true,
    token,
    user: { id: userId, email: body.email, name: body.name, role: 'super_admin', is_root: true },
  });
});

// ========== 发送验证码 ==========
auth.post('/send-code', async (c) => {
  const body = await c.req.json<{
    email: string;
    purpose?: 'login' | 'init_admin' | 'set_password';
    turnstile_token: string;
    password?: string;
  }>();

  if (!body.email) {
    return jsonResponse({ error: '请输入邮箱' }, 400);
  }

  const purpose = body.purpose || 'login';

  // Turnstile 验证（未启用时自动跳过）
  if (turnstileEnabled(c.env)) {
    if (!body.turnstile_token) {
      return jsonResponse({ error: '请完成人机验证' }, 400);
    }
    const turnstileValid = await verifyTurnstile(body.turnstile_token, c.env.TURNSTILE_SECRET_KEY);
    if (!turnstileValid) {
      return jsonResponse({ error: '人机验证失败' }, 400);
    }
  }

  // 初始化场景：检查系统是否已初始化
  if (purpose === 'init_admin') {
    const initResult = await c.env.DB.prepare(
      "SELECT value FROM system_config WHERE key = 'initialized'"
    ).first<{ value: string }>();
    if (initResult?.value === 'true') {
      return jsonResponse({ error: '系统已初始化' }, 400);
    }
  } else if (purpose === 'set_password') {
    // 首次设置密码场景：账户必须存在且尚未设置密码
    const user = await c.env.DB.prepare(
      'SELECT id, password_hash, status FROM users WHERE email = ?'
    ).bind(body.email).first<{ id: number; password_hash: string | null; status: string }>();

    if (!user) {
      return jsonResponse({ error: '账户不存在，请联系管理员开通' }, 400);
    }
    if (user.status === 'disabled') {
      return jsonResponse({ error: '账户已被禁用' }, 403);
    }
    if (user.password_hash) {
      return jsonResponse({ error: '该账户已设置密码，请直接登录', code: 'PASSWORD_ALREADY_SET' }, 400);
    }
  } else {
    // 登录场景：验证邮箱+密码
    if (!body.password) {
      return jsonResponse({ error: '请输入密码' }, 400);
    }
    const user = await c.env.DB.prepare(
      'SELECT * FROM users WHERE email = ?'
    ).bind(body.email).first<{ id: number; password_hash: string; status: string }>();

    if (!user) {
      return jsonResponse({ error: '账户不存在' }, 400);
    }
    if (user.status === 'disabled') {
      return jsonResponse({ error: '账户已被禁用' }, 403);
    }
    if (!user.password_hash) {
      return jsonResponse(
        { error: '该账户尚未设置密码，请先在登录页设置密码', code: 'PASSWORD_NOT_SET' },
        400
      );
    }
    const passwordValid = await verifyPassword(body.password, user.password_hash);
    if (!passwordValid) {
      return jsonResponse({ error: '邮箱或密码错误' }, 400);
    }
  }

  // 限流：同一邮箱 60 秒内只能发送一次
  const rateKey = `rate:sendcode:${body.email}`;
  const rateLimited = await c.env.KV.get(rateKey);
  if (rateLimited) {
    return jsonResponse({ error: '验证码发送过于频繁，请 60 秒后重试' }, 429);
  }

  // 生成验证码
  const code = generateVerifyCode();
  const expiresAt = Math.floor(Date.now() / 1000) + 600; // 10分钟过期

  // 存入数据库
  await c.env.DB.prepare(
    'INSERT INTO verification_codes (email, code, purpose, expires_at) VALUES (?, ?, ?, ?)'
  ).bind(body.email, code, purpose, expiresAt).run();

  // 设置限流
  await c.env.KV.put(rateKey, '1', { expirationTtl: 60 });

  // 发送邮件
  const { sendVerificationEmail, isSmtpConfigured } = await import('../services/email');
  const sent = await sendVerificationEmail(
    body.email,
    code,
    c.env,
    purpose === 'set_password' ? '短链接管理系统 - 设置登录密码' : undefined
  );
  if (!sent) {
    return jsonResponse({ error: '邮件发送失败，请稍后重试' }, 500);
  }

  // 仅在「本机访问 + 未配置 SMTP」时把验证码一并返回，方便本地调试；线上永远不会返回
  const host = new URL(c.req.url).hostname;
  const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  const devMode = !isSmtpConfigured(c.env) && isLocalhost;
  return jsonResponse({
    success: true,
    message: devMode ? '本地调试模式：验证码已自动填充' : '验证码已发送至邮箱',
    ...(devMode ? { dev_code: code } : {}),
  });
});

// ========== 登录验证 ==========
auth.post('/verify-login', async (c) => {
  const body = await c.req.json<{
    email: string;
    password: string;
    verify_code: string;
  }>();

  if (!body.email || !body.password || !body.verify_code) {
    return jsonResponse({ error: '请填写所有必填字段' }, 400);
  }

  // 验证用户
  const user = await c.env.DB.prepare(
    'SELECT * FROM users WHERE email = ?'
  ).bind(body.email).first<{
    id: number;
    email: string;
    password_hash: string;
    name: string;
    role: string;
    status: string;
    is_root?: number;
  }>();

  if (!user) {
    return jsonResponse({ error: '账户不存在' }, 400);
  }
  if (user.status === 'disabled') {
    return jsonResponse({ error: '账户已被禁用' }, 403);
  }

  if (!user.password_hash) {
    return jsonResponse(
      { error: '该账户尚未设置密码，请先在登录页设置密码', code: 'PASSWORD_NOT_SET' },
      400
    );
  }

  const passwordValid = await verifyPassword(body.password, user.password_hash);
  if (!passwordValid) {
    return jsonResponse({ error: '邮箱或密码错误' }, 400);
  }

  // 验证码验证
  const codeRecord = await c.env.DB.prepare(
    "SELECT * FROM verification_codes WHERE email = ? AND purpose = 'login' AND used = 0 AND expires_at > ? ORDER BY created_at DESC LIMIT 1"
  ).bind(body.email, Math.floor(Date.now() / 1000)).first<{ id: number; code: string }>();

  if (!codeRecord || codeRecord.code !== body.verify_code) {
    return jsonResponse({ error: '验证码错误或已过期' }, 400);
  }

  // 标记验证码已使用
  await c.env.DB.prepare('UPDATE verification_codes SET used = 1 WHERE id = ?').bind(codeRecord.id).run();

  // 记录最后登录时间与登录 IP
  const loginIp = getRequestIP(c.req.raw);
  const loginAt = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(
    'UPDATE users SET last_login_at = ?, last_login_ip = ?, updated_at = ? WHERE id = ?'
  ).bind(loginAt, loginIp, loginAt, user.id).run();

  // 签发 JWT（历史 project_admin 角色统一按 user 处理）
  const role = user.role === 'super_admin' ? 'super_admin' : 'user';
  const token = await signJWT(
    { user_id: user.id, email: user.email, role },
    c.env.JWT_SECRET
  );

  // 记录审计日志（IP / 归属地由审计表独立列承载，详情里不再重复记录 IP）
  await logAudit(c.env.DB, user.id, 'login', c.req.raw, undefined, undefined);

  // 管理中的项目组（登录后立即用于前端菜单权限渲染）
  const managedGroupIds = role === 'super_admin' ? [] : await getManagedGroupIds(c.env.DB, user.id);

  return jsonResponse({
    success: true,
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role,
      status: user.status,
      is_root: Number(user.is_root || 0) === 1,
      managed_group_ids: managedGroupIds,
    },
  });
});

// ========== 首次设置密码 ==========
// 管理员创建用户时可以不填密码，用户凭邮箱验证码在这里自行设置密码并直接登录
auth.post('/setup-password', async (c) => {
  const body = await c.req.json<{
    email: string;
    password: string;
    verify_code: string;
  }>();

  if (!body.email || !body.password || !body.verify_code) {
    return jsonResponse({ error: '请填写所有必填字段' }, 400);
  }
  if (body.password.length < 8) {
    return jsonResponse({ error: '密码长度至少 8 位' }, 400);
  }

  const user = await c.env.DB.prepare(
    'SELECT * FROM users WHERE email = ?'
  ).bind(body.email).first<{
    id: number;
    email: string;
    password_hash: string | null;
    name: string;
    role: string;
    status: string;
    is_root?: number;
  }>();

  if (!user) {
    return jsonResponse({ error: '账户不存在，请联系管理员开通' }, 400);
  }
  if (user.status === 'disabled') {
    return jsonResponse({ error: '账户已被禁用' }, 403);
  }
  if (user.password_hash) {
    return jsonResponse({ error: '该账户已设置密码，请直接登录', code: 'PASSWORD_ALREADY_SET' }, 400);
  }

  const codeRecord = await c.env.DB.prepare(
    "SELECT id, code FROM verification_codes WHERE email = ? AND purpose = 'set_password' AND used = 0 AND expires_at > ? ORDER BY created_at DESC LIMIT 1"
  ).bind(body.email, Math.floor(Date.now() / 1000)).first<{ id: number; code: string }>();

  if (!codeRecord || codeRecord.code !== body.verify_code) {
    return jsonResponse({ error: '验证码错误或已过期' }, 400);
  }

  await c.env.DB.prepare('UPDATE verification_codes SET used = 1 WHERE id = ?').bind(codeRecord.id).run();

  const passwordHash = await hashPassword(body.password);
  const loginIp = getRequestIP(c.req.raw);
  const loginAt = Math.floor(Date.now() / 1000);

  await c.env.DB.prepare(
    'UPDATE users SET password_hash = ?, last_login_at = ?, last_login_ip = ?, updated_at = ? WHERE id = ?'
  ).bind(passwordHash, loginAt, loginIp, loginAt, user.id).run();

  const role = user.role === 'super_admin' ? 'super_admin' : 'user';
  const token = await signJWT({ user_id: user.id, email: user.email, role }, c.env.JWT_SECRET);

  await logAudit(c.env.DB, user.id, 'setup_password', c.req.raw, 'user', user.id);

  const managedGroupIds = role === 'super_admin' ? [] : await getManagedGroupIds(c.env.DB, user.id);

  return jsonResponse({
    success: true,
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role,
      status: user.status,
      is_root: Number(user.is_root || 0) === 1,
      managed_group_ids: managedGroupIds,
    },
  });
});

// ========== 获取当前用户信息 ==========
auth.get('/me', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return jsonResponse({ error: '未登录' }, 401);
  }
  const { verifyJWT, assertJwtSecret } = await import('../utils');
  try {
    assertJwtSecret(c.env.JWT_SECRET);
  } catch {
    return jsonResponse({ error: '服务端未正确配置 JWT_SECRET，暂时无法提供服务' }, 500);
  }
  const token = authHeader.substring(7);
  const payload = await verifyJWT(token, c.env.JWT_SECRET);
  if (!payload) {
    return jsonResponse({ error: '登录已过期' }, 401);
  }

  const meSql = `SELECT id, email, name, role, status, require_review, review_by, last_login_at, last_login_ip, created_at, is_root
     FROM users WHERE id = ?`;
  let user: { id: number; role: string; status: string; is_root?: number } | null = null;
  try {
    user = await c.env.DB.prepare(meSql)
      .bind(payload.user_id)
      .first<{ id: number; role: string; status: string; is_root?: number }>();
  } catch {
    // 迁移 0009 未执行时降级
    user = await c.env.DB.prepare(meSql.replace(', is_root', ', 0 AS is_root'))
      .bind(payload.user_id)
      .first<{ id: number; role: string; status: string; is_root?: number }>();
  }

  if (!user) {
    return jsonResponse({ error: '用户不存在' }, 404);
  }
  if (user.status === 'disabled') {
    return jsonResponse({ error: '账户已被禁用' }, 403);
  }

  // 管理中的项目组（含作为组管理员的组），供前端决定可见菜单
  const managedGroupIds = await getManagedGroupIds(c.env.DB, user.id);
  // 全局权限（用户管理 / 操作审计等由超级管理员逐人配置）
  const globalPermissions = await getGlobalPermissions(c.env.DB, user.id);

  // 各项目组内的有效权限（用于前端按钮级门控）
  const relations = await c.env.DB.prepare(
    'SELECT group_id FROM user_group_relations WHERE user_id = ?'
  ).bind(user.id).all<{ group_id: number }>();
  const groupPermissions: Record<string, Record<string, boolean>> = {};
  for (const relation of relations.results) {
    groupPermissions[String(relation.group_id)] = await getGroupPermissions(c.env.DB, user.id, relation.group_id);
  }
  for (const managedId of managedGroupIds) {
    if (!groupPermissions[String(managedId)]) {
      groupPermissions[String(managedId)] = await getGroupPermissions(c.env.DB, user.id, managedId);
    }
  }

  return jsonResponse({
    user: {
      ...user,
      role: user.role === 'super_admin' ? 'super_admin' : 'user',
      is_root: Number(user.is_root || 0) === 1,
      managed_group_ids: managedGroupIds,
      permissions: { global: globalPermissions, groups: groupPermissions },
    },
  });
});

export default auth;
