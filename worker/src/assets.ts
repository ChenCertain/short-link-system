// 静态资源服务：统一缓存头与 SPA 回退逻辑
import type { Context } from 'hono';
import type { Env } from './types';

// 带内容指纹的资源（/assets/index-xxxx.js）可长期强缓存；HTML 每次回源校验；
// 其余入口静态文件（favicon.svg 等）名称固定，给一天的缓存避免每次访问重复下载。
const IMMUTABLE = 'public, max-age=31536000, immutable';
const HTML_CACHE = 'public, max-age=0, must-revalidate';
const ASSET_CACHE = 'public, max-age=86400';

/** HTML 响应的基础安全头（防内容嗅探 / 引用信息外泄） */
export const HTML_SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

/** 无扩展名的路径（含根路径）都由 SPA 渲染，按 HTML 处理 */
function isHtmlLike(pathname: string): boolean {
  return pathname === '/' || pathname.endsWith('.html') || !/\.[a-z0-9]+$/i.test(pathname);
}

function withCacheHeaders(pathname: string, response: Response): Response {
  if (response.status !== 200) return response;
  const headers = new Headers(response.headers);
  if (pathname.startsWith('/assets/')) {
    headers.set('Cache-Control', IMMUTABLE);
  } else if (isHtmlLike(pathname)) {
    headers.set('Cache-Control', HTML_CACHE);
    for (const [key, value] of Object.entries(HTML_SECURITY_HEADERS)) headers.set(key, value);
  } else {
    // 入口处的其他静态文件（favicon.svg / robots.txt 等）：ASSETS 默认是
    // max-age=0，这里统一改为一天，减少重复回源
    headers.set('Cache-Control', ASSET_CACHE);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** 读取前端入口 HTML（复用当前请求的域名，仅替换路径） */
export async function fetchIndexHtml(env: Env, requestUrl?: string): Promise<Response> {
  const url = new URL(requestUrl || 'https://assets.local/');
  url.pathname = '/index.html';
  url.search = '';
  const html = await env.ASSETS.fetch(
    new Request(url.toString(), { headers: { Accept: 'text/html' } })
  );
  return withCacheHeaders('/index.html', html);
}

/** 服务静态资源，未命中且是页面导航时回退到 index.html */
export async function serveStatic(c: Context<{ Bindings: Env }>): Promise<Response> {
  const { pathname } = new URL(c.req.url);
  const response = await c.env.ASSETS.fetch(c.req.raw);

  const accept = c.req.header('Accept') || '';
  const isNavigation = c.req.method === 'GET' || c.req.method === 'HEAD';
  if (response.status === 404 && isNavigation && accept.includes('text/html')) {
    const html = await fetchIndexHtml(c.env, c.req.url);
    if (html.status === 200) return html;
  }

  return withCacheHeaders(pathname, response);
}
