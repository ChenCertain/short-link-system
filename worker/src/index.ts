// Worker 主入口

import { Hono } from 'hono';
import type { Env } from './types';
import { jsonResponse } from './utils';

// 路由模块
import auth from './routes/auth';
import users from './routes/users';
import profile from './routes/profile';
import groups from './routes/groups';
import domains from './routes/domains';
import links from './routes/links';
import stats from './routes/stats';
import config from './routes/config';
import audit from './routes/audit';
import redirect from './routes/redirect';
import publicRoutes from './routes/public';

const app = new Hono<{ Bindings: Env }>();

// ========== CORS 中间件 ==========
app.use('*', async (c, next) => {
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (c.req.method === 'OPTIONS') {
    return c.body(null, 204);
  }
  await next();
});

// ========== 全局错误处理 ==========
// 把未捕获异常统一转成 JSON，并输出堆栈便于排查（避免前端只看到 Internal Server Error）
app.onError((err, c) => {
  console.error('[worker error]', c.req.method, c.req.path, err);
  if (c.req.path.startsWith('/api/')) {
    return c.json({ error: '服务器内部错误，请稍后重试' }, 500);
  }
  return c.text('服务器内部错误', 500);
});

app.notFound((c) => {
  if (c.req.path.startsWith('/api/')) {
    return c.json({ error: '接口不存在' }, 404);
  }
  return c.env.ASSETS.fetch(c.req.raw);
});

// ========== 健康检查 ==========
app.get('/api/health', (c) =>
  jsonResponse({ status: 'ok', service: 'short-link-system', timestamp: Date.now() })
);

// ========== API 路由 ==========
app.route('/api/auth', auth);
app.route('/api/users', users);
app.route('/api/profile', profile);
app.route('/api/groups', groups);
app.route('/api/domains', domains);
app.route('/api/links', links);
app.route('/api/stats', stats);
app.route('/api/config', config);
app.route('/api/audit', audit);
app.route('/api/public', publicRoutes);

// ========== 短链跳转 ==========
// 需要在静态资源之前处理
app.route('/', redirect);

// ========== 静态资源（前端 SPA） ==========
app.all('*', async (c) => {
  // 未匹配到的 API 路径返回 JSON，而不是静态资源 404
  if (c.req.path.startsWith('/api/')) {
    return c.json({ error: '接口不存在' }, 404);
  }

  const response = await c.env.ASSETS.fetch(c.req.raw);

  // SPA 路由回退：非静态资源的前端路由统一返回 index.html
  const accept = c.req.header('Accept') || '';
  if (response.status === 404 && c.req.method === 'GET' && accept.includes('text/html')) {
    const url = new URL(c.req.url);
    url.pathname = '/index.html';
    return c.env.ASSETS.fetch(new Request(url.toString(), { headers: { Accept: 'text/html' } }));
  }

  return response;
});

export default app;
