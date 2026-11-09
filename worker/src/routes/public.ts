// 公开路由（无需登录）：首页展示短链

import { Hono } from 'hono';
import type { Env } from '../types';
import { jsonResponse } from '../utils';

const publicRoutes = new Hono<{ Bindings: Env }>();

// 首页展示的短链列表
publicRoutes.get('/links', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT sl.id, sl.short_code, sl.name, sl.status, sl.click_count, sl.created_at,
            d.domain as domain_name
     FROM short_links sl
     LEFT JOIN domains d ON sl.domain_id = d.id
     WHERE sl.is_displayed = 1 AND sl.review_status = 'approved'
     ORDER BY sl.display_order ASC, sl.created_at DESC
     LIMIT 100`
  ).all<{
    id: number;
    short_code: string;
    name: string;
    status: string;
    click_count: number;
    created_at: number;
    domain_name: string | null;
  }>();

  const links = rows.results.map((row) => ({
    id: row.id,
    name: row.name || row.short_code,
    status: row.status,
    click_count: row.click_count,
    created_at: row.created_at,
    short_url: row.domain_name
      ? `https://${row.domain_name}/${row.short_code}`
      : `/${row.short_code}`,
  }));

  const siteName = await c.env.DB.prepare(
    "SELECT value FROM system_config WHERE key = 'site_name'"
  ).first<{ value: string }>();

  return jsonResponse({
    site_name: siteName?.value || '短链管理系统',
    links,
  });
});

export default publicRoutes;
