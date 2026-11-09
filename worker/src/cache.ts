// 跳转解析前置缓存（KV）：热链接命中时省掉一次 D1 往返
import type { Env } from './types';

// 逻辑过期时间（秒）。增删改审核都会主动失效，这里只作兜底（同时控制 KV 写次数）
export const LINK_CACHE_TTL = 600;
// KV 边缘缓存时间（秒，最小 60）：同一边缘节点的重复读取不落到中央存储
export const LINK_CACHE_EDGE_TTL = 60;

export function linkCacheKey(code: string): string {
  return `link:${code}`;
}

/** 短链变更后失效跳转缓存（可一次传入多个短码） */
export async function invalidateLinkCache(
  env: Env,
  ...codes: (string | null | undefined)[]
): Promise<void> {
  const keys = codes.filter((code): code is string => !!code).map(linkCacheKey);
  if (keys.length === 0) return;
  try {
    await Promise.all(keys.map((key) => env.KV.delete(key)));
  } catch {
    // 缓存失效失败不影响主流程，等待 TTL 自然过期
  }
}
