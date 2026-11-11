# 短链接管理系统

[![License: AGPL--3.0--or--later](https://img.shields.io/badge/License-AGPL--3.0--or--later-blue.svg)](./LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](https://react.dev/)

基于 **Cloudflare Workers（前端静态资源 + API + 短链跳转）+ D1 + KV** 的短链管理系统。
单个 Worker 即可承载整站，仓库中只有代码，不含任何用户与短链数据，每个实例使用独立的 D1 / KV。

## 特性

- **三级权限模型**：超级管理员 / 项目组管理员 / 普通用户
- **项目组与子组**：组内成员管理、子组继承、组域名绑定（组内短链只能使用本组可用域名）
- **短链管理**：自定义别名、密码保护、定时过期或长期有效、301/302 跳转、二维码
- **短链审核**：按用户开启审核，审核归属支持「组内管理员（逐级向上）/ 父组管理员 / 超级管理员」三种方式；未配置或配置范围内无具备审核权限的管理员时，会自动向更上层寻找，最终由超级管理员兜底，支持邮件通知
- **域名管理**：多域名添加 / 启停 / 设默认 / DNS 验证
- **访问统计**：全局与单短链指标，明细含访问 IP、地区、来源与设备
- **操作审计**：登录与关键操作留痕，记录操作 IP
- **安全登录**：邮箱验证码 + Cloudflare Turnstile 人机验证
- **落地首页**：功能介绍与使用流程，支持移动端
- **主题跟随系统**：默认随操作系统浅色 / 深色自动切换，也可在「个人设置 → 外观」固定为浅色或深色
- 批量导入、响应式布局与 404 页面

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 18 + Vite + TypeScript + TailwindCSS |
| 后端 | Cloudflare Workers + Hono |
| 数据库 | Cloudflare D1 |
| 缓存 | Cloudflare KV |
| 人机验证 | Cloudflare Turnstile |
| 邮件 | 任意 SMTP 服务商（推荐 SSL 465） |

## 权限模型

默认角色能力如下，所有条目都可以在同一角色内**按人单独覆盖**（见「细粒度权限」）。

| 角色 | 默认能力 |
|------|------|
| 超级管理员 | 全局管理：用户、域名、项目组、系统设置、审计日志、指标统计、审批；在「用户管理 → 权限」中为任意用户配置全局权限。**最高权限账户**（站点初始化时创建的超级管理员，`users.is_root = 1`）是唯一的最高权限角色，可编辑 / 降级 / 删除其他超级管理员，其他超级管理员无法修改或移除它，且它不能被降级或禁用 |
| 项目组管理员 | 组内全部权限：创建 / 删除子组、绑定 / 解绑组域名、创建用户（同级组仅普通成员、子组可设组管理员）、添加 / 移除成员、设置子组管理员、配置成员权限与审核方式、审核组内短链、编辑与删除组内任意短链；权限沿父组向下继承 |
| 普通用户 | 创建短链、查看组内短链、编辑 / 删除自己的短链；**组内他人短链的访问数据默认不可见**，需由组管理员单独开启「查看短链数据」 |

删除规则：超级管理员可删除任意项目组；组管理员可删除自己管理组下的**子组**（需具备「删除子组」权限），但不能删除自己直接管理的组。组内仍有子组或短链时必须先处理，避免产生孤儿数据。

### 细粒度权限

权限目录（`worker/src/permissions.ts` 与 `frontend/src/lib/permissions.ts` 保持同步）：

- 用户：在「成员管理」中创建用户（同级组只能创建普通成员，子组可创建组管理员）、配置成员短链审核方式
- 短链：创建短链、查看组内短链、查看短链数据（`link.view.data`，查看点击趋势 / 来源 / 地区与访问明细，默认仅组管理员拥有）、编辑 / 删除自己的短链、编辑 / 删除组内任意短链、审核组内短链
- 项目组管理：创建子组、删除子组（`group.delete`）、管理组域名
- 成员管理：创建用户（`group.user.create`）、添加成员、移除成员、设置成员身份、配置成员权限与审核方式
- 全局管理：用户管理（`user.manage`）、操作审计（`audit.view`）

生效规则：

- 覆盖项以 JSON 存在 `user_group_relations.permissions`（组内）与 `users.permissions`（全局），仅保存与默认值不同的项；
- 组内权限沿父组链解析：最近的一条关联记录决定覆盖项，链上任意一层是管理员即按管理员默认权限生效，因此父组管理员天然管理子组（即使同时是子组普通成员）；
- 组管理员可设置子组管理员、为组内 / 子组成员逐项开关权限；同级组管理员之间不能互相修改身份 / 权限 / 移除，需由上级管理员或超级管理员处理；
- 超级管理员之间：只有「最高权限账户」能编辑 / 降级 / 删除其他超级管理员，其他超级管理员不能修改它；
- 后端的每个接口都会做权限校验，前端菜单与按钮仅作为可见性提示；
- 普通成员在项目组详情中看不到其他成员的**最后登录 IP** 与**已开启权限数量**，该信息仅对超管与具备「配置成员权限」的管理员开放。

超级管理员在「用户管理」中点击用户可查看其**最后登录 IP、操作 IP 列表（含归属地）、所在项目组（含组内身份）、创建的短链以及分页操作记录**，用户列表支持按项目组 / 组内身份 / 角色 / 状态筛选，并可直接在用户详情中编辑或删除其短链；组管理员在「成员管理」中可查看并管理自己项目组的全部成员：添加 / 移出成员、设置子组管理员、逐项配置组内权限，并可直接管理成员短链（改目标链接、归属项目组、状态等）。

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
│   ├── src/routes/      # auth / users / groups / links / stats / audit / domains / profile
│   ├── src/services/    # 邮件发送（SMTP over TCP Sockets）
│   ├── src/permissions.ts
│   └── wrangler.toml    # 模板配置（仅含占位符，不含密钥）
├── migrations/          # D1 数据库迁移（0001 ~ 0011）
├── scripts/             # 构建期配置生成脚本（多实例部署）
└── DEPLOY.md            # 完整部署指南
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置

配置分两类，**位置不同，不要混用**：

**① 构建期配置（会写进部署配置）**

只有 D1 数据库 ID 与 KV 命名空间 ID。使用 Git 自动构建时，在 Cloudflare 项目的**构建变量**里配置
`D1_DATABASE_ID`、`KV_NAMESPACE_ID`（必填），构建时由 `npm run build:config` 生成本实例专属配置；
本地手动部署则直接编辑 `worker/wrangler.toml`。

**② 运行时配置（不写入仓库）**

`TURNSTILE_SITE_KEY`、`TURNSTILE_SECRET_KEY`、`SMTP_HOST`、`SMTP_PORT`、`SMTP_USER`、`SMTP_FROM`、
`SMTP_PASS`、`JWT_SECRET`、`PAGES_DOMAIN`、`WORKER_HOST` 等，统一在
**Worker → 设置 → 变量和密钥（Variables and Secrets）** 中维护，敏感项选「密钥」类型。

> ⚠️ **不要把这些变量写进 `wrangler.toml` 的 `[vars]`**。
> `wrangler deploy` 会用配置文件里的 `[vars]` 整体替换线上变量表，写成空值会清空线上已有配置。
> 因此本仓库的 `wrangler.toml` 不含 `[vars]` 段，`gen-wrangler.mjs` 检测到该段会直接让构建失败。

本地开发时把变量写在 `worker/.dev.vars`（已被 `.gitignore` 忽略）。详见 [部署指南](./DEPLOY.md)。

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
npm run build    # 构建前端 + 打包 Worker（本地自检用）
```

部署方式二选一：**Git 自动构建**（push 后由 Cloudflare 构建并部署，见 [部署指南](./DEPLOY.md)），
或本地手动 `wrangler deploy`。手动部署前记得先把运行时变量配置到 Worker，详见下方「环境变量」。

## 环境变量

以下运行时变量统一在 **Cloudflare：Worker → 设置 → 变量和密钥** 中配置（本地开发写 `worker/.dev.vars`），
**不要写进 `wrangler.toml`**，否则部署时会覆盖线上配置。

| 变量 | 说明 |
|------|------|
| `DB` | D1 数据库绑定 |
| `KV` | KV 命名空间绑定 |
| `JWT_SECRET` | JWT 签名密钥（密钥类型，必填） |
| `TURNSTILE_SITE_KEY` | Turnstile 站点密钥（公开值；与 Secret Key 需**成对配置**，只配 Secret 会导致后端要求验证而前端不渲染） |
| `TURNSTILE_SECRET_KEY` | Turnstile 密钥（Secret，启用时必填） |
| `SMTP_HOST` / `SMTP_PORT` | SMTP 地址与端口（推荐 465 SSL 直连，587 走 STARTTLS 兼容性较差） |
| `SMTP_USER` / `SMTP_PASS` | SMTP 账号与密码（`SMTP_PASS` 为 Secret；仓库中账号默认留空） |
| `SMTP_FROM` | 发件人地址，留空时回退为 `SMTP_USER` |
| `PAGES_DOMAIN` | 本实例访问域名（用于短链地址展示与 DNS 指引） |
| `WORKER_HOST` | 本 Worker 的 `workers.dev` 域名（留空时自动从请求推断） |
| `RATE_LIMIT_LOGIN_FAIL_MAX` / `RATE_LIMIT_LOGIN_FAIL_WINDOW` | 可选：同一 IP 在窗口（秒）内允许的登录 / 设置密码 / 初始化验证失败次数，默认 `10` 次 / `900` 秒，超限返回 429 |
| `RATE_LIMIT_SEND_IP_MAX` / `RATE_LIMIT_SEND_IP_WINDOW` | 可选：同一 IP 在窗口（秒）内允许发送验证码的次数，默认 `20` 次 / `600` 秒，超限返回 429 |

> 本地开发可把敏感变量写入 `worker/.dev.vars`，该文件已被 `.gitignore` 忽略。

## 安全提示

- 本仓库只包含代码，**不含任何数据库、日志、邮箱或密钥**；`worker/.dev.vars`、`worker/wrangler.build.toml`、`.wrangler/`、`frontend/dist/` 均已被 `.gitignore` 忽略，请勿提交。
- `JWT_SECRET`、`SMTP_PASS`、`TURNSTILE_SECRET_KEY` 通过 Cloudflare Secret 配置，不要写进 `wrangler.toml` 或源码。
- 未配置 SMTP 时接口不会返回验证码（只有 `localhost` 本地调试会自动填充），线上请先配好邮箱，否则无法登录或初始化管理员。
- 登录相关接口内置 **IP 维度限流**：同一 IP 在窗口期内失败次数或发码次数超限时返回 429，成功登录会清零失败计数。阈值见上表 `RATE_LIMIT_*` 变量。限流按 IP 计数，不会因他人恶意尝试而锁死某个账户。
- 发现安全问题请通过 Issue 反馈，避免直接公开可复现的利用细节。

## 参与贡献

1. Fork 本仓库并新建分支（如 `feat/xxx`）；
2. 改完先跑 `npm run check`（worker 与 frontend 的 `tsc --noEmit`）和 `npm run build` 自检；
3. 提交 PR 说明改动点与验证方式。数据库结构调整请新增 `migrations/00xx_*.sql`，不要修改已发布的迁移文件。

## License

本项目采用 [GNU Affero General Public License v3.0 或更高版本（AGPL-3.0-or-later）](./LICENSE) 许可。

允许商业使用、修改与分发；分发修改版本时必须保留许可证、版权和原始项目署名。若将修改版作为网络服务提供，也必须向该服务的用户提供对应源代码。详细署名要求见 [NOTICE](./NOTICE)，补充条款见 [ADDITIONAL_TERMS.md](./ADDITIONAL_TERMS.md)。

项目名称与 Logo 不随本许可证授权，详见 [TRADEMARKS.md](./TRADEMARKS.md)。
