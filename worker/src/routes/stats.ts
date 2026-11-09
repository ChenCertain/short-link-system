// 统计指标路由

import { Hono } from 'hono';
import type { Env, JWTPayload } from '../types';
import { jsonResponse, parseUserAgent } from '../utils';
import { authMiddleware, requireRole } from '../middleware';
import { hasGroupPermission, isGroupVisibleToUser } from '../permissions';

const stats = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();

stats.use('*', authMiddleware);

// ========== 全局统计 ==========
stats.get('/overview', requireRole('super_admin'), async (c) => {
  const now = Math.floor(Date.now() / 1000);
  const todayStart = now - (now % 86400);

  const [
    totalLinks,
    activeLinks,
    disabledLinks,
    expiredLinks,
    totalUsers,
    totalGroups,
    todayClicks,
    totalClicks,
  ] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) as count FROM short_links').first<{ count: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM short_links WHERE status = 'active'").first<{ count: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM short_links WHERE status = 'disabled'").first<{ count: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM short_links WHERE status = 'expired'").first<{ count: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM users WHERE status = 'active'").first<{ count: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM project_groups').first<{ count: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM access_logs WHERE timestamp >= ?').bind(todayStart).first<{ count: number }>(),
    c.env.DB.prepare('SELECT COALESCE(SUM(click_count), 0) as total FROM short_links').first<{ total: number }>(),
  ]);

  return jsonResponse({
    total_links: totalLinks?.count || 0,
    active_links: activeLinks?.count || 0,
    disabled_links: disabledLinks?.count || 0,
    expired_links: expiredLinks?.count || 0,
    total_users: totalUsers?.count || 0,
    total_groups: totalGroups?.count || 0,
    today_clicks: todayClicks?.count || 0,
    total_clicks: totalClicks?.total || 0,
  });
});

// ========== 7/30 天访问趋势 ==========
stats.get('/trend', requireRole('super_admin'), async (c) => {
  const days = parseInt(c.req.query('days') || '7');
  const startTime = Math.floor(Date.now() / 1000) - days * 86400;

  const trend = await c.env.DB.prepare(
    `SELECT date(timestamp, 'unixepoch') as date, COUNT(*) as clicks
     FROM access_logs
     WHERE timestamp >= ?
     GROUP BY date(timestamp, 'unixepoch')
     ORDER BY date ASC`
  ).bind(startTime).all();

  return jsonResponse({ trend: trend.results });
});

// ========== 单短链统计 ==========
stats.get('/link/:id', authMiddleware, async (c) => {
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
  ).bind(linkId).first<{ id: number; created_by: number; group_id: number | null; click_count: number; status: string; short_code: string; target_url: string; name: string; created_at: number }>();

  if (!link) {
    return jsonResponse({ error: '短链不存在' }, 404);
  }

  // 权限检查：创建者 / 超级管理员直接放行；
  // 组内他人短链需同时满足「组可见」与「查看短链数据」权限（管理员默认拥有，可被单独关闭）
  if (currentUser.role !== 'super_admin' && link.created_by !== currentUser.user_id) {
    const allowed = link.group_id
      ? (await isGroupVisibleToUser(c.env.DB, currentUser.user_id, link.group_id)) &&
        (await hasGroupPermission(c.env.DB, currentUser.user_id, link.group_id, 'link.view.data'))
      : false;
    if (!allowed) {
      return jsonResponse({ error: '没有查看该短链数据的权限，请联系项目组管理员' }, 403);
    }
  }

  const days = parseInt(c.req.query('days') || '7');
  const startTime = Math.floor(Date.now() / 1000) - days * 86400;

  // 趋势
  const trend = await c.env.DB.prepare(
    `SELECT date(timestamp, 'unixepoch') as date, COUNT(*) as clicks
     FROM access_logs WHERE short_link_id = ? AND timestamp >= ?
     GROUP BY date(timestamp, 'unixepoch') ORDER BY date ASC`
  ).bind(linkId, startTime).all();

  // 来源 Referer 分布
  const referers = await c.env.DB.prepare(
    `SELECT COALESCE(referer, '直接访问') as referer, COUNT(*) as count
     FROM access_logs WHERE short_link_id = ? AND timestamp >= ?
     GROUP BY referer ORDER BY count DESC LIMIT 10`
  ).bind(linkId, startTime).all();

  // 国家/地区分布
  const countries = await c.env.DB.prepare(
    `SELECT COALESCE(country, '未知') as country, COUNT(*) as count
     FROM access_logs WHERE short_link_id = ? AND timestamp >= ?
     GROUP BY country ORDER BY count DESC LIMIT 10`
  ).bind(linkId, startTime).all();

  // 浏览器/设备分布（从 User-Agent 解析）
  const logs = await c.env.DB.prepare(
    'SELECT user_agent FROM access_logs WHERE short_link_id = ? AND timestamp >= ?'
  ).bind(linkId, startTime).all();

  const browserStats: Record<string, number> = {};
  const osStats: Record<string, number> = {};
  const deviceStats: Record<string, number> = {};
  for (const log of logs.results as { user_agent: string | null }[]) {
    const { browser, os, device } = parseUserAgent(log.user_agent);
    browserStats[browser] = (browserStats[browser] || 0) + 1;
    osStats[os] = (osStats[os] || 0) + 1;
    deviceStats[device] = (deviceStats[device] || 0) + 1;
  }

  const sortByCount = (obj: Record<string, number>) => Object.entries(obj).map(([key, value]) => ({ name: key, count: value })).sort((a, b) => b.count - a.count);

  // 最近访问明细（含访问 IP）
  const recent = await c.env.DB.prepare(
    `SELECT timestamp, ip, country, city, referer, user_agent
     FROM access_logs WHERE short_link_id = ?
     ORDER BY timestamp DESC LIMIT 50`
  ).bind(linkId).all();

  return jsonResponse({
    link,
    trend: trend.results,
    referers: referers.results,
    countries: countries.results,
    browsers: sortByCount(browserStats),
    os: sortByCount(osStats),
    devices: sortByCount(deviceStats),
    recent: recent.results,
  });
});

export default stats;
