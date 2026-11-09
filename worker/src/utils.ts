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
export const ALIAS_MAX_LENGTH = 64;

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

// JWT 签发（HMAC-SHA256）
export async function signJWT(payload: Omit<JWTPayload, 'iat' | 'exp'> & { exp?: number }, secret: string): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  const exp = payload.exp ?? iat + 7 * 24 * 3600; // 默认7天
  const fullPayload: JWTPayload = { ...payload, iat, exp };

  const encoder = new TextEncoder();
  const header = base64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64urlEncode(JSON.stringify(fullPayload));

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
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
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
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

  if (/Windows/.test(ua)) os = 'Windows';
  else if (/Mac OS/.test(ua)) os = 'macOS';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/iPhone|iPad/.test(ua)) os = 'iOS';
  else if (/Linux/.test(ua)) os = 'Linux';

  if (/Mobile|Android|iPhone/.test(ua)) device = 'Mobile';
  else if (/iPad|Tablet/.test(ua)) device = 'Tablet';

  return { browser, os, device };
}
