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

编辑仓库中的 `worker/wrangler.toml`，替换以下占位符：

| 占位符 | 替换为 |
|--------|--------|
| `REPLACE_WITH_YOUR_D1_DATABASE_ID` | 第 1 步的 `database_id` |
| `REPLACE_WITH_YOUR_KV_NAMESPACE_ID` | 第 2 步的 `id` |
| `REPLACE_WITH_TURNSTILE_SITE_KEY` | Turnstile Site Key |
| `PAGES_DOMAIN` | 你的访问域名，如 `short-link.xxx.workers.dev` |

> 该文件只包含资源 ID，不含密钥，可以安全提交到 GitHub。

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
   - **Build command**: `npm run build`
   - **Deploy command**: `npx wrangler deploy`
   - **Root directory**: 仓库根目录
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

每个独立网站重复上述步骤，使用**各自的** D1 数据库与 KV 命名空间即可，代码仓库可以是同一个。
用户、短链、访问日志全部写在各自的 D1 中，互不干扰。

---

## 常见问题

**Q：邮件发送失败？**
A：Cloudflare Workers 通过 TCP Sockets 直连 SMTP，仅支持 SSL 端口（465）。若使用 587 STARTTLS 需改用第三方 HTTP 邮件 API。

**Q：短链访问 404？**
A：确认 `worker/wrangler.toml` 中 `[assets] directory = "../frontend/dist"` 正确，且部署前已执行 `npm run build`。

**Q：登录一直提示验证码错误？**
A：验证码有效期 10 分钟，且一次性使用；重新点击发送即可。
