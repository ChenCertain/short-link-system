// 邮件发送服务
// Cloudflare Workers 通过 TCP Sockets API 直连 SMTP 服务器：
// 端口 465 使用 SSL 直连（推荐），其他端口（如 587）自动切换为 STARTTLS。

import { connect } from 'cloudflare:sockets';
import type { Env } from '../types';
import { escapeHtml } from '../utils';

const SITE_NAME = '短链接管理系统';

// 署名与源码地址：与前端 frontend/src/lib/brand.ts 保持一致（修改时请同步）
const AUTHOR_NAME = 'ChenCertain';
const SOURCE_URL = 'https://github.com/ChenCertain/short-link-system';
const LICENSE_NAME = 'AGPL-3.0-or-later';

/** 版权行：与网站首页页脚文案一致 */
function copyrightLine(): string {
  return `Copyright © ${new Date().getFullYear()} ${AUTHOR_NAME} · Licensed under ${LICENSE_NAME}`;
}

/**
 * GitHub 图标（32x32 PNG，Base64 内嵌）
 *
 * 邮件客户端普遍会过滤 SVG 与外部图片，因此用 Base64 内联 PNG：
 * 不依赖外链、不会被「显示图片」提示拦截，Gmail / Outlook / 邮件 App 均可显示。
 * 图标颜色 #64748b，与页脚文字一致。
 */
const GITHUB_ICON_DATA_URI = 'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAAD' +
  'WklEQVR4nK1XWWsUQRAeFW+joIj3iTHgg6KI4A/wQV9EJXgkEne7dxYSItmtnkR9cBBRd6pmo5Eg' +
  'xJh3jxdffVIQPAKiIr4pxBs1niRe0URqNsdu0r27SaZgYJjuru+ro6tqLKtIqahtmi0UHpAKW4XC' +
  'dgn0QSj8w0//e7sAuhgD2hd1vBIrLIk6XpkEahMKf0hFfcU8AqhbKLwUd7zSMQPbrjtDKvQFUE+x' +
  'wCOIZDyEVa47bVTgcccrlQqfjBVYQ+SuXde4qCjwaNLfyDENCzwrLK+EwvWFLYfwwbNJGD1hZ2I+' +
  'zO34VAJdlkCdYwD7LBReEUAPhodDmxNSoT9SEcYCcnbLZAkkJNC74DvQdwn0WADdkgpvSoWPpMIv' +
  '/WudUmFNuetO4bMCaLdG74ncuDtemS7bo463edi+kgjQOtd1J470Yd8EmfTXikR6bvbXSF3jag2B' +
  'riqFC4esB2rTudF2vE3WOCXecGalNkxAF4INQYUD6jZcn8rxEogBbdfnCXZVVzfPsjLlVQv+Vhw+' +
  't2C8BPoNfKbFcLy9nHytBoY1VkjCQAaMFvZAu2bh78Ejp+eFRYCvnS7MQuE9JvBRkyBvrJCFr62G' +
  'wHte+K3xwPOwCeg8LRT+svQ3AL+FTUAq7NDdBEsAvdAs9EaOnpofFjiXebZWg9PBIbivzdCkXxEW' +
  'AWMtALrDHjhvqAPtXF7DICCBbhiuYaMVU7jH1NGiCtV4wQVQxKRfKtwVNJigu+k39AqFJwc622ik' +
  'vPzqJAnkmEY6AfS1EmjmAMvmrIW0TPr7My12kMhLqdCNKtw6eEgjiUR6uqhPbZFJ75ip/GbpbBpy' +
  'UyK9ZiBLg0Ei6W+zG1JzdHOhUHhb344DQ67nBx1Mvp8SaFXOYR4Sst0TdbzF3N9Hjmi40xhvtr4Y' +
  'Agpdbb2WuW5v5e/xRHqJADougM5K8O3a2qapJgK8VghcAD00jumHkv4y7gP9G3uE4+0wgRm9kO8/' +
  'gnXXp5bmVRBJpDfkkFB4TSqsEwrj7DrO7nznuZMa6srrgmP5gDDL3HAMPflCwCKA/mksf8zetUYj' +
  'dmYSbggyNktZod8sza9ZqhBpK59kplps4g7JBYuJ5SeAn3gf1xa+3mMGHi5cMaNAKwrtsxtSy7mG' +
  'FKv4P9I9qMFuDzB3AAAAAElFTkSuQmCC';

