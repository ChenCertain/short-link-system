// 系统配置路由

import { Hono } from 'hono';
import type { Env, JWTPayload } from '../types';
import { jsonResponse } from '../utils';
import { authMiddleware, requireRole, logAudit } from '../middleware';

const config = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();

// 公开配置（不需要登录）
config.get('/public', async (c) => {
  const siteName = await c.env.DB.prepare(
    "SELECT value FROM system_config WHERE key = 'site_name'"
  ).first<{ value: string }>();
  // 占位符或空值时不返回 Site Key，前端会自动不渲染人机验证
  const siteKey = (c.env.TURNSTILE_SITE_KEY || '').trim();
  return jsonResponse({
    site_name: siteName?.value || '短链管理系统',
    turnstile_site_key: siteKey.startsWith('REPLACE_WITH') ? '' : siteKey,
  });
});

// 以下路由需要登录
config.use('*', authMiddleware);

// 获取系统配置（仅超级管理员）
config.get('/', requireRole('super_admin'), async (c) => {
  const configs = await c.env.DB.prepare('SELECT key, value FROM system_config').all();
  const configMap: Record<string, string> = {};
  for (const row of configs.results as { key: string; value: string }[]) {
    configMap[row.key] = row.value;
  }
  return jsonResponse({ config: configMap });
});

// 更新系统配置（仅超级管理员）
config.put('/', requireRole('super_admin'), async (c) => {
  const body = await c.req.json<Record<string, string>>();
  const now = Math.floor(Date.now() / 1000);

  for (const [key, value] of Object.entries(body)) {
    // 不允许通过此接口修改 initialized 标志
    if (key === 'initialized') continue;
    await c.env.DB.prepare(
      'INSERT INTO system_config (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
    ).bind(key, value, now).run();
  }

  await logAudit(c.env.DB, c.get('user').user_id, 'update_config', c.req.raw, 'config', undefined, JSON.stringify(body));

  return jsonResponse({ success: true });
});

export default config;
