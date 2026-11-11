// IP 维度限流（D1 计数）
//
// 为什么用 D1 而不是 KV：KV 读取带边缘缓存（cacheTtl 最小 60s），
// 计数会出现「读旧值 → 覆盖写」丢计数的问题；D1 强一致，适合做限流计数。
// 未执行迁移 0011（rate_limits 表不存在）时全部静默降级为不限流，
// 与代码库中其余「迁移未执行时降级」的策略保持一致。

import type { Env } from './types';
import { parseIntClamped } from './utils';

export interface RateLimitStatus {
  blocked: boolean;
  /** 距离窗口重置的剩余秒数（仅 blocked 时有意义） */
  retryAfter: number;
}

/** 读取限流配置：默认值可被环境变量覆盖（运维调优 / 自动化测试用） */
export function rateLimitConfig(env: Pick<Env,
  'RATE_LIMIT_LOGIN_FAIL_MAX' | 'RATE_LIMIT_LOGIN_FAIL_WINDOW' |
  'RATE_LIMIT_SEND_IP_MAX' | 'RATE_LIMIT_SEND_IP_WINDOW'
>) {
  return {
    // 同一 IP 在窗口内累计「登录 / 设置密码 / 初始化」验证失败次数上限
    authFailLimit: parseIntClamped(env.RATE_LIMIT_LOGIN_FAIL_MAX, 10, 3, 10000),
    authFailWindow: parseIntClamped(env.RATE_LIMIT_LOGIN_FAIL_WINDOW, 900, 30, 86400),
    // 同一 IP 在窗口内发送验证码次数上限（在「同邮箱 60 秒一次」之外叠加）
    sendIpLimit: parseIntClamped(env.RATE_LIMIT_SEND_IP_MAX, 20, 3, 10000),
    sendIpWindow: parseIntClamped(env.RATE_LIMIT_SEND_IP_WINDOW, 600, 30, 86400),
  };
}

/** 认证失败计数桶（登录 / 设置密码 / 初始化共用，任一入口成功即清零） */
export function authFailKey(ip: string): string {
  return `authfail:${ip}`;
}

/** 验证码发送计数桶 */
export function sendIpKey(ip: string): string {
  return `sendip:${ip}`;
}

/** 查询当前是否被限流；表不存在或查询失败时按「未限流」处理 */
export async function getRateLimit(
  db: D1Database,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitStatus> {
  const now = Math.floor(Date.now() / 1000);
  try {
    const row = await db
      .prepare('SELECT count, window_start FROM rate_limits WHERE bucket_key = ?')
      .bind(key)
      .first<{ count: number; window_start: number }>();
    if (!row || now - row.window_start >= windowSeconds) {
      return { blocked: false, retryAfter: 0 };
    }
    if (row.count >= limit) {
      return { blocked: true, retryAfter: Math.max(1, row.window_start + windowSeconds - now) };
    }
    return { blocked: false, retryAfter: 0 };
  } catch {
    // 迁移 0011 未执行（rate_limits 表不存在）时降级为不限流
    return { blocked: false, retryAfter: 0 };
  }
}

/** 记一次计数：窗口内累加；窗口已过或首次出现则重置为 1 */
export async function incrementRateLimit(
  db: D1Database,
  key: string,
  windowSeconds: number,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  try {
    const updated = await db
      .prepare(
        'UPDATE rate_limits SET count = count + 1, updated_at = ? WHERE bucket_key = ? AND window_start > ?',
      )
      .bind(now, key, now - windowSeconds)
      .run();
    if (Number(updated.meta.changes || 0) === 0) {
      // 首次出现或窗口已过期：重置计数
      await db
        .prepare(
          `INSERT INTO rate_limits (bucket_key, count, window_start, updated_at) VALUES (?, 1, ?, ?)
           ON CONFLICT(bucket_key) DO UPDATE SET count = 1, window_start = excluded.window_start, updated_at = excluded.updated_at`,
        )
        .bind(key, now, now)
        .run();
    }
  } catch {
    // 迁移未执行时静默降级，不影响主流程
  }
}

/** 清零计数（验证成功时调用） */
export async function clearRateLimit(db: D1Database, key: string): Promise<void> {
  try {
    await db.prepare('DELETE FROM rate_limits WHERE bucket_key = ?').bind(key).run();
  } catch {
    // 迁移未执行时静默降级
  }
}
