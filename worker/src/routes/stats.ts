// 统计指标路由
// 说明：
// - 超级管理员可查看全站数据；项目组管理员可查看「自己管理的组 + 全部子组」的数据
// - 所有日期分桶统一按北京时间（UTC+8），避免 UTC 跨日导致「今天」少一天 / 多一天

import { Hono } from 'hono';
import type { Env, JWTPayload } from '../types';
import { BEIJING_OFFSET, beijingDateKey, beijingDayStart, jsonResponse, parseUserAgent } from '../utils';
import { authMiddleware } from '../middleware';
import {
  expandGroupIdsWithDescendants,
  filterGroupsWithPermission,
  getManagedScopeIds,
  hasGroupPermission,
  isGroupVisibleToUser,
} from '../permissions';

const stats = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();

stats.use('*', authMiddleware);

/** 统计可见范围：超管为全站，其余为「管理组 + 子组」中具备查看数据权限的组 */
interface StatsScope {
  all: boolean;
  groupIds: number[];
}

async function resolveScope(
  db: D1Database,
  user: JWTPayload,
  groupIdParam?: string | null,
): Promise<StatsScope | null> {
  if (user.role === 'super_admin') {
    if (!groupIdParam) return { all: true, groupIds: [] };
    const gid = parseInt(groupIdParam);
    if (!Number.isFinite(gid)) return { all: true, groupIds: [] };
    return { all: false, groupIds: await expandGroupIdsWithDescendants(db, [gid]) };
  }

  const managed = await getManagedScopeIds(db, user.user_id);
  if (managed.length === 0) return null;
  const allowed = await filterGroupsWithPermission(db, user.user_id, managed, 'link.view.data');
  if (allowed.length === 0) return null;

  if (groupIdParam) {
    const gid = parseInt(groupIdParam);
    if (!Number.isFinite(gid) || !allowed.includes(gid)) return null;
    const ids = await expandGroupIdsWithDescendants(db, [gid]);
    return { all: false, groupIds: ids.filter((id) => allowed.includes(id)) };
  }
  return { all: false, groupIds: allowed };
}

/** short_links 范围条件（表别名默认 sl） */
function linkScope(scope: StatsScope, alias = 'sl'): { sql: string; params: number[] } {
  if (scope.all) return { sql: '', params: [] };
  if (scope.groupIds.length === 0) return { sql: ` AND ${alias}.group_id IN (NULL)`, params: [] };
  return {
    sql: ` AND ${alias}.group_id IN (${scope.groupIds.map(() => '?').join(',')})`,
    params: scope.groupIds,
  };
}

/** access_logs 范围条件（需要 join short_links 才能按组过滤） */
function logScope(scope: StatsScope): { join: string; sql: string; params: number[] } {
  if (scope.all) return { join: '', sql: '', params: [] };
  const link = linkScope(scope);
  return { join: ' JOIN short_links sl ON sl.id = al.short_link_id', sql: link.sql, params: link.params };
}

/** 把「起始日 + 天数」补全为连续日期序列，缺失日期补 0 */
function fillDays(startDay: number, days: number, rows: { date: string; clicks: number }[]) {
  const map = new Map(rows.map((r) => [r.date, r.clicks]));
  const result: { date: string; clicks: number }[] = [];
  for (let i = 0; i < days; i++) {
    const key = beijingDateKey(startDay + i * 86400);
    result.push({ date: key, clicks: map.get(key) ?? 0 });
  }
  return result;
}

function parseDays(raw: string | undefined, fallback = 7): number {
  const days = parseInt(raw || String(fallback));
  if (!Number.isFinite(days)) return fallback;
  return Math.min(Math.max(days, 1), 90);
}

