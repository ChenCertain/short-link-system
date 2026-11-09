# 部署指南（傻瓜版）

照着下面顺序做，一步一步来，不用理解原理。

整个系统只有 **一个 Cloudflare Worker**：网页、接口、短链跳转都由它负责。
数据放在 **D1**（数据库），验证码放 **KV**（缓存）。
**一个仓库可以部署成很多个独立站点**，每个站点用自己的 D1 和 KV，数据互不影响。

一共 10 步，大约 10 分钟。

---

## 开始前准备

- 一个 Cloudflare 账号（免费版够用）
- 一个 GitHub 账号，并且仓库已经推到 GitHub（本仓库：`ChenCertain/short-link-system`）
- 电脑上装了 Node.js（18 或更新），只有「第 6 步跑数据库迁移」和「本地开发」需要

不用提前准备域名，也不用提前准备 Turnstile，先用 Cloudflare 送的免费域名跑起来，以后随时补。

---

## 第 1 步：创建数据库（D1）

Cloudflare 控制台 → 左侧 **Storage & Databases** → **D1 SQL Database** → **Create**：

- 名称填 `short-link-db`
- 创建完成后，页面上有一串 **Database ID**，复制下来（后面第 4 步要用）

> 想用命令行也行：`npx wrangler d1 create short-link-db`

---

## 第 2 步：创建缓存（KV）

控制台 → **Storage & Databases** → **KV** → **Create a namespace**：

- 名称填 `SHORT_LINK_KV`
- 创建完成后，复制那一串 **Namespace ID**（后面第 4 步要用）

> 命令行：`npx wrangler kv namespace create SHORT_LINK_KV`

---

## 第 3 步：让 Cloudflare 读取你的仓库

1. 打开 **Workers & Pages** → **Create** → **Workers** → **Connect to Git**
2. 第一次会跳去 GitHub 授权，点同意
3. **如果仓库是私有的**（本仓库就是），还要多做一步：
   GitHub → 右上角头像 → **Settings** → **Applications** → **Cloudflare Workers and Pages** → **Configure**
   → Repository access → **Only select repositories** → 勾选 `short-link-system` → Save
   不做这一步，仓库不会出现在列表里
4. 回到 Cloudflare，选中仓库 `ChenCertain/short-link-system`，点下一步

**构建配置照抄下面这张表：**

| 配置项 | 填什么 |
|---|---|
| 生产分支 | `main` |
| 根目录 / Root directory | `/`（仓库根目录，不用改） |
| 构建命令 / Build command | `npm ci && npm run build && npm run build:config` |
| 部署命令 / Deploy command | `cd worker && npx wrangler deploy --config wrangler.build.toml` |

不用点部署，先去第 4 步填变量。

---

## 第 4 步：填构建变量（每个实例各填一份）

还在同一个页面，找到 **Build variables / 构建变量**（有的界面叫 Variables and Secrets），添加：

| 变量名 | 必填 | 填什么 |
|---|---|---|
| `D1_DATABASE_ID` | ✅ | 第 1 步复制的 Database ID |
| `KV_NAMESPACE_ID` | ✅ | 第 2 步复制的 Namespace ID |
| `WORKER_NAME` | 可选 | Worker 名字，默认 `short-link-system`；做第二个站点时改成别的，比如 `short-link-b` |
| `PAGES_DOMAIN` | 可选 | 访问域名，不知道就**先空着**，不影响部署 |
| `TURNSTILE_SITE_KEY` | 可选 | 人机验证 Key，不知道就**先空着** |
| `SMTP_HOST` / `SMTP_PORT` | 可选 | 邮箱服务器，默认飞书 `smtp.feishu.cn` / `465` |
| `SMTP_USER` / `SMTP_FROM` | 可选 | 发验证码的邮箱，不填就用仓库默认值 |

**只填前两个也能部署**。仓库里的 `worker/wrangler.toml` 不用动，构建时会自动按你的变量生成一份临时配置，不会写回仓库，所以多个站点互不影响。

---

## 第 5 步：点部署

点 **Deploy**，等 2~3 分钟。

- 构建日志最后出现 `Deployed short-link-system` 就是成功
- 页面会给你一个免费域名，形如 `https://short-link-system.xxx.workers.dev`，**记下来**
- 部署失败看日志最后几行，最常见是变量名写错或没填

---

## 第 6 步：建表（只做一次）

上面的部署只上传代码，**数据库还是空的**，必须跑一次迁移。

在电脑上下载/克隆仓库后，打开终端（Windows 用 PowerShell），在仓库根目录执行：

**Windows PowerShell：**

```powershell
cd worker
$env:D1_DATABASE_ID="第1步的ID"
$env:KV_NAMESPACE_ID="第2步的ID"
node ../scripts/gen-wrangler.mjs
npx wrangler login          # 第一次需要，浏览器点授权
npx wrangler d1 migrations apply short-link-db --remote --config wrangler.build.toml
```

