// 工具函数

// Base62 字符集
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

// 生成随机短码
export function generateShortCode(length: number = 6): string {
  let result = '';
  const randomValues = new Uint8Array(length);
  crypto.getRandomValues(randomValues);
  for (let i = 0; i < length; i++) {
    result += BASE62[randomValues[i] % 62];
  }
  return result;
}

// 自定义别名（短码）长度上限
const ALIAS_MAX_LENGTH = 64;

/** 规范化主机名：去协议、去路径、去端口，统一小写 */
export function normalizeHost(value: string): string {
  return (value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '');
}

/** HTML 转义（用于拼接跳转页与邮件模板） */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 别名允许：中文/字母/数字/下划线/短横线（不含 . / ? # 等会破坏路由的字符）
const ALIAS_PATTERN = /^[\p{L}\p{N}_-]+$/u;

// 系统保留路径：这些短码会被静态资源或前端路由占用，创建后无法正常跳转
export const RESERVED_CODES = new Set(['login', 'init', 'dashboard', 'api', 'assets', 'cdn-cgi']);

/** 校验自定义别名，通过返回 null，否则返回错误提示 */
export function validateAlias(alias: string): string | null {
  const value = alias.trim();
  if (!value) return '自定义别名不能为空';
  if (value.length > ALIAS_MAX_LENGTH) return `自定义别名最长 ${ALIAS_MAX_LENGTH} 个字符`;
  if (!ALIAS_PATTERN.test(value)) return '自定义别名只能包含中文、字母、数字、下划线和短横线';
  if (RESERVED_CODES.has(value.toLowerCase())) return '该别名是系统保留路径，请更换';
  return null;
}

// 生成随机验证码（6位数字）
export function generateVerifyCode(): string {
  const values = new Uint8Array(6);
  crypto.getRandomValues(values);
  return Array.from(values, (v) => (v % 10).toString()).join('');
}

// 简单的密码哈希（使用 Web Crypto SHA-256 + salt）
// 注意：Workers 环境不支持 bcrypt，使用 PBKDF2 替代
export async function hashPassword(password: string, salt?: string): Promise<string> {
  const saltBytes = salt
    ? hexToBytes(salt)
    : crypto.getRandomValues(new Uint8Array(16));
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  const saltHex = bytesToHex(saltBytes);
  const hashHex = bytesToHex(new Uint8Array(derivedBits));
  return `pbkdf2$100000$${saltHex}$${hashHex}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const salt = parts[2];
  const expectedHash = parts[3];
  const computedHash = await hashPassword(password, salt);
  const computedParts = computedHash.split('$');
  const computedHashValue = computedParts[3];
  return timingSafeEqual(expectedHash, computedHashValue);
}

// IP 脱敏哈希
export async function hashIP(ip: string, salt: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(ip + salt);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(hashBuffer)).slice(0, 16);
}

// JWT 密钥校验：缺失或仍为模板占位符时直接拒绝，避免空密钥参与签名导致令牌可伪造
export function assertJwtSecret(secret: string | undefined): string {
  const value = (secret || '').trim();
  if (value === '' || /^REPLACE_WITH/i.test(value)) {
    throw new Error('JWT_SECRET 未配置或仍为占位符，已拒绝签发/校验令牌');
  }
  return value;
}

// 目标链接协议白名单：仅允许 http/https，阻止 javascript:、data: 等危险协议
export function isSafeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// JWT 签发（HMAC-SHA256）
export async function signJWT(payload: Omit<JWTPayload, 'iat' | 'exp'> & { exp?: number }, secret: string): Promise<string> {
  const signingSecret = assertJwtSecret(secret);
  const iat = Math.floor(Date.now() / 1000);
  const exp = payload.exp ?? iat + 7 * 24 * 3600; // 默认7天
  const fullPayload: JWTPayload = { ...payload, iat, exp };

  const encoder = new TextEncoder();
  const header = base64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64urlEncode(JSON.stringify(fullPayload));

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(signingSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${header}.${body}`));
  const sig = base64urlEncode(String.fromCharCode(...new Uint8Array(signature)));
  return `${header}.${body}.${sig}`;
}

// JWT 验证
export async function verifyJWT(token: string, secret: string): Promise<JWTPayload | null> {
  const verifyingSecret = assertJwtSecret(secret);
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(verifyingSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );

  const sigBytes = base64urlToBytes(parts[2]);
  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(`${parts[0]}.${parts[1]}`));
  if (!valid) return null;

  const payload: JWTPayload = JSON.parse(base64urlDecode(parts[1]));
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