// ========== 可见范围（供前端渲染项目组选择器） ==========
stats.get('/scope', async (c) => {
  const currentUser = c.get('user');
  const scope = await resolveScope(c.env.DB, currentUser);
  if (!scope) return jsonResponse({ error: '没有查看指标统计的权限' }, 403);

  if (scope.all) {
    const groups = await c.env.DB.prepare(
      'SELECT id, name, parent_id FROM project_groups ORDER BY COALESCE(parent_id, 0), name',
    ).all();
    return jsonResponse({ all: true, groups: groups.results });
  }

  const groups = scope.groupIds.length
    ? await c.env.DB.prepare(
        `SELECT id, name, parent_id FROM project_groups
         WHERE id IN (${scope.groupIds.map(() => '?').join(',')})
         ORDER BY COALESCE(parent_id, 0), name`,
      )
        .bind(...scope.groupIds)
        .all()
    : { results: [] };

  return jsonResponse({ all: false, groups: groups.results });
});

// ========== 全局统计（超管全站 / 组管理员组内及子组） ==========
stats.get('/overview', async (c) => {
  const currentUser = c.get('user');
  const scope = await resolveScope(c.env.DB, currentUser, c.req.query('groupId'));
  if (!scope) return jsonResponse({ error: '没有查看指标统计的权限' }, 403);

  const scopeCond = linkScope(scope);
  const todayStart = beijingDayStart();
  const log = logScope(scope);

  const countOf = async (extra: string, params: (string | number)[] = []) => {
    const row = await c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM short_links sl WHERE 1=1${scopeCond.sql}${extra}`,
    )
      .bind(...scopeCond.params, ...params)
      .first<{ count: number }>();
    return row?.count || 0;
  };

  const [totalLinks, activeLinks, disabledLinks, expiredLinks, totalClicks, todayClicks] =
    await Promise.all([
      countOf(''),
      countOf(" AND sl.status = 'active'"),
      countOf(" AND sl.status = 'disabled'"),
      countOf(" AND sl.status = 'expired'"),
      c.env.DB.prepare(`SELECT COALESCE(SUM(sl.click_count), 0) as total FROM short_links sl WHERE 1=1${scopeCond.sql}`)
        .bind(...scopeCond.params)
        .first<{ total: number }>(),
      c.env.DB.prepare(
        `SELECT COUNT(*) as count FROM access_logs al${log.join} WHERE al.timestamp >= ?${log.sql}`,
      )
        .bind(todayStart, ...log.params)
        .first<{ count: number }>(),
    ]);

  let totalUsers = 0;
  let totalGroups = 0;
  if (scope.all) {
    const [users, groups] = await Promise.all([
      c.env.DB.prepare("SELECT COUNT(*) as count FROM users WHERE status = 'active'").first<{ count: number }>(),
      c.env.DB.prepare('SELECT COUNT(*) as count FROM project_groups').first<{ count: number }>(),
    ]);
    totalUsers = users?.count || 0;
    totalGroups = groups?.count || 0;
  } else {
    totalGroups = scope.groupIds.length;
    if (scope.groupIds.length > 0) {
      const members = await c.env.DB.prepare(
        `SELECT COUNT(DISTINCT user_id) as count FROM user_group_relations
         WHERE group_id IN (${scope.groupIds.map(() => '?').join(',')})`,
      )
        .bind(...scope.groupIds)
        .first<{ count: number }>();
      totalUsers = members?.count || 0;
    }
  }

  return jsonResponse({
    scope: scope.all ? 'all' : 'groups',
    total_links: totalLinks,
    active_links: activeLinks,
    disabled_links: disabledLinks,
    expired_links: expiredLinks,
    total_users: totalUsers,
    total_groups: totalGroups,
    today_clicks: todayClicks?.count || 0,
    total_clicks: totalClicks?.total || 0,
  });
});

// ========== 访问趋势（北京时间自然日） ==========
stats.get('/trend', async (c) => {
  const currentUser = c.get('user');
  const scope = await resolveScope(c.env.DB, currentUser, c.req.query('groupId'));
  if (!scope) return jsonResponse({ error: '没有查看指标统计的权限' }, 403);

  const days = parseDays(c.req.query('days'));
  const startDay = beijingDayStart() - (days - 1) * 86400;
  const log = logScope(scope);

  const rows = await c.env.DB.prepare(
    `SELECT date(al.timestamp + ${BEIJING_OFFSET}, 'unixepoch') as date, COUNT(*) as clicks
     FROM access_logs al${log.join}
     WHERE al.timestamp >= ?${log.sql}
     GROUP BY date(al.timestamp + ${BEIJING_OFFSET}, 'unixepoch')
     ORDER BY date ASC`,
  )
    .bind(startDay, ...log.params)
    .all<{ date: string; clicks: number }>();

  return jsonResponse({ trend: fillDays(startDay, days, rows.results) });
});

// ========== 地区分布（国家 / 省份，北京时间窗口） ==========
stats.get('/geo', async (c) => {
  const currentUser = c.get('user');
  const scope = await resolveScope(c.env.DB, currentUser, c.req.query('groupId'));
  if (!scope) return jsonResponse({ error: '没有查看指标统计的权限' }, 403);

  const days = parseDays(c.req.query('days'));
  const start = beijingDayStart() - (days - 1) * 86400;
  const log = logScope(scope);

  const countries = await c.env.DB.prepare(
    `SELECT COALESCE(al.country, '未知') as country, COUNT(*) as count
     FROM access_logs al${log.join}
     WHERE al.timestamp >= ?${log.sql}
     GROUP BY COALESCE(al.country, '未知')
     ORDER BY count DESC
     LIMIT 50`,
  )
    .bind(start, ...log.params)
    .all<{ country: string; count: number }>();

  const regions = await c.env.DB.prepare(
    `SELECT COALESCE(al.country, '未知') as country,
            COALESCE(NULLIF(al.region, ''), '') as region,
            COUNT(*) as count
     FROM access_logs al${log.join}
     WHERE al.timestamp >= ?${log.sql}
     GROUP BY COALESCE(al.country, '未知'), COALESCE(al.region, '')
     ORDER BY count DESC
     LIMIT 50`,
  )
    .bind(start, ...log.params)
    .all<{ country: string; region: string; count: number }>();

  const total = countries.results.reduce((sum, item) => sum + item.count, 0);

  return jsonResponse({
    countries: countries.results,
    regions: regions.results,
    total,
  });
});

// ========== 热门短链 ==========
stats.get('/top-links', async (c) => {
  const currentUser = c.get('user');
  const scope = await resolveScope(c.env.DB, currentUser, c.req.query('groupId'));
  if (!scope) return jsonResponse({ error: '没有查看指标统计的权限' }, 403);

  const days = parseDays(c.req.query('days'));
  const start = beijingDayStart() - (days - 1) * 86400;
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '10'), 1), 50);

  const rows = await c.env.DB.prepare(
    `SELECT sl.id, sl.short_code, sl.name, sl.target_url, d.domain as domain_name,
            pg.name as group_name, COUNT(*) as clicks
     FROM access_logs al
     JOIN short_links sl ON sl.id = al.short_link_id
     LEFT JOIN domains d ON sl.domain_id = d.id
     LEFT JOIN project_groups pg ON sl.group_id = pg.id
     WHERE al.timestamp >= ?${scope.all ? '' : ` AND sl.group_id IN (${scope.groupIds.map(() => '?').join(',')})`}
     GROUP BY sl.id
     ORDER BY clicks DESC
     LIMIT ?`,
  )
    .bind(start, ...(scope.all ? [] : scope.groupIds), limit)
    .all();

  return jsonResponse({ links: rows.results });
});

// ========== 单短链统计 ==========
stats.get('/link/:id', async (c) => {
  const linkId = parseInt(c.req.param('id'));
  if (!Number.isFinite(linkId)) return jsonResponse({ error: '无效的短链 ID' }, 400);
  const currentUser = c.get('user');

  const link = await c.env.DB.prepare(
    `SELECT sl.*, d.domain as domain_name, u.name as creator_name, u.email as creator_email,
      pg.name as group_name
     FROM short_links sl
     LEFT JOIN domains d ON sl.domain_id = d.id
     LEFT JOIN users u ON sl.created_by = u.id
     LEFT JOIN project_groups pg ON sl.group_id = pg.id
     WHERE sl.id = ?`,
  )
    .bind(linkId)
    .first<{
      id: number;
      created_by: number;
      group_id: number | null;
      click_count: number;
      status: string;
      short_code: string;
      target_url: string;
      name: string;
      created_at: number;
    }>();

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

  const days = parseDays(c.req.query('days'));
  const startDay = beijingDayStart() - (days - 1) * 86400;

  // 趋势（北京时间自然日）
  const trendRows = await c.env.DB.prepare(
    `SELECT date(timestamp + ${BEIJING_OFFSET}, 'unixepoch') as date, COUNT(*) as clicks
     FROM access_logs WHERE short_link_id = ? AND timestamp >= ?
     GROUP BY date(timestamp + ${BEIJING_OFFSET}, 'unixepoch') ORDER BY date ASC`,
  )
    .bind(linkId, startDay)
    .all<{ date: string; clicks: number }>();

  // 来源 Referer 分布
  const referers = await c.env.DB.prepare(
    `SELECT COALESCE(referer, '直接访问') as referer, COUNT(*) as count
     FROM access_logs WHERE short_link_id = ? AND timestamp >= ?
     GROUP BY referer ORDER BY count DESC LIMIT 10`,
  )
    .bind(linkId, startDay)
    .all();

  // 国家/地区分布（世界地图用，保留前 50 个国家）
  const countries = await c.env.DB.prepare(
    `SELECT COALESCE(country, '未知') as country, COUNT(*) as count
     FROM access_logs WHERE short_link_id = ? AND timestamp >= ?
     GROUP BY country ORDER BY count DESC LIMIT 50`,
  )
    .bind(linkId, startDay)
    .all<{ country: string; count: number }>();

  // 省份 / 州分布
  const regions = await c.env.DB.prepare(
    `SELECT COALESCE(country, '未知') as country, COALESCE(NULLIF(region, ''), '') as region,
            COUNT(*) as count
     FROM access_logs WHERE short_link_id = ? AND timestamp >= ?
     GROUP BY COALESCE(country, '未知'), COALESCE(region, '')
     ORDER BY count DESC LIMIT 20`,
  )
    .bind(linkId, startDay)
    .all<{ country: string; region: string; count: number }>();

  // 浏览器/设备分布（从 User-Agent 解析）
  const logs = await c.env.DB.prepare(
    'SELECT user_agent FROM access_logs WHERE short_link_id = ? AND timestamp >= ?',
  )
    .bind(linkId, startDay)
    .all();

  const browserStats: Record<string, number> = {};
  const osStats: Record<string, number> = {};
  const deviceStats: Record<string, number> = {};
  for (const log of logs.results as { user_agent: string | null }[]) {
    const { browser, os, device } = parseUserAgent(log.user_agent);
    browserStats[browser] = (browserStats[browser] || 0) + 1;
    osStats[os] = (osStats[os] || 0) + 1;
    deviceStats[device] = (deviceStats[device] || 0) + 1;
  }

  const sortByCount = (obj: Record<string, number>) =>
    Object.entries(obj)
      .map(([key, value]) => ({ name: key, count: value }))
      .sort((a, b) => b.count - a.count);

  // 最近访问明细（含访问 IP / 地区）
  const recent = await c.env.DB.prepare(
    `SELECT timestamp, ip, country, region, city, referer, user_agent
     FROM access_logs WHERE short_link_id = ?
     ORDER BY timestamp DESC LIMIT 50`,
  )
    .bind(linkId)
    .all();

  return jsonResponse({
    link,
    trend: fillDays(startDay, days, trendRows.results),
    referers: referers.results,
    countries: countries.results,
    regions: regions.results,
    browsers: sortByCount(browserStats),
    os: sortByCount(osStats),
    devices: sortByCount(deviceStats),
    recent: recent.results,
  });
});

export default stats;
