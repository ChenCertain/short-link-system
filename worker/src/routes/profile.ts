// 个人中心路由：登录用户自助修改用户名、换绑邮箱、修改密码

import { Hono } from 'hono';
import type { Env, JWTPayload } from '../types';
import {
  jsonResponse,
  hashPassword,
  verifyPassword,
  signJWT,
  generateVerifyCode,
} from '../utils';
import { authMiddleware, logAudit } from '../middleware';
import { sendVerificationEmail, isSmtpConfigured } from '../services/email';

const profile = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();

// 所有路由需要登录
profile.use('*', authMiddleware);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_MAX_LENGTH = 32;
const PASSWORD_MIN_LENGTH = 8;

interface ProfileUser {
  id: number;
  email: string;
  name: string;
  role: string;
  status: string;
  password_hash: string | null;
  last_login_at: number | null;
  last_login_ip: string | null;
  created_at: number;
}

async function getProfileUser(db: D1Database, userId: number): Promise<ProfileUser | null> {
  return db
    .prepare(
      `SELECT id, email, name, role, status, password_hash, last_login_at, last_login_ip, created_at
       FROM users WHERE id = ?`
    )
    .bind(userId)
    .first<ProfileUser>();
}

function toPublicUser(user: ProfileUser, patch: Partial<Pick<ProfileUser, 'name' | 'email'>> = {}) {
  return {
    id: user.id,
    email: patch.email ?? user.email,
    name: patch.name ?? user.name,
    role: user.role === 'super_admin' ? 'super_admin' : 'user',
    status: user.status,
    last_login_at: user.last_login_at,
    last_login_ip: user.last_login_ip,
    created_at: user.created_at,
  };
}

// ========== 获取个人信息 ==========
profile.get('/', async (c) => {
  const user = await getProfileUser(c.env.DB, c.get('user').user_id);
  if (!user) return jsonResponse({ error: '用户不存在' }, 404);

  return jsonResponse({
    user: toPublicUser(user),
    password_set: Boolean(user.password_hash),
  });
});

// ========== 修改用户名 / 换绑邮箱 ==========
profile.put('/', async (c) => {
  const current = c.get('user');
  const user = await getProfileUser(c.env.DB, current.user_id);
  if (!user) return jsonResponse({ error: '用户不存在' }, 404);

  const body = await c.req.json<{ name?: string; email?: string; verify_code?: string }>();

  const updates: string[] = [];
  const params: (string | number)[] = [];
  let newName: string | undefined;
  let newEmail: string | undefined;

  // 用户名
  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name) return jsonResponse({ error: '用户名不能为空' }, 400);
    if (name.length > NAME_MAX_LENGTH) {
      return jsonResponse({ error: `用户名最长 ${NAME_MAX_LENGTH} 个字符` }, 400);
    }
    if (name !== user.name) {
      updates.push('name = ?');
      params.push(name);
      newName = name;
    }
  }

  // 邮箱（需要新邮箱收到的验证码）
  if (body.email !== undefined) {
    const email = body.email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(email)) {
      return jsonResponse({ error: '邮箱格式不正确' }, 400);
    }
    if (email !== user.email) {
      if (!body.verify_code) {
        return jsonResponse({ error: '更换邮箱需要先获取新邮箱的验证码', code: 'VERIFY_CODE_REQUIRED' }, 400);
      }

      const taken = await c.env.DB.prepare('SELECT id FROM users WHERE email = ? AND id != ?')
        .bind(email, user.id)
        .first();
      if (taken) {
        return jsonResponse({ error: '该邮箱已被其他账户使用' }, 400);
      }

      const codeRecord = await c.env.DB.prepare(
        "SELECT id, code FROM verification_codes WHERE email = ? AND purpose = 'change_email' AND used = 0 AND expires_at > ? ORDER BY created_at DESC LIMIT 1"
      )
        .bind(email, Math.floor(Date.now() / 1000))
        .first<{ id: number; code: string }>();

      if (!codeRecord || codeRecord.code !== body.verify_code.trim()) {
        return jsonResponse({ error: '验证码错误或已过期' }, 400);
      }

      await c.env.DB.prepare('UPDATE verification_codes SET used = 1 WHERE id = ?')
        .bind(codeRecord.id)
        .run();

      updates.push('email = ?');
      params.push(email);
      newEmail = email;
    }
  }

  if (updates.length === 0) {
    return jsonResponse({
      success: true,
      user: toPublicUser(user),
    });
  }

  updates.push('updated_at = ?');
  params.push(Math.floor(Date.now() / 1000));
  params.push(user.id);

  await c.env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...params)
    .run();

  await logAudit(
    c.env.DB,
    user.id,
    newEmail ? 'change_email' : 'update_profile',
    c.req.raw,
    'user',
    user.id,
    JSON.stringify({ name: newName, email: newEmail })
  );

  // 邮箱变更后原 JWT 中的 email 已过期，重新签发一个
  const token = newEmail
    ? await signJWT(
        { user_id: user.id, email: newEmail, role: user.role === 'super_admin' ? 'super_admin' : 'user' },
        c.env.JWT_SECRET
      )
    : undefined;

  return jsonResponse({
    success: true,
    token,
    user: toPublicUser(user, { name: newName, email: newEmail }),
  });
});

