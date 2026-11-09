# 部署指南

本项目部署形态为 **一个 Cloudflare Worker（同时承载前端静态资源 + API + 短链跳转）**，
数据存放在 D1，会话/验证码存放在 KV，因此：

- 仓库里只有代码，**不包含任何用户与短链数据**
- 每个网站可以 Fork 本仓库后独立部署，使用各自的 D1 / KV，数据互不影响

---

## 前置条件

- Cloudflare 账户（免费套餐即可）
- GitHub 账户

---

## 一、创建 Cloudflare 资源

### 1. 创建 D1 数据库

在 Cloudflare Dashboard → Storage & Databases → D1 中创建，或命令行：

```bash
npx wrangler d1 create short-link-db
```

记下输出的 `database_id`。

### 2. 创建 KV 命名空间

```bash
npx wrangler kv namespace create SHORT_LINK_KV
```

记下输出的 `id`。

### 3. 创建 Turnstile

Dashboard → Turnstile → Add Site：

- 域名填写你将要访问站点的域名（例如 `short-link.xxx.workers.dev` 或自定义域名）
- 记录 **Site Key** 和 **Secret Key**

---

## 二、填写配置

`worker/wrangler.toml` 里需要替换的占位符：

| 占位符 | 替换为 |
|--------|--------|
| `REPLACE_WITH_YOUR_D1_DATABASE_ID` | 第 1 步的 `database_id` |
| `REPLACE_WITH_YOUR_KV_NAMESPACE_ID` | 第 2 步的 `id` |
| `REPLACE_WITH_TURNSTILE_SITE_KEY` | Turnstile Site Key |
| `PAGES_DOMAIN` | 你的访问域名，如 `short-link.xxx.workers.dev` |

有两种方式，按实例数量选择：

### 方式 1：单实例（直接改文件）

直接编辑 `worker/wrangler.toml` 填入真实值并提交。适合只有你自己一份部署的情况。
该文件只包含资源 ID 与非敏感变量，不含密钥，可以安全提交。

### 方式 2：多实例 / Git 自动构建（推荐）

**仓库里的 `worker/wrangler.toml` 保持占位符不动**，每个 Cloudflare 项目在自己的
「构建 → 变量和机密」中设置实例专属变量，构建时由脚本生成 `worker/wrangler.build.toml`（已 gitignore）：

```bash
npm run build:config   # 等价于 node scripts/gen-wrangler.mjs
```

| 构建变量 | 必填 | 说明 |
|----------|------|------|
| `D1_DATABASE_ID` | ✅ | 本实例的 D1 数据库 ID |
| `KV_NAMESPACE_ID` | ✅ | 本实例的 KV 命名空间 ID |
| `TURNSTILE_SITE_KEY` | ✅ | 本实例的 Turnstile Site Key |
| `PAGES_DOMAIN` | ✅ | 本实例访问域名（不含协议） |
| `WORKER_NAME` | ⬜ | Worker 名称，默认 `short-link-system` |
| `D1_DATABASE_NAME` | ⬜ | 数据库名，默认 `short-link-db` |
| `SMTP_HOST` / `SMTP_PORT` | ⬜ | 默认飞书 SMTP |
| `SMTP_USER` / `SMTP_FROM` | ⬜ | 发件邮箱 |

> 多个实例共用同一仓库时，各自只配置自己的变量即可，互不覆盖；缺必填变量时构建会直接失败并提示变量名。

---

## 三、运行数据库迁移

本地验证（写入本地 sqlite）：

```bash
npm run db:migrate
```

生产环境（写入远程 D1）：

```bash
npm run db:migrate:remote
```

---

## 四、设置密钥

敏感信息不要写进仓库，用 Secret 方式配置（Dashboard → Workers → 你的 Worker → Settings → Variables and Secrets → Add，类型选 Secret）：

| 名称 | 说明 |
|------|------|
| `JWT_SECRET` | 随机长字符串（建议 32 位以上） |
| `TURNSTILE_SECRET_KEY` | Turnstile Secret Key |
| `SMTP_PASS` | 飞书邮箱 SMTP 密码 |