// Base64URL 编解码
function base64urlEncode(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str: string): string {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return atob(s);
}

function base64urlToBytes(str: string): ArrayBuffer {
  const decoded = base64urlDecode(str);
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
  return bytes.buffer;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// 类型导入
import type { JWTPayload } from './types';

// JSON 响应辅助
export function jsonResponse(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// 获取请求 IP
export function getRequestIP(request: Request): string {
  const cf = (request as Request & { cf?: { ip?: string } }).cf;
  return cf?.ip || request.headers.get('CF-Connecting-IP') || request.headers.get('X-Real-IP') || '0.0.0.0';
}

// 常用国家 / 地区中文名（未收录的国家直接显示两位代码）
const COUNTRY_NAMES: Record<string, string> = {
  CN: '中国', HK: '中国香港', TW: '中国台湾', MO: '中国澳门',
  JP: '日本', KR: '韩国', SG: '新加坡', MY: '马来西亚', TH: '泰国',
  VN: '越南', PH: '菲律宾', ID: '印度尼西亚', IN: '印度', PK: '巴基斯坦',
  US: '美国', CA: '加拿大', BR: '巴西', MX: '墨西哥', AR: '阿根廷',
  GB: '英国', DE: '德国', FR: '法国', NL: '荷兰', BE: '比利时',
  CH: '瑞士', SE: '瑞典', NO: '挪威', DK: '丹麦', FI: '芬兰',
  PL: '波兰', ES: '西班牙', IT: '意大利', PT: '葡萄牙', IE: '爱尔兰',
  AT: '奥地利', CZ: '捷克', GR: '希腊', RU: '俄罗斯', UA: '乌克兰',
  TR: '土耳其', IL: '以色列', AE: '阿联酋', SA: '沙特阿拉伯', EG: '埃及',
  ZA: '南非', NG: '尼日利亚', KE: '肯尼亚', AU: '澳大利亚', NZ: '新西兰',
};

// 解析请求来源地理位置（依赖 Cloudflare 边缘节点提供的 cf 对象，本地 / 非 CF 环境返回 null）
export function getRequestLocation(request: Request): string | null {
  const cf = (request as Request & {
    cf?: { country?: string; region?: string; city?: string };
  }).cf;
  if (!cf) return null;
  const parts: string[] = [];
  if (cf.country) parts.push(COUNTRY_NAMES[cf.country] || cf.country);
  if (cf.region && cf.region !== cf.country) parts.push(cf.region);
  if (cf.city) parts.push(cf.city);
  return parts.length ? parts.join(' ') : null;
}

// ========== 北京时间（UTC+8）==========
// 系统统一按北京时间展示与统计，避免服务器 / 浏览器时区不同导致日期错位
export const BEIJING_OFFSET = 8 * 3600;

/** 北京时间「今天」的起点（Unix 秒） */
export function beijingDayStart(reference: number = Math.floor(Date.now() / 1000)): number {
  return reference - ((reference + BEIJING_OFFSET) % 86400);
}

/** 把 Unix 秒格式化为北京时间的 YYYY-MM-DD */
export function beijingDateKey(timestamp: number): string {
  return new Date((timestamp + BEIJING_OFFSET) * 1000).toISOString().slice(0, 10);
}

// 解析 User-Agent 简化信息
export function parseUserAgent(ua: string | null): { browser: string; os: string; device: string } {
  if (!ua) return { browser: 'Unknown', os: 'Unknown', device: 'Unknown' };
  let browser = 'Unknown';
  let os = 'Unknown';
  let device = 'Desktop';

  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Safari\//.test(ua)) browser = 'Safari';

  // 注意顺序：iOS 的 UA 里包含 "like Mac OS X"，必须先于 macOS 判断
  if (/Windows/.test(ua)) os = 'Windows';
  else if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/Mac OS/.test(ua)) os = 'macOS';
  else if (/Linux/.test(ua)) os = 'Linux';

  // 平板需先于手机判断（部分平板 UA 同时包含 Mobile）
  if (/iPad|Tablet/.test(ua)) device = 'Tablet';
  else if (/Mobile|Android|iPhone/.test(ua)) device = 'Mobile';

  return { browser, os, device };
}