**macOS / Linux：**

```bash
cd worker
D1_DATABASE_ID=第1步的ID KV_NAMESPACE_ID=第2步的ID node ../scripts/gen-wrangler.mjs
npx wrangler login
npx wrangler d1 migrations apply short-link-db --remote --config wrangler.build.toml
```

看到 `Migrations applied` 或 `✅` 就好了。

> 每个实例都要在自己的库上跑一次；同一个实例以后升级只要再跑一次同样命令。

---

## 第 7 步：设置 3 个密钥（Secret）

控制台 → **Workers & Pages** → 点你的 Worker → **Settings** → **Variables and Secrets** → **Add**，类型选 **Secret**：

| 名称 | 填什么 | 要不要必填 |
|---|---|---|
| `JWT_SECRET` | 随便一串 32 位以上的字母数字，越乱越好 | ✅ 必填 |
| `SMTP_PASS` | 邮箱的 SMTP 密码/授权码 | 发验证码用，必填 |
| `TURNSTILE_SECRET_KEY` | Turnstile 的 Secret Key | **不用填**，留空即关闭人机验证 |

填完点 **Deploy**（或 Save）让它生效。Secret 不会被以后每次部署覆盖。

---

## 第 8 步：打开网站，创建管理员

浏览器打开第 5 步那个 `xxx.workers.dev` 地址，会自动跳到 `/init`：

1. 填姓名、邮箱、密码（密码至少 8 位）
2. 点「获取邮箱验证码」
3. 去邮箱收信（主题：短链接管理系统登陆/注册验证），把 6 位验证码填进去
4. 提交 → 创建成功，自动登录进入控制台

之后就从这个地址的 `/login` 登录，`/init` 会自动失效。

> 没收到邮件：检查 `SMTP_USER` / `SMTP_FROM` / `SMTP_PASS` 是否填对，Cloudflare 只支持 465 端口。

---

## 第 9 步：想再开一个独立站点？

同一个仓库可以开无数个站点，每个站点数据独立。做法：

1. 回到 **Workers & Pages** → **Create** → **Connect to Git**，还是选同一个仓库
2. 新建一套 D1 + KV（第 1、2 步），拿到新的 ID
3. 构建配置照抄第 3 步那张表
4. 构建变量填**这一套新的** ID，`WORKER_NAME` 改成新名字（如 `short-link-b`）
5. 部署，然后对新库跑第 6 步迁移，再配第 7 步的 Secret

需要注意：

- 仓库里的配置文件一直是空的/占位的，**不要为了某个站点去改它**，否则会影响其他站点
- 每个站点的 Secret、迁移都要单独做
- 私有仓库要在 GitHub App 里授权，多个仓库/账号同理

---

## 第 10 步：以后再加 Turnstile（可选）

不必提前填写最终域名，等站点跑起来再说：

1. 控制台 → **Turnstile** → **Add Site**
2. Hostname 填你现在实际使用的域名（`xxx.workers.dev` 或你自己的域名，可以加多个）
3. 拿到 Site Key 和 Secret Key
4. 把 Site Key 填到构建变量 `TURNSTILE_SITE_KEY`，把 Secret Key 加到 Worker 的 Secret `TURNSTILE_SECRET_KEY`
5. 重新部署一次，再打开登录页就能看到人机验证

没配置 Turnstile 时，登录页不会显示验证框，也不会报错，功能完全可用。

---

## 第 11 步：绑定自己的域名（可选）

1. 域名 NS 指向 Cloudflare
2. 控制台 → 你的 Worker → **Settings** → **Domains & Routes** → **Add custom domain**，填 `sl.example.com`
3. 等状态变成 Active
4. 进管理后台 → **域名管理** → 添加 `sl.example.com` → 按提示在 DNS 加 CNAME，指向你的 Worker 域名
5. 回到后台点「验证」，显示「活跃」后就能用它生成短链了

---

## 常见问题

**构建报「缺少必填环境变量: D1_DATABASE_ID」**
第 4 步变量没填或名字拼错，注意全大写、下划线。

**构建成功但打开页面 500 / 报 no such table**
第 6 步迁移没跑，或者跑到了另一个数据库上。

**部署成功但页面白屏、404**
构建命令没写全，缺 `npm run build`，前端产物 `frontend/dist` 不存在。

**私有仓库在列表里找不到**
GitHub App 没授权该仓库，见第 3 步第 3 点。

**登录时一直提示验证码错误**
验证码 10 分钟有效且只能用一次，重新点发送；或 `SMTP_PASS` 错了。

**推送代码没触发自动部署**
确认推的是 `main` 分支，且 Cloudflare 项目里生产分支设置的是 `main`。

**多个站点会不会互相覆盖数据？**
不会。数据只存在各自的 D1 里；代码只从同一个仓库读，配置在构建时临时生成。
