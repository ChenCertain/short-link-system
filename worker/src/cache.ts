// 跳转解析前置缓存（KV）：热链接命中时省掉一次 D1 往返
import type { Env } from './types';

// 逻辑过期时间（秒）。增删改审核都会主动失效，这里只作兜底（同时控制 KV 写次数）
export const LINK_CACHE_TTL = 600;
// KV 边缘缓存时间（秒，最小 60）：同一边缘节点的重复读取不落到中央存储
export const LINK_CACHE_EDGE_TTL = 60;

/**
 * 按「短码 + 访问域名」生成缓存 key。
 * 别名在不同域名下相互独立，缓存也必须按域名隔离，否则会串到别的域名的短链。
 * host 为空（理论上不会出现）时统一用 '-' 占位。
 */
export function linkCacheKey(code: string, host: string): string {
  return `link:${code}:${host || '-'}`;
}

/** 某短码在所有域名下的缓存 key 前缀（真正的字面前缀，可用于 KV.list） */
export function linkCacheKeyPrefix(code: string): string {
  return `link:${code}:`;
}

/**
 * 短链变更后失效跳转缓存。
 * 传入短码即可清掉该短码在**所有域名**下的缓存，
 * 覆盖「改了别名」「换了域名」「域名被删导致 domain_id 置空」等场景，不会漏清。
 */
export async function invalidateLinkCache(
  env: Env,
  ...codes: (string | null | undefined)[]
): Promise<void> {
  const list = [...new Set(codes.filter((code): code is string => !!code))];
  if (list.length === 0) return;
  try {
    await Promise.all(list.map((code) => deleteByPrefix(env, linkCacheKeyPrefix(code))));
  } catch {
    // 缓存失效失败不影响主流程，等待 TTL 自然过期
  }
}

/** 按 key 前缀列出并删除所有匹配的 KV 条目（处理 list 分页） */
async function deleteByPrefix(env: Env, prefix: string): Promise<void> {
  const names: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.KV.list({ prefix, cursor });
    names.push(...page.keys.map((key) => key.name));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  if (names.length > 0) {
    await Promise.all(names.map((name) => env.KV.delete(name)));
  }
}