命令行方式同样可以：

```bash
cd worker
npx wrangler secret put JWT_SECRET
npx wrangler secret put TURNSTILE_SECRET_KEY
npx wrangler secret put SMTP_PASS
```

---

## 五、部署

### 方式 A：命令行部署（最快）

```bash
npm install
npm run deploy      # 先构建前端，再部署 Worker
```

### 方式 B：GitHub 自动部署

1. Cloudflare Dashboard → Workers & Pages → Create → Workers → Connect to Git
2. 选择你的 GitHub 仓库
3. 构建配置：
   - **Root directory**: 仓库根目录
   - **Build command**: `npm ci && npm run build && npm run build:config`
   - **Deploy command**: `cd worker && npx wrangler deploy --config wrangler.build.toml`
   - **构建变量**: 按第二节「方式 2」填本实例的 `D1_DATABASE_ID` 等
4. 保存并部署（首次部署前请先完成第三节的数据库迁移）
5. 之后每次推送代码，Cloudflare 会自动重新构建部署

---

## 六、首次访问：创建管理员

打开站点 → 自动跳转 `/init`：

1. 填写管理员邮箱、姓名、密码
2. 完成 Turnstile 人机验证
3. 点击「发送验证码」，邮件主题为 **短链接管理系统登陆/注册验证**
4. 输入验证码 → 创建超级管理员
5. 初始化完成后 `/init` 页面自动失效，改用 `/login` 登录

---

## 七、本地开发

```bash
# 终端 1：Worker（默认 http://localhost:8787）
npm run dev:worker

# 终端 2：前端（默认 http://localhost:5173，已代理 /api 到 8787）
npm run dev:frontend
```

首次本地开发需要先执行 `npm run db:migrate` 生成并迁移本地数据库。

本地调试验证码：未配置 `SMTP_HOST/SMTP_USER/SMTP_PASS` 时，验证码会打印在 Worker 控制台。

---

## 八、添加自定义域名

1. 在 Cloudflare 中把域名接入（NS 指向 Cloudflare）
2. 管理后台 → 域名管理 → 添加域名（如 `sl.example.com`）
3. 按弹窗提示在 DNS 添加 `CNAME` 记录，指向你的 Worker 域名
4. 在 Workers → 你的 Worker → Settings → Domains & Routes 中绑定该自定义域名
5. 回到域名管理点击「验证」，状态变为「活跃」后即可用于生成短链

---

## 九、多实例部署

同一个仓库可以同时被多个 Cloudflare 项目拉取构建，每个实例使用**各自的** D1 / KV：

1. 每个 Cloudflare 项目都连接同一个 GitHub 仓库（私有仓库需在 GitHub App 中授权访问）
2. 每个项目单独配置「构建变量」：`D1_DATABASE_ID`、`KV_NAMESPACE_ID`、`TURNSTILE_SITE_KEY`、`PAGES_DOMAIN`，可选 `WORKER_NAME`
3. 构建时各自生成 `worker/wrangler.build.toml`，只在该次构建的容器内生效，不会写入仓库
4. 密钥（`JWT_SECRET`、`TURNSTILE_SECRET_KEY`、`SMTP_PASS`）在每个 Worker 的 Settings 中单独设置
5. 数据库迁移在每个实例上各执行一次：`npx wrangler d1 migrations apply short-link-db --remote`

用户、短链、访问日志全部写在各自的 D1 中，互不干扰。

---

## 常见问题

**Q：邮件发送失败？**
A：Cloudflare Workers 通过 TCP Sockets 直连 SMTP，仅支持 SSL 端口（465）。若使用 587 STARTTLS 需改用第三方 HTTP 邮件 API。

**Q：短链访问 404？**
A：确认 `worker/wrangler.toml` 中 `[assets] directory = "../frontend/dist"` 正确，且部署前已执行 `npm run build`。

**Q：登录一直提示验证码错误？**
A：验证码有效期 10 分钟，且一次性使用；重新点击发送即可。
