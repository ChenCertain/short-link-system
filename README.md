# 短链接管理系统

基于 **Cloudflare Workers（前端静态资源 + API + 短链跳转）+ D1 + KV** 的短链管理系统。
单个 Worker 即可承载整站，仓库中只有代码，不含任何用户与短链数据，每个实例使用独立的 D1 / KV。

## 特性

- **三级权限模型**：超级管理员 / 项目组管理员 / 普通用户
- **项目组与子组**：组内成员管理、子组继承、组域名绑定（组内短链只能使用本组可用域名）
- **短链管理**：自定义别名、密码保护、定时过期或长期有效、301/302 跳转、二维码
- **短链审核**：按用户开启审核，组管理员优先审核、无组或组内无管理员时由超级管理员兜底，支持邮件通知
- **域名管理**：多域名添加 / 启停 / 设默认 / DNS 验证
- **访问统计**：全局与单短链指标，明细含访问 IP、地区、来源与设备
- **操作审计**：登录与关键操作留痕，记录操作 IP
- **安全登录**：邮箱验证码 + Cloudflare Turnstile 人机验证
- **落地首页**：功能介绍、使用流程与技术架构，支持暗色模式与移动端
- 批量导入、暗色模式、响应式布局与 404 页面

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 18 + Vite + TypeScript + TailwindCSS |
| 后端 | Cloudflare Workers + Hono |
| 数据库 | Cloudflare D1 |
| 缓存 | Cloudflare KV |
| 人机验证 | Cloudflare Turnstile |
| 邮件 | 飞书 SMTP |

## 权限模型

| 角色 | 能力 |
|------|------|
| 超级管理员 | 全局管理：用户、域名、项目组、系统设置、审计日志、指标统计、审批 |
| 项目组管理员 | 管理所在项目组的成员（可按完整邮箱精确查找并添加普通成员），查看组内短链与访问数据，审核组内短链；不能授予管理员身份，也不能绑定域名 |
| 普通用户 | 创建与管理自己的短链，查看所在项目组的短链 |

## 项目结构

```
.
├── frontend/            # React 前端（Vite 构建到 frontend/dist）
│   ├── public/          # 静态资源（favicon.svg）
│   └── src/
│       ├── components/  # Layout、Logo、UI 组件、守卫、Toast 等
│       ├── pages/       # 首页、登录、404、控制台各模块
│       ├── contexts/    # 认证上下文
│       └── lib/         # API 封装、类型、工具函数
├── worker/              # Cloudflare Worker 后端
│   ├── src/routes/      # auth / users / groups / links / stats / audit ...
│   ├── src/permissions.ts
│   └── wrangler.toml
├── migrations/          # D1 数据库迁移（0001 ~ 0006）
├── scripts/             # 构建期配置生成脚本
└── DEPLOY.md            # 完整部署指南
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置

单实例：直接编辑 `worker/wrangler.toml`，至少填入 D1 数据库 ID、KV 命名空间 ID；Turnstile Site Key 与访问域名可留空，之后再补。

多实例 / Git 自动构建：仓库内配置保持留空，在每个 Cloudflare 项目里配置构建变量 `D1_DATABASE_ID`、`KV_NAMESPACE_ID`（必填），构建时执行 `npm run build:config` 生成本次实例专属配置，互不覆盖。`TURNSTILE_SITE_KEY`、`PAGES_DOMAIN`、`SMTP_*` 均可留空，Turnstile 留空时自动关闭人机验证。

敏感信息（`JWT_SECRET`、`SMTP_PASS`）通过 Cloudflare Secret 配置；`TURNSTILE_SECRET_KEY` 仅在启用 Turnstile 时必填。详见 [部署指南](./DEPLOY.md)。

### 3. 数据库迁移

```bash
# 本地开发
npm run db:migrate

# 远程（生产）
npm run db:migrate:remote
```

### 4. 本地开发

```bash
npm run dev:worker     # 终端 1：Worker（http://localhost:8787）
npm run dev:frontend   # 终端 2：前端（http://localhost:5173，已代理 /api）
```

### 5. 构建与部署

```bash
npm run build    # 构建前端 + 检查 Worker 类型
npm run deploy   # 构建并部署到 Cloudflare
```

完整流程见 [部署指南](./DEPLOY.md)。

## 环境变量

| 变量 | 说明 |
|------|------|
| `DB` | D1 数据库绑定 |
| `KV` | KV 命名空间绑定 |
| `JWT_SECRET` | JWT 签名密钥（Secret） |
| `TURNSTILE_SITE_KEY` | Turnstile 站点密钥（可留空，留空即关闭人机验证） |
| `TURNSTILE_SECRET_KEY` | Turnstile 密钥（Secret，启用时必填） |
| `SMTP_HOST` / `SMTP_PORT` | SMTP 地址与端口 |
| `SMTP_USER` / `SMTP_PASS` | SMTP 账号与密码（`SMTP_PASS` 为 Secret） |
| `SMTP_FROM` | 发件人地址 |
| `PAGES_DOMAIN` | 本实例访问域名（用于短链地址展示与 DNS 指引） |

> 本地开发可把敏感变量写入 `worker/.dev.vars`，该文件已被 `.gitignore` 忽略。

## License

[MIT](./LICENSE) © 2026 ChenCertain