// ========== 发送新邮箱验证码（换绑邮箱用） ==========
profile.post('/email-code', async (c) => {
  const current = c.get('user');
  const user = await getProfileUser(c.env.DB, current.user_id);
  if (!user) return jsonResponse({ error: '用户不存在' }, 404);

  const body = await c.req.json<{ email?: string }>();
  const email = (body.email || '').trim().toLowerCase();

  if (!EMAIL_PATTERN.test(email)) {
    return jsonResponse({ error: '邮箱格式不正确' }, 400);
  }
  if (email === user.email) {
    return jsonResponse({ error: '新邮箱与当前邮箱相同' }, 400);
  }

  const taken = await c.env.DB.prepare('SELECT id FROM users WHERE email = ? AND id != ?')
    .bind(email, user.id)
    .first();
  if (taken) {
    return jsonResponse({ error: '该邮箱已被其他账户使用' }, 400);
  }

  // 限流：同一账户 60 秒内只能发送一次
  const rateKey = `rate:profile-email-code:${user.id}`;
  if (await c.env.KV.get(rateKey)) {
    return jsonResponse({ error: '验证码发送过于频繁，请 60 秒后重试' }, 429);
  }

  const code = generateVerifyCode();
  const expiresAt = Math.floor(Date.now() / 1000) + 600; // 10 分钟

  await c.env.DB.prepare(
    "INSERT INTO verification_codes (email, code, purpose, expires_at) VALUES (?, ?, 'change_email', ?)"
  )
    .bind(email, code, expiresAt)
    .run();

  await c.env.KV.put(rateKey, '1', { expirationTtl: 60 });

  const sent = await sendVerificationEmail(email, code, c.env, '短链接管理系统 - 更换邮箱验证码');
  if (!sent) {
    return jsonResponse({ error: '邮件发送失败，请稍后重试' }, 500);
  }

  const host = new URL(c.req.url).hostname;
  const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  const devMode = !isSmtpConfigured(c.env) && isLocalhost;

  return jsonResponse({
    success: true,
    message: devMode ? '本地调试模式：验证码已自动填充' : '验证码已发送至新邮箱',
    ...(devMode ? { dev_code: code } : {}),
  });
});

// ========== 修改密码 ==========
profile.put('/password', async (c) => {
  const current = c.get('user');
  const user = await getProfileUser(c.env.DB, current.user_id);
  if (!user) return jsonResponse({ error: '用户不存在' }, 404);

  const body = await c.req.json<{ old_password?: string; new_password?: string }>();
  const newPassword = body.new_password || '';

  if (!newPassword) {
    return jsonResponse({ error: '请输入新密码' }, 400);
  }
  if (newPassword.length < PASSWORD_MIN_LENGTH) {
    return jsonResponse({ error: `密码长度至少 ${PASSWORD_MIN_LENGTH} 位` }, 400);
  }

  const passwordSet = Boolean(user.password_hash);
  if (passwordSet) {
    if (!body.old_password) {
      return jsonResponse({ error: '请输入当前密码' }, 400);
    }
    const valid = await verifyPassword(body.old_password, user.password_hash as string);
    if (!valid) {
      return jsonResponse({ error: '当前密码不正确' }, 400);
    }
    if (body.old_password === newPassword) {
      return jsonResponse({ error: '新密码不能与当前密码相同' }, 400);
    }
  }

  const hash = await hashPassword(newPassword);
  await c.env.DB.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
    .bind(hash, Math.floor(Date.now() / 1000), user.id)
    .run();

  await logAudit(c.env.DB, user.id, 'change_password', c.req.raw, 'user', user.id);

  return jsonResponse({ success: true, password_set: true });
});

export default profile;
