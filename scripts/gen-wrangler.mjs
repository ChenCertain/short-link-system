#!/usr/bin/env node
/**
 * 多实例部署：根据环境变量从 worker/wrangler.toml 生成实例专属配置
 * 输出：worker/wrangler.build.toml（已被 .gitignore 忽略，不会提交）
 *
 * 用法：
 *   D1_DATABASE_ID=xxx KV_NAMESPACE_ID=yyy TURNSTILE_SITE_KEY=zzz \
 *   PAGES_DOMAIN=sl.example.com node scripts/gen-wrangler.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const workerDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'worker')
const templateFile = resolve(workerDir, 'wrangler.toml')
const outputFile = resolve(workerDir, 'wrangler.build.toml')

/** key 在 wrangler.toml 中的字段名；env 为构建环境变量名；required 为必填 */
const fields = [
  { key: 'name', env: 'WORKER_NAME', required: false, label: 'Worker 名称' },
  { key: 'database_name', env: 'D1_DATABASE_NAME', required: false, label: 'D1 数据库名' },
  { key: 'database_id', env: 'D1_DATABASE_ID', required: true, label: 'D1 数据库 ID' },
  { key: 'id', env: 'KV_NAMESPACE_ID', required: true, label: 'KV 命名空间 ID' },
  { key: 'TURNSTILE_SITE_KEY', env: 'TURNSTILE_SITE_KEY', required: false, label: 'Turnstile Site Key', defaultValue: '' },
  { key: 'SMTP_HOST', env: 'SMTP_HOST', required: false, label: 'SMTP 地址' },
  { key: 'SMTP_PORT', env: 'SMTP_PORT', required: false, label: 'SMTP 端口' },
  { key: 'SMTP_USER', env: 'SMTP_USER', required: false, label: 'SMTP 账号' },
  { key: 'SMTP_FROM', env: 'SMTP_FROM', required: false, label: '发件人地址' },
  { key: 'PAGES_DOMAIN', env: 'PAGES_DOMAIN', required: false, label: '访问域名', defaultValue: '' },
]

const overrides = new Map()
const missing = []
for (const field of fields) {
  const value = (process.env[field.env] || '').trim()
  if (value) {
    overrides.set(field.key, value)
  } else if (field.required) {
    missing.push(field.env)
  } else if (field.defaultValue !== undefined) {
    // 可选字段未提供时写入空串，避免把模板占位符带到部署配置里
    overrides.set(field.key, field.defaultValue)
  }
}

if (missing.length > 0) {
  console.error('[gen-wrangler] 缺少必填环境变量: ' + missing.join(', '))
  console.error('[gen-wrangler] 请在 Cloudflare「构建 → 变量和机密」或本地 shell 中设置后重试')
  process.exit(1)
}

const template = readFileSync(templateFile, 'utf8')
const output = template
  .split(/\r?\n/)
  .map((line) => {
    // 仅匹配 KEY = "VALUE" 形式的配置行，注释与段名不受影响
    const matched = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)"(.*)"\s*$/)
    if (!matched) return line
    const [, indent, key, eq] = matched
    if (!overrides.has(key)) return line
    return `${indent}${key}${eq}"${overrides.get(key)}"`
  })
  .join('\n')

const leftover = [...output.matchAll(/REPLACE_WITH_[A-Z0-9_]+/g)].map((m) => m[0])
if (leftover.length > 0) {
  console.error('[gen-wrangler] 仍存在未替换的占位符: ' + [...new Set(leftover)].join(', '))
  process.exit(1)
}

writeFileSync(outputFile, output.endsWith('\n') ? output : output + '\n', 'utf8')

console.log('[gen-wrangler] 已生成 worker/wrangler.build.toml')
for (const field of fields) {
  const value = overrides.get(field.key)
  if (value) {
    console.log(`  ${field.label}: ${value}`)
  } else if (field.defaultValue === '') {
    console.log(`  ${field.label}: 未设置（对应功能自动关闭）`)
  }
}
