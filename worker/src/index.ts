// Worker 主入口

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env } from './types';
import { jsonResponse } from './utils';
import { serveStatic } from './assets';

// 路由模块
import auth from './routes/auth';
import users from './routes/users';
import profile from './routes/profile';
import groups from './routes/groups';
import members from './routes/members';
import domains from './routes/domains';
import links from './routes/links';
import stats from './routes/stats';
import config from './routes/config';
import audit from './routes/audit';
import redirect from './routes/redirect';

const app = new Hono<{ Bindings: Env }>();

// ========== CORS 中间件 ==========
// 默认同源部署，不放开跨域；如需跨域调用，配置 CORS_ALLOWED_ORIGINS（逗号分隔的来源，精确匹配）
app.use('*', async (c, next) => {
  const origin = c.req.header('Origin');
  const allowedOrigins = (c.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (origin && allowedOrigins.includes(origin)) {
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Vary', 'Origin');
    c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }

  if (c.req.method === 'OPTIONS') {
    return c.body(null, 204);
  }
  await next();
});

// ========== 全局错误处理 ==========
// 把未捕获异常统一转成 JSON，并输出堆栈便于排查（避免前端只看到 Internal Server Error）
app.onError((err, c) => {
  // Hono 自身抛出的 HTTPException 保留其状态码与响应
  if (err instanceof HTTPException) return err.getResponse();

  // 请求体不是合法 JSON 时属于客户端错误，不应返回 500
  const contentType = c.req.header('Content-Type') || '';
  if (err instanceof SyntaxError && contentType.toLowerCase().includes('application/json')) {
    return c.json({ error: '请求体格式不正确，请提交合法的 JSON' }, 400);
  }

  console.error('[worker error]', c.req.method, c.req.path, err);
  if (c.req.path.startsWith('/api/')) {
    return c.json({ error: '服务器内部错误，请稍后重试' }, 500);
  }
  return c.text('服务器内部错误', 500);
});

// ========== 健康检查 ==========
app.get('/api/health', () =>
  jsonResponse({ status: 'ok', service: 'short-link-system', timestamp: Date.now() })
);

// ========== API 路由 ==========
app.route('/api/auth', auth);
app.route('/api/users', users);
app.route('/api/profile', profile);
app.route('/api/groups', groups);
app.route('/api/members', members);
app.route('/api/domains', domains);
app.route('/api/links', links);
app.route('/api/stats', stats);
app.route('/api/config', config);
app.route('/api/audit', audit);

// ========== 短链跳转 ==========
// 需要在静态资源之前处理
app.route('/', redirect);

// ========== 静态资源（前端 SPA） ==========
app.all('*', async (c) => {
  // 未匹配到的 API 路径返回 JSON，而不是静态资源 404
  if (c.req.path.startsWith('/api/')) {
    return c.json({ error: '接口不存在' }, 404);
  }

  // 静态资源 + SPA 回退（带长缓存头，减少重复下载）
  return serveStatic(c);
});

export default app;