/** 邮件页脚：与网站首页页脚一致的署名、版权与 GitHub 源码入口 */
function emailFooterHTML(extraLines: string[] = []): string {
  const lines = [
    ...extraLines.map((line) => `<div>${line}</div>`),
    `<div>作者：${escapeHtml(AUTHOR_NAME)} · ${escapeHtml(copyrightLine())}</div>`,
    // AGPL 第 13 条：提供获取源代码的途径（图标 + 文字）
    `<div style="margin-top:6px;">
      <a href="${escapeHtml(SOURCE_URL)}" target="_blank" rel="noopener" style="display:inline-block;color:#64748b;text-decoration:none;font-weight:500;line-height:14px;">
        <img src="${GITHUB_ICON_DATA_URI}" width="14" height="14" alt="GitHub" style="width:14px;height:14px;margin:0 5px 0 0;vertical-align:middle;border:0;outline:none;text-decoration:none;display:inline-block;" />
        <span style="vertical-align:middle;text-decoration:underline;">GitHub</span>
      </a>
    </div>`,
  ];
  return lines.join('');
}
const CODE_TTL_MINUTES = 10;

// 品牌色（与前端 Tailwind brand-600 保持一致）
const BRAND = '#2563eb';

type SmtpEnv = Pick<Env, 'SMTP_HOST' | 'SMTP_PORT' | 'SMTP_USER' | 'SMTP_PASS' | 'SMTP_FROM'>;

// 验证码邮件用途：决定标题、说明文案与安全提示
export type VerifyPurpose = 'login' | 'set_password' | 'change_email' | 'init_admin';

const PURPOSE_META: Record<VerifyPurpose, { subject: string; title: string; intro: string }> = {
  login: {
    subject: `${SITE_NAME}登录验证码`,
    title: '登录验证',
    intro: '你正在登录短链接管理系统，请输入下方验证码完成验证。',
  },
  set_password: {
    subject: `${SITE_NAME} - 设置登录密码`,
    title: '设置登录密码',
    intro: '你的账户还没有设置密码。请先在登录页输入下方验证码，然后设置一个新密码。',
  },
  change_email: {
    subject: `${SITE_NAME} - 更换邮箱验证码`,
    title: '更换绑定邮箱',
    intro: '你正在修改账户的绑定邮箱，请输入下方验证码以确认这个新邮箱属于你。',
  },
  init_admin: {
    subject: `${SITE_NAME} - 初始化管理员`,
    title: '初始化管理员账户',
    intro: '有人正在使用这个邮箱创建系统最高权限管理员账户。如果是你本人操作，请输入下方验证码。',
  },
};

export function isSmtpConfigured(env: SmtpEnv): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
}

export async function sendVerificationEmail(
  email: string,
  code: string,
  env: SmtpEnv,
  purpose: VerifyPurpose = 'login',
): Promise<boolean> {
  if (!isSmtpConfigured(env)) {
    // 未配置 SMTP 时（本地开发），验证码打印到控制台，并由接口返回给前端自动填充
    console.warn('[email] SMTP 未配置，验证码为：', code);
    return true;
  }

  const meta = PURPOSE_META[purpose] || PURPOSE_META.login;
  const html = buildVerificationEmailHTML({ code, title: meta.title, intro: meta.intro });
  const text = buildVerificationText(code, meta.title, meta.intro);
  return deliver(env, email, meta.subject, text, html, CODE_TTL_MINUTES);
}

