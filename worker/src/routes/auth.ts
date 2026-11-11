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
import { getManagedGroupIds, getGlobalPermissions, getGroupPermissionsForGroups } from '../permissions';
import {
  rateLimitConfig,
  getRateLimit,
  incrementRateLimit,
  clearRateLimit,
  authFailKey,
  sendIpKey,
} from '../ratelimit';

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

  if (typeof body.email !== 'string' || typeof body.password !== 'string'
    || typeof body.name !== 'string' || typeof body.verify_code !== 'string'
    || !body.email.trim() || !body.password || !body.name.trim() || !body.verify_code) {
    return jsonResponse({ error: '请填写所有必填字段' }, 400);
  }
  const email = body.email.trim().toLowerCase();
  const name = body.name.trim();
  const password = body.password;

  if (password.length < 8) {
    return jsonResponse({ error: '密码长度至少 8 位' }, 400);
  }

  // IP 限流：阻止对初始化验证码的暴力尝试
  const rl = rateLimitConfig(c.env);
  const failKey = authFailKey(getRequestIP(c.req.raw));
  const rlStatus = await getRateLimit(c.env.DB, failKey, rl.authFailLimit, rl.authFailWindow);
  if (rlStatus.blocked) {
    return jsonResponse(
      { error: `失败次数过多，请 ${rlStatus.retryAfter} 秒后再试`, code: 'RATE_LIMITED' },
      429,
    );
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
  const now = Math.floor(Date.now() / 1000);
  const codeRecord = await c.env.DB.prepare(
    "SELECT * FROM verification_codes WHERE email = ? AND purpose = 'init_admin' AND used = 0 AND expires_at > ? ORDER BY created_at DESC LIMIT 1"
  ).bind(email, now).first<{
    id: number;
    code: string;
  }>();

  if (!codeRecord || codeRecord.code !== body.verify_code) {
    await incrementRateLimit(c.env.DB, failKey, rl.authFailWindow);
    return jsonResponse({ error: '验证码错误或已过期' }, 400);
  }

  // 原子消费验证码：并发提交同一验证码时只有一次能成功
  const consumed = await c.env.DB.prepare(
    'UPDATE verification_codes SET used = 1 WHERE id = ? AND used = 0'
  ).bind(codeRecord.id).run();
  if (Number(consumed.meta.changes || 0) === 0) {
    return jsonResponse({ error: '验证码已使用，请重新获取' }, 400);
  }

  // 原子占用「已初始化」标记：并发初始化时只有一个请求能创建管理员
  const claimed = await c.env.DB.prepare(
    "UPDATE system_config SET value = 'true', updated_at = ? WHERE key = 'initialized' AND value = 'false'"
  ).bind(now).run();
  if (Number(claimed.meta.changes || 0) === 0) {
    return jsonResponse({ error: '系统已初始化' }, 400);
  }

  // 创建管理员账户：初始化时创建的这个超级管理员是「最高权限账户」（is_root = 1）
  const passwordHash = await hashPassword(password);
  let userId: number;
  try {
    try {
      const created = await c.env.DB.prepare(
        'INSERT INTO users (email, password_hash, name, role, status, is_root) VALUES (?, ?, ?, ?, ?, 1)'
      ).bind(email, passwordHash, name, 'super_admin', 'active').run();
      userId = Number(created.meta.last_row_id);
    } catch {
      // 迁移 0009 未执行时降级
      const created = await c.env.DB.prepare(
        'INSERT INTO users (email, password_hash, name, role, status) VALUES (?, ?, ?, ?, ?)'
      ).bind(email, passwordHash, name, 'super_admin', 'active').run();
      userId = Number(created.meta.last_row_id);
    }
  } catch (err) {
    // 创建失败时释放初始化标记，避免系统卡在「已初始化但没有管理员」的状态
    await c.env.DB.prepare("UPDATE system_config SET value = 'false' WHERE key = 'initialized'").run().catch(() => undefined);
    throw err;
  }

  // 初始化成功：清零该 IP 的认证失败计数
  await clearRateLimit(c.env.DB, failKey);

  // 记录审计日志
  await logAudit(c.env.DB, userId as number, 'init_admin', c.req.raw, 'system', undefined, JSON.stringify({ email }));

  // 签发 JWT
  const token = await signJWT(
    { user_id: userId as number, email, role: 'super_admin' },
    c.env.JWT_SECRET
  );

  return jsonResponse({
    success: true,
    token,
    user: { id: userId, email, name, role: 'super_admin', is_root: true },
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

  if (typeof body.email !== 'string' || !body.email.trim()) {
    return jsonResponse({ error: '请输入邮箱' }, 400);
  }
  if (body.password !== undefined && typeof body.password !== 'string') {
    return jsonResponse({ error: '密码格式不正确' }, 400);
  }
  // 邮箱大小写不敏感：统一转小写后查询，避免用户输入大写字母就无法登录
  const email = body.email.trim().toLowerCase();

  const purpose = body.purpose || 'login';
  if (!['login', 'init_admin', 'set_password'].includes(purpose)) {
    return jsonResponse({ error: '验证码用途不正确' }, 400);
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
    ).bind(email).first<{ id: number; password_hash: string | null; status: string }>();

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
    ).bind(email).first<{ id: number; password_hash: string; status: string }>();

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
  const rateKey = `rate:sendcode:${email}`;
  const rateLimited = await c.env.KV.get(rateKey);
  if (rateLimited) {
    return jsonResponse({ error: '验证码发送过于频繁，请 60 秒后重试' }, 429);
  }

  // 限流：同一 IP 窗口内发送次数上限（防止换邮箱绕过上面的限制批量发信）
  const rl = rateLimitConfig(c.env);
  const ipSendKey = sendIpKey(getRequestIP(c.req.raw));
  const ipStatus = await getRateLimit(c.env.DB, ipSendKey, rl.sendIpLimit, rl.sendIpWindow);
  if (ipStatus.blocked) {
    return jsonResponse(
      { error: `当前 IP 请求验证码过于频繁，请 ${ipStatus.retryAfter} 秒后再试`, code: 'RATE_LIMITED_IP' },
      429,
    );
  }

  // 生成验证码
  const code = generateVerifyCode();
  const expiresAt = Math.floor(Date.now() / 1000) + 600; // 10分钟过期

  // 存入数据库
  await c.env.DB.prepare(
    'INSERT INTO verification_codes (email, code, purpose, expires_at) VALUES (?, ?, ?, ?)'
  ).bind(email, code, purpose, expiresAt).run();

  // 设置限流
  await c.env.KV.put(rateKey, '1', { expirationTtl: 60 });
  // IP 计数在发信前累加：即使 SMTP 发送失败也占用配额，防止借失败重试刷信
  await incrementRateLimit(c.env.DB, ipSendKey, rl.sendIpWindow);

  // 发送邮件
  const { sendVerificationEmail, isSmtpConfigured } = await import('../services/email');
  const sent = await sendVerificationEmail(
    email,
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

  if (typeof body.email !== 'string' || typeof body.password !== 'string'
    || typeof body.verify_code !== 'string'
    || !body.email.trim() || !body.password || !body.verify_code) {
    return jsonResponse({ error: '请填写所有必填字段' }, 400);
  }
  const email = body.email.trim().toLowerCase();

  // IP 限流：同一 IP 累计验证失败（账户不存在 / 密码错误 / 验证码错误）超限后拒绝服务，
  // 阻止对 6 位验证码与密码的暴力尝试。成功登录会清零计数。
  const rl = rateLimitConfig(c.env);
  const failKey = authFailKey(getRequestIP(c.req.raw));
  const rlStatus = await getRateLimit(c.env.DB, failKey, rl.authFailLimit, rl.authFailWindow);
  if (rlStatus.blocked) {
    return jsonResponse(
      { error: `失败次数过多，请 ${rlStatus.retryAfter} 秒后再试`, code: 'RATE_LIMITED' },
      429,
    );
  }

  // 验证用户
  const user = await c.env.DB.prepare(
    'SELECT * FROM users WHERE email = ?'
  ).bind(email).first<{
    id: number;
    email: string;
    password_hash: string;
    name: string;
    role: string;
    status: string;
    is_root?: number;
  }>();

  if (!user) {
    await incrementRateLimit(c.env.DB, failKey, rl.authFailWindow);
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
    await incrementRateLimit(c.env.DB, failKey, rl.authFailWindow);
    return jsonResponse({ error: '邮箱或密码错误' }, 400);
  }

  // 验证码验证
  const codeRecord = await c.env.DB.prepare(
    "SELECT * FROM verification_codes WHERE email = ? AND purpose = 'login' AND used = 0 AND expires_at > ? ORDER BY created_at DESC LIMIT 1"
  ).bind(email, Math.floor(Date.now() / 1000)).first<{ id: number; code: string }>();

  if (!codeRecord || codeRecord.code !== body.verify_code) {
    await incrementRateLimit(c.env.DB, failKey, rl.authFailWindow);
    return jsonResponse({ error: '验证码错误或已过期' }, 400);
  }

  // 原子消费验证码，避免并发重放
  const consumed = await c.env.DB.prepare(
    'UPDATE verification_codes SET used = 1 WHERE id = ? AND used = 0'
  ).bind(codeRecord.id).run();
  if (Number(consumed.meta.changes || 0) === 0) {
    return jsonResponse({ error: '验证码已使用，请重新获取' }, 400);
  }

  // 登录成功：清零该 IP 的认证失败计数
  await clearRateLimit(c.env.DB, failKey);

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

  if (typeof body.email !== 'string' || typeof body.password !== 'string'
    || typeof body.verify_code !== 'string'
    || !body.email.trim() || !body.password || !body.verify_code) {
    return jsonResponse({ error: '请填写所有必填字段' }, 400);
  }
  const email = body.email.trim().toLowerCase();
  if (body.password.length < 8) {
    return jsonResponse({ error: '密码长度至少 8 位' }, 400);
  }

  // IP 限流：与登录共用失败计数桶，阻止对设置密码验证码的暴力尝试
  const rl = rateLimitConfig(c.env);
  const failKey = authFailKey(getRequestIP(c.req.raw));
  const rlStatus = await getRateLimit(c.env.DB, failKey, rl.authFailLimit, rl.authFailWindow);
  if (rlStatus.blocked) {
    return jsonResponse(
      { error: `失败次数过多，请 ${rlStatus.retryAfter} 秒后再试`, code: 'RATE_LIMITED' },
      429,
    );
  }

  const user = await c.env.DB.prepare(
    'SELECT * FROM users WHERE email = ?'
  ).bind(email).first<{
    id: number;
    email: string;
    password_hash: string | null;
    name: string;
    role: string;
    status: string;
    is_root?: number;
  }>();

  if (!user) {
    await incrementRateLimit(c.env.DB, failKey, rl.authFailWindow);
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
  ).bind(email, Math.floor(Date.now() / 1000)).first<{ id: number; code: string }>();

  if (!codeRecord || codeRecord.code !== body.verify_code) {
    await incrementRateLimit(c.env.DB, failKey, rl.authFailWindow);
    return jsonResponse({ error: '验证码错误或已过期' }, 400);
  }

  const consumed = await c.env.DB.prepare(
    'UPDATE verification_codes SET used = 1 WHERE id = ? AND used = 0'
  ).bind(codeRecord.id).run();
  if (Number(consumed.meta.changes || 0) === 0) {
    return jsonResponse({ error: '验证码已使用，请重新获取' }, 400);
  }

  const passwordHash = await hashPassword(body.password);
  const loginIp = getRequestIP(c.req.raw);
  const loginAt = Math.floor(Date.now() / 1000);

  await c.env.DB.prepare(
    'UPDATE users SET password_hash = ?, last_login_at = ?, last_login_ip = ?, updated_at = ? WHERE id = ?'
  ).bind(passwordHash, loginAt, loginIp, loginAt, user.id).run();

  // 设置成功：清零该 IP 的认证失败计数
  await clearRateLimit(c.env.DB, failKey);

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
  // 批量计算：两次查询替代「组数 × 祖链层数」的串行查询
  const relations = await c.env.DB.prepare(
    'SELECT group_id FROM user_group_relations WHERE user_id = ?'
  ).bind(user.id).all<{ group_id: number }>();
  const permissionGroupIds = [...new Set([...relations.results.map((r) => r.group_id), ...managedGroupIds])];
  const permsByGroup = await getGroupPermissionsForGroups(c.env.DB, user.id, permissionGroupIds);
  const groupPermissions: Record<string, Record<string, boolean>> = {};
  for (const gid of permissionGroupIds) {
    groupPermissions[String(gid)] = permsByGroup[gid] || {};
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
