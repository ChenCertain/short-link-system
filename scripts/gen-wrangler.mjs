#!/usr/bin/env node
/**
 * 多实例部署：根据环境变量从 worker/wrangler.toml 生成实例专属配置
 * 输出：worker/wrangler.build.toml（已被 .gitignore 忽略，不会提交）
 *
 * 只注入「构建期必须写进配置文件」的资源 ID（D1 / KV / Worker 名）。
 * 运行时环境变量（TURNSTILE_SITE_KEY、SMTP_*、PAGES_DOMAIN、WORKER_HOST 等）
 * 一律在 Cloudflare 控制台的「变量和密钥」中维护，不写入配置文件，
 * 避免 `wrangler deploy` 用配置文件里的空值覆盖线上已有变量。
 *
 * 用法：
 *   D1_DATABASE_ID=xxx KV_NAMESPACE_ID=yyy node scripts/gen-wrangler.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const workerDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'worker')
const templateFile = resolve(workerDir, 'wrangler.toml')
const outputFile = resolve(workerDir, 'wrangler.build.toml')

/**
 * 构建期字段：只包含必须写进配置文件的内容。
 * key 为 wrangler.toml 中的字段名；env 为构建环境变量名；required 为必填。
 */
const fields = [
  { key: 'name', env: 'WORKER_NAME', required: false, label: 'Worker 名称' },
  { key: 'database_name', env: 'D1_DATABASE_NAME', required: false, label: 'D1 数据库名' },
  { key: 'database_id', env: 'D1_DATABASE_ID', required: true, label: 'D1 数据库 ID' },
  { key: 'id', env: 'KV_NAMESPACE_ID', required: true, label: 'KV 命名空间 ID' },
]

/**
 * 运行时变量：不再写入配置文件，仅在缺少时给出提醒。
 * 这些变量需要在 Cloudflare「Worker → 设置 → 变量和密钥」中配置。
 */
const runtimeOnlyVars = [
  'TURNSTILE_SITE_KEY',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_FROM',
  'PAGES_DOMAIN',
  'WORKER_HOST',
]

const overrides = new Map()
const missing = []
for (const field of fields) {
  const value = (process.env[field.env] || '').trim()
  if (value) {
    overrides.set(field.key, value)
  } else if (field.required) {
    missing.push(field.env)
  }
}

if (missing.length > 0) {
  console.error('[gen-wrangler] 缺少必填环境变量: ' + missing.join(', '))
  console.error('[gen-wrangler] 请在 Cloudflare「构建 → 变量和机密」或本地 shell 中设置后重试')
  process.exit(1)
}

// 模板中不应再出现 [vars] 段：一旦出现，说明有人把运行时变量写回了配置文件，
// 部署时会覆盖线上变量，这里直接让构建失败，避免再次发生「登录不可用」事故。
const template = readFileSync(templateFile, 'utf8')
if (/^\s*\[vars\]\s*$/m.test(template)) {
  console.error('[gen-wrangler] worker/wrangler.toml 中不应包含 [vars] 段。')
  console.error('[gen-wrangler] 运行时变量请配置在 Cloudflare「变量和密钥」中，否则部署会覆盖线上配置。')
  process.exit(1)
}

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

console.log('[gen-wrangler] 已生成 worker/wrangler.build.toml（仅含构建期配置）')
for (const field of fields) {
  const value = overrides.get(field.key)
  if (value) console.log(`  ${field.label}: ${value}`)
}
console.log('  运行时变量未写入配置文件，请在 Cloudflare「变量和密钥」中维护：')
console.log('    ' + runtimeOnlyVars.join(', '))
