// 邮件发送服务
// Cloudflare Workers 通过 TCP Sockets API 直连 SMTP 服务器（支持 SSL 465）
// 若需使用 587 STARTTLS，请改用第三方 HTTP 邮件 API

import { connect } from 'cloudflare:sockets';
import type { Env } from '../types';

const MAIL_SUBJECT = '短链接管理系统登陆/注册验证';

type SmtpEnv = Pick<Env, 'SMTP_HOST' | 'SMTP_PORT' | 'SMTP_USER' | 'SMTP_PASS' | 'SMTP_FROM'>;

export function isSmtpConfigured(env: SmtpEnv): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
}

export async function sendVerificationEmail(
  email: string,
  code: string,
  env: SmtpEnv,
  subject: string = MAIL_SUBJECT
): Promise<boolean> {
  if (!isSmtpConfigured(env)) {
    // 未配置 SMTP 时（本地开发），验证码打印到控制台，并由接口返回给前端自动填充
    console.warn('[email] SMTP 未配置，验证码为：', code);
    return true;
  }

  const html = buildVerificationEmailHTML(code);
  const text = `您的验证码是：${code}，有效期 10 分钟。请勿泄露给他人。`;
  const mime = buildMimeMessage(env.SMTP_FROM || env.SMTP_USER, email, subject, text, html);

  try {
    await sendViaSMTP(env, env.SMTP_FROM || env.SMTP_USER, email, mime);
    return true;
  } catch (err) {
    console.error('[email] SMTP 发送失败:', err);
    return false;
  }
}

function buildVerificationEmailHTML(code: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5;margin:0;padding:20px;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <h1 style="color:#1a1a1a;font-size:22px;margin:0 0 16px;">短链接管理系统</h1>
    <p style="color:#666;font-size:14px;margin:0 0 24px;">您正在进行登陆/注册验证，请使用以下验证码完成操作：</p>
    <div style="background:#f0f4ff;border-radius:8px;padding:20px;text-align:center;margin-bottom:24px;">
      <span style="font-size:32px;font-weight:700;letter-spacing:8px;color:#2563eb;font-family:monospace;">${code}</span>
    </div>
    <p style="color:#999;font-size:12px;margin:0;">验证码有效期 10 分钟，请勿泄露给他人。如非本人操作，请忽略此邮件。</p>
  </div>
</body>
</html>`;
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function deliver(
  env: SmtpEnv,
  to: string,
  subject: string,
  text: string,
  html: string
): Promise<boolean> {
  if (!isSmtpConfigured(env)) {
    console.warn('[email] SMTP 未配置，跳过发送：', subject, to);
    return true;
  }
  try {
    await sendViaSMTP(env, env.SMTP_FROM || env.SMTP_USER, to, buildMimeMessage(env.SMTP_FROM || env.SMTP_USER, to, subject, text, html));
    return true;
  } catch (err) {
    console.error('[email] 发送失败:', err);
    return false;
  }
}

function buildNoticeHTML(title: string, intro: string, rows: { label: string; value: string }[], footer: string): string {
  const rowsHtml = rows
    .map(
      (row) => `<tr>
        <td style="padding:8px 0;color:#666;font-size:14px;width:88px;vertical-align:top;">${escapeHtml(row.label)}</td>
        <td style="padding:8px 0;color:#1a1a1a;font-size:14px;word-break:break-all;">${escapeHtml(row.value)}</td>
      </tr>`
    )
    .join('');
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5;margin:0;padding:20px;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <h1 style="color:#1a1a1a;font-size:20px;margin:0 0 12px;">${escapeHtml(title)}</h1>
    <p style="color:#666;font-size:14px;margin:0 0 20px;line-height:1.6;">${escapeHtml(intro)}</p>
    <table style="width:100%;border-collapse:collapse;background:#f8faff;border-radius:8px;padding:8px 16px;">
      <tbody>${rowsHtml}</tbody>
    </table>
    <p style="color:#999;font-size:12px;margin:20px 0 0;line-height:1.6;">${escapeHtml(footer)}</p>
  </div>
</body>
</html>`;
}

// ========== 短链审核通知 ==========

export interface ReviewRequestPayload {
  applicantName: string;
  applicantEmail: string;
  linkName: string;
  shortCode: string;
  targetUrl: string;
}

// 通知管理员：有新的短链待审核
export async function sendReviewRequestEmail(to: string, payload: ReviewRequestPayload, env: SmtpEnv): Promise<boolean> {
  const subject = '短链接管理系统 - 新短链待审核';
  const text = `${payload.applicantName}（${payload.applicantEmail}）提交了短链审核申请：\n名称：${payload.linkName || '未命名'}\n短码：${payload.shortCode}\n目标链接：${payload.targetUrl}\n请登录管理后台「短链审核」处理。`;
  const html = buildNoticeHTML(
    '有新的短链待审核',
    `${payload.applicantName}（${payload.applicantEmail}）提交了一条短链，需要你审核后才能生效。`,
    [
      { label: '名称', value: payload.linkName || '未命名' },
      { label: '短码', value: payload.shortCode },
      { label: '目标链接', value: payload.targetUrl },
    ],
    '请登录短链接管理系统 →「短链审核」进行处理。'
  );
  return deliver(env, to, subject, text, html);
}

export interface ReviewResultPayload {
  approved: boolean;
  linkName: string;
  shortCode: string;
  note?: string | null;
}

// 通知用户：审核结果
export async function sendReviewResultEmail(to: string, payload: ReviewResultPayload, env: SmtpEnv): Promise<boolean> {
  const subject = payload.approved ? '短链接管理系统 - 短链审核通过' : '短链接管理系统 - 短链审核未通过';
  const text = payload.approved
    ? `你提交的短链「${payload.linkName || '未命名'}」（短码：${payload.shortCode}）已通过审核，现在可以正常访问。`
    : `你提交的短链「${payload.linkName || '未命名'}」（短码：${payload.shortCode}）未通过审核。${payload.note ? `原因：${payload.note}` : ''}`;
  const rows = [
    { label: '名称', value: payload.linkName || '未命名' },
    { label: '短码', value: payload.shortCode },
    { label: '结果', value: payload.approved ? '已通过' : '未通过' },
  ];
  if (payload.note) rows.push({ label: '说明', value: payload.note });
  const html = buildNoticeHTML(
    payload.approved ? '短链审核通过' : '短链审核未通过',
    payload.approved
      ? '你提交的短链已通过审核，现在可以正常访问。'
      : '你提交的短链未通过审核，如有疑问请联系管理员。',
    rows,
    '本邮件由短链接管理系统自动发送，请勿直接回复。'
  );
  return deliver(env, to, subject, text, html);
}