/** 纯文本版本：不支持 HTML 的客户端也能清晰阅读 */
function buildVerificationText(code: string, title: string, intro: string): string {
  return [
    SITE_NAME,
    '',
    title,
    intro,
    '',
    `验证码：${code}`,
    '',
    `· 有效期 ${CODE_TTL_MINUTES} 分钟，请尽快使用`,
    '· 任何人索要验证码都是诈骗，请勿转发给他人',
    '· 如非本人操作，请忽略本邮件，你的账户不会被影响',
    '',
    `作者：${AUTHOR_NAME} · ${copyrightLine()}`,
    `GitHub：${SOURCE_URL}`,
  ].join('\n');
}

// ========== 邮件模板（统一外观） ==========

/** 邮件外层容器：头部渐变品牌条 + 内容卡片 + 底部说明 */
function emailShell(title: string, bodyHtml: string, footerNote: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f6fb;-webkit-font-smoothing:antialiased;">
  <!-- 预览文本：收件箱列表里显示，不进入正文 -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(title)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f6fb;padding:28px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
          <!-- 品牌头部 -->
          <tr>
            <td style="background:${BRAND};background:linear-gradient(135deg,${BRAND} 0%,#1d8cf8 55%,#06b6d4 100%);border-radius:14px 14px 0 0;padding:22px 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif;color:#ffffff;font-size:16px;font-weight:600;letter-spacing:.2px;">
                    ${escapeHtml(SITE_NAME)}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- 内容卡片 -->
          <tr>
            <td style="background:#ffffff;border-radius:0 0 14px 14px;padding:30px 28px 26px;box-shadow:0 8px 24px -12px rgba(15,23,42,.18);">
              ${bodyHtml}
            </td>
          </tr>
          <!-- 页脚 -->
          <tr>
            <td style="padding:18px 8px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif;color:#94a3b8;font-size:12px;line-height:1.7;text-align:center;">
              ${footerNote}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function heading(title: string): string {
  return `<h1 style="margin:0 0 10px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif;font-size:20px;line-height:1.4;color:#0f172a;font-weight:600;">${escapeHtml(title)}</h1>`;
}

function paragraph(text: string, color = '#64748b', marginBottom = 20): string {
  return `<p style="margin:0 0 ${marginBottom}px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif;font-size:14px;line-height:1.75;color:${color};">${escapeHtml(text)}</p>`;
}

function buildVerificationEmailHTML(opts: { code: string; title: string; intro: string }): string {
  const { code, title, intro } = opts;
  const body = `
    ${heading(title)}
    ${paragraph(intro, '#64748b', 22)}
    <!-- 验证码 -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">
      <tr>
        <td align="center" style="background:#f5f8ff;border:1px solid #dbeafe;border-radius:12px;padding:22px 12px;">
          <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif;font-size:12px;color:#64748b;letter-spacing:2px;margin-bottom:8px;">验 证 码</div>
          <div style="font-family:ui-monospace,SFMono-Regular,'SF Mono',Consolas,'Liberation Mono',monospace;font-size:34px;line-height:1.2;font-weight:700;letter-spacing:10px;color:${BRAND};">${escapeHtml(code)}</div>
        </td>
      </tr>
    </table>
    ${paragraph(`验证码 ${CODE_TTL_MINUTES} 分钟内有效，请尽快使用。`, '#64748b', 18)}
    <!-- 安全提示 -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;">
      <tr>
        <td style="background:#fffbeb;border-left:3px solid #f59e0b;border-radius:0 8px 8px 0;padding:12px 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif;font-size:12.5px;line-height:1.7;color:#92400e;">
          <strong style="font-weight:600;">安全提示：</strong>我们的工作人员不会以任何理由向你索要验证码，请勿转发或告知他人。
        </td>
      </tr>
    </table>
    ${paragraph('如果这不是你本人的操作，可以忽略本邮件，你的账户不会有任何变化。', '#94a3b8', 0)}
  `;
  return emailShell(
    title,
    body,
    emailFooterHTML(['本邮件由系统自动发送，请勿直接回复。']),
  );
}

function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function buildMimeMessage(from: string, to: string, subject: string, text: string, html: string): string {
  const boundary = '----=_Part_' + Math.random().toString(36).slice(2);
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${base64Utf8(subject)}?=`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2)}@short-link-system>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Utf8(text),
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Utf8(html),
    '',
    `--${boundary}--`,
    '',
  ];
  return lines.join('\r\n');
}

interface SmtpReply {
  code: number;
  text: string;
}

async function sendViaSMTP(env: SmtpEnv, from: string, to: string, mime: string): Promise<void> {
  const port = parseInt(env.SMTP_PORT || '465', 10);
  const secure = port === 465;

  const socket = connect(
    { hostname: env.SMTP_HOST, port },
    { secureTransport: secure ? 'on' : 'starttls', allowHalfOpen: false }
  );

  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = '';

  const readReply = async (): Promise<SmtpReply> => {
    const lines: string[] = [];
    for (;;) {
      const idx = buffer.indexOf('\r\n');
      if (idx === -1) {
        const { done, value } = await reader.read();
        if (done) throw new Error('SMTP 连接意外关闭');
        buffer += decoder.decode(value, { stream: true });
        continue;
      }
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      lines.push(line);
      if (/^\d{3} /.test(line)) {
        return { code: parseInt(line.slice(0, 3), 10), text: lines.join('\n') };
      }
    }
  };

  const send = async (command: string) => {
    await writer.write(encoder.encode(command + '\r\n'));
  };

  const expect = (reply: SmtpReply, codes: number[], action: string) => {
    if (!codes.includes(reply.code)) {
      throw new Error(`SMTP ${action} 失败 (${reply.code}): ${reply.text}`);
    }
  };

  try {
    // 1. 服务端问候
    expect(await readReply(), [220], '连接');

    // 2. EHLO
    const hostname = (from.split('@')[1] || 'localhost').trim();
    await send(`EHLO ${hostname}`);
    expect(await readReply(), [250], 'EHLO');

    // 3. AUTH LOGIN
    await send('AUTH LOGIN');
    expect(await readReply(), [334], 'AUTH');

    await send(btoa(env.SMTP_USER));
    expect(await readReply(), [334], 'AUTH 用户名');

    await send(btoa(env.SMTP_PASS));
    expect(await readReply(), [235], 'AUTH 密码');

    // 4. 发件人
    await send(`MAIL FROM:<${from}>`);
    expect(await readReply(), [250], 'MAIL FROM');

    // 5. 收件人
    await send(`RCPT TO:<${to}>`);
    expect(await readReply(), [250, 251], 'RCPT TO');

    // 6. 正文
    await send('DATA');
    expect(await readReply(), [354], 'DATA');

    // 邮件内容中的行首 "." 需要转义
    const normalized = mime.replace(/\r\n\./g, '\r\n..');
    await writer.write(encoder.encode(normalized + (normalized.endsWith('\r\n') ? '' : '\r\n') + '.\r\n'));
    expect(await readReply(), [250], '发送正文');

    // 7. 退出
    await send('QUIT');
    await readReply().catch(() => undefined);
  } finally {
    try {
      await writer.close();
    } catch {
      // ignore
    }
  }
}

// ========== 通用投递 ==========

async function deliver(
  env: SmtpEnv,
  to: string,
  subject: string,
  text: string,
  html: string,
  _ttlMinutes?: number,
): Promise<boolean> {
  if (!isSmtpConfigured(env)) {
    console.warn('[email] SMTP 未配置，跳过发送：', subject, to);
    return true;
  }
  try {
    const from = env.SMTP_FROM || env.SMTP_USER;
    await sendViaSMTP(env, from, to, buildMimeMessage(from, to, subject, text, html));
    return true;
  } catch (err) {
    console.error('[email] 发送失败:', err);
    return false;
  }
}

// 通知类邮件的状态徽标配色
type BadgeTone = 'success' | 'danger' | 'warning' | 'info';

const BADGE_STYLES: Record<BadgeTone, { bg: string; color: string; border: string; label: string }> = {
  success: { bg: '#ecfdf5', color: '#047857', border: '#a7f3d0', label: '✓' },
  danger: { bg: '#fef2f2', color: '#b91c1c', border: '#fecaca', label: '✕' },
  warning: { bg: '#fffbeb', color: '#92400e', border: '#fde68a', label: '!' },
  info: { bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe', label: 'i' },
};

/** 通知邮件：标题 + 状态徽标 + 说明 + 键值明细表 + 可选按钮 */
function buildNoticeHTML(opts: {
  title: string;
  tone: BadgeTone;
  statusText: string;
  intro: string;
  rows: { label: string; value: string; mono?: boolean }[];
  cta?: { label: string; url: string } | null;
  footer: string;
}): string {
  const { title, tone, statusText, intro, rows, cta, footer } = opts;
  const style = BADGE_STYLES[tone];

  const rowsHtml = rows
    .map((row, index) => {
      const borderTop = index === 0 ? 'none' : '1px solid #eef2f7';
      const valueStyle = row.mono
        ? "font-family:ui-monospace,SFMono-Regular,'SF Mono',Consolas,monospace;font-size:13px;"
        : 'font-size:13.5px;';
      return `<tr>
        <td style="padding:11px 0;border-top:${borderTop};color:#64748b;font-size:13px;width:88px;vertical-align:top;white-space:nowrap;">${escapeHtml(row.label)}</td>
        <td style="padding:11px 0;border-top:${borderTop};color:#0f172a;${valueStyle}line-height:1.6;word-break:break-all;">${escapeHtml(row.value)}</td>
      </tr>`;
    })
    .join('');

  const ctaHtml = cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 6px;">
        <tr>
          <td style="background:${BRAND};border-radius:10px;">
            <a href="${escapeHtml(cta.url)}" target="_blank" rel="noopener" style="display:inline-block;padding:11px 22px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">${escapeHtml(cta.label)}</a>
          </td>
        </tr>
      </table>`
    : '';

  const body = `
    ${heading(title)}
    <div style="margin:0 0 14px;">
      <span style="display:inline-block;padding:4px 10px;border-radius:999px;background:${style.bg};border:1px solid ${style.border};color:${style.color};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif;font-size:12px;font-weight:600;">${escapeHtml(statusText)}</span>
    </div>
    ${paragraph(intro, '#64748b', 20)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;background:#f8fafc;border:1px solid #eef2f7;border-radius:10px;">
      <tr><td style="padding:4px 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tbody>${rowsHtml}</tbody></table></td></tr>
    </table>
    ${ctaHtml}
  `;

  return emailShell(title, body, emailFooterHTML(footer.split('<br>')));
}

// ========== 短链审核通知 ==========

export interface ReviewRequestPayload {
  applicantName: string;
  applicantEmail: string;
  linkName: string;
  shortCode: string;
  targetUrl: string;
  /** 后台审核页完整地址（可选）：有值时渲染「去处理」按钮 */
  reviewUrl?: string;
}

// 通知管理员：有新的短链待审核
export async function sendReviewRequestEmail(to: string, payload: ReviewRequestPayload, env: SmtpEnv): Promise<boolean> {
  const subject = `【待审核】${payload.linkName || payload.shortCode} · ${SITE_NAME}`;
  const text = [
    `${payload.applicantName}（${payload.applicantEmail}）提交了一条短链审核申请，需要你处理。`,
    '',
    `名称：${payload.linkName || '未命名'}`,
    `短码：${payload.shortCode}`,
    `目标链接：${payload.targetUrl}`,
    '',
    payload.reviewUrl ? `前往审核：${payload.reviewUrl}` : '请登录管理后台 →「短链审核」进行审批。',
    '',
    `作者：${AUTHOR_NAME} · ${copyrightLine()}`,
    `GitHub：${SOURCE_URL}`,
  ].join('\n');
  const html = buildNoticeHTML({
    title: '有新的短链待审核',
    tone: 'warning',
    statusText: '● 待审核',
    intro: `${payload.applicantName}（${payload.applicantEmail}）提交了一条短链，需要你审核通过后才能生效。`,
    rows: [
      { label: '名称', value: payload.linkName || '未命名' },
      { label: '短码', value: payload.shortCode, mono: true },
      { label: '目标链接', value: payload.targetUrl, mono: true },
      { label: '提交人', value: `${payload.applicantName}（${payload.applicantEmail}）` },
    ],
    cta: payload.reviewUrl ? { label: '前往审核', url: payload.reviewUrl } : null,
    footer: '如按钮无法点击，请登录管理后台 →「短链审核」处理。<br>本邮件由系统自动发送，请勿直接回复。',
  });
  return deliver(env, to, subject, text, html);
}

export interface ReviewResultPayload {
  approved: boolean;
  /** 未命名时回退为短码 */
  linkName: string;
  shortCode: string;
  /** 驳回原因（仅驳回时有值） */
  note?: string | null;
  /** 短链完整地址（可选）：通过时展示，方便直接复制使用 */
  shortUrl?: string;
  /** 目标链接（可选）：回显给提交人确认 */
  targetUrl?: string;
  /** 审核人姓名（可选） */
  reviewerName?: string | null;
  /** 审核人邮箱（可选） */
  reviewerEmail?: string | null;
  /** 审核时间（Unix 秒，可选） */
  reviewedAt?: number | null;
}

/** 北京时间格式化（与前端 formatDateTime 口径一致：UTC+8） */
function formatBeijingTime(ts?: number | null): string {
  if (!ts) return '';
  const d = new Date((ts + 8 * 3600) * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

// 通知用户：审核结果
export async function sendReviewResultEmail(to: string, payload: ReviewResultPayload, env: SmtpEnv): Promise<boolean> {
  const displayName = payload.linkName || '未命名短链';
  const subject = payload.approved
    ? `【已通过】${displayName} · ${SITE_NAME}`
    : `【未通过】${displayName} · ${SITE_NAME}`;

  // 审核人：姓名（邮箱），两者都没有时显示「系统管理员」
  const reviewerText = payload.reviewerName && payload.reviewerEmail
    ? `${payload.reviewerName}（${payload.reviewerEmail}）`
    : payload.reviewerName || payload.reviewerEmail || '系统管理员';
  const reviewedAtText = formatBeijingTime(payload.reviewedAt);

  const rows: { label: string; value: string; mono?: boolean }[] = [
    { label: '名称', value: displayName },
    { label: '短码', value: payload.shortCode, mono: true },
  ];
  if (payload.approved && payload.shortUrl) {
    rows.push({ label: '短链地址', value: payload.shortUrl, mono: true });
  }
  if (payload.targetUrl) {
    rows.push({ label: '目标链接', value: payload.targetUrl, mono: true });
  }
  if (!payload.approved && payload.note) {
    rows.push({ label: '驳回原因', value: payload.note });
  }
  rows.push({ label: '审核人', value: reviewerText });
  if (reviewedAtText) {
    rows.push({ label: '审核时间', value: reviewedAtText });
  }

  const intro = payload.approved
    ? '你提交的短链已通过审核，现在可以正常访问和分享了。'
    : '你提交的短链未通过审核，暂时无法访问。';
  const outro = payload.approved
    ? ''
    : '\n\n你可以修改目标链接或名称后重新提交审核；如有疑问请联系所属项目组管理员。';

  const text = [
    `你提交的短链「${displayName}」（短码：${payload.shortCode}）${payload.approved ? '已通过审核' : '未通过审核'}。`,
    '',
    ...rows.map((r) => `${r.label}：${r.value}`),
    outro.trim(),
    '',
    `作者：${AUTHOR_NAME} · ${copyrightLine()}`,
    `GitHub：${SOURCE_URL}`,
  ].filter(Boolean).join('\n');

  const html = buildNoticeHTML({
    title: payload.approved ? '短链审核已通过' : '短链审核未通过',
    tone: payload.approved ? 'success' : 'danger',
    statusText: payload.approved ? '✓ 已通过' : '✕ 未通过',
    intro,
    rows,
    cta: null,
    footer: payload.approved
      ? '本邮件由系统自动发送，请勿直接回复。'
      : '可修改后重新提交审核；如有疑问请联系所属项目组管理员。<br>本邮件由系统自动发送，请勿直接回复。',
  });
  return deliver(env, to, subject, text, html);
}
