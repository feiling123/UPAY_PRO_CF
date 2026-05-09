# UPay Pro Cloudflare Edition

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/YOUR_GITHUB_USERNAME/YOUR_REPOSITORY)

UPay Pro Cloudflare Edition 是对原 Go/Gin + SQLite + Redis/asynq 版本的 Cloudflare 原生全量重构。目标是让 Cloudflare 免费用户也能完整部署一个低成本支付网关，支持 100+ 用户同时支付处理。

## 架构

```text
Cloudflare Worker Static Assets
  public/ 静态首页、登录页、后台、支付页

API Worker (Hono)
  /api/create_order
  /pay/check-status/:trade_id
  /api/public/orders/:trade_id
  ${ADMIN_PATH}/api/* -> internal /admin/api/*

D1
  用户、订单、钱包、设置、回调状态

Durable Object
  WalletAllocator：钱包轮询、金额锁、并发分配

Queues
  order-expiration：订单过期兜底
  order-scan：创建后触发一次扫描批处理
  callback-notify：商户回调和通知重试

Workers Cron
  每分钟批量过期和兜底扫链
  每 10 分钟自动汇率任务
```

核心策略：

- 静态资源由 Workers Static Assets 托管；`/assets/*`、`/js/*`、`/vendor/*` 直出，其余入口路径先经过 Worker 做安全路由。
- `/` 和 `/index.html` 默认返回仿 nginx `404 Not Found`，不展示产品信息。
- 后台入口由 `ADMIN_PATH` 控制；固定的 `/admin`、`/admin.html`、`/login.html` 不再作为公开入口。
- 支付页用 `pv` signed token 授权读取订单，防止枚举订单。
- 支付状态低频轮询，默认最小间隔 8 秒。
- `/login` 和 `/api/create_order` 会流式限制 JSON body 大小，缺少 `Content-Length` 的大请求也会超过上限即拒绝。
- 后端不依赖用户停留在支付页：创建订单后 Queue 自动扫链，约 30 秒重试，订单过期后停止。
- 扫链按 `商户 + 币种 + 钱包地址` 批量处理，不做无限期高频轮询。
- 队列只用于过期、回调、通知等低频事件；商户回调有 D1 claim，避免 Queue/Cron 重复推送同一笔结果。
- 敏感配置用 `CONFIG_ENCRYPTION_KEY` 加密后存 D1，或直接使用 Cloudflare Secrets。
- 商户传入的 `notify_url`、`redirect_url` 必须是安全 URL，生产下单接口会拒绝 localhost、私网地址、带账号密码的 URL 和外部 HTTP URL。

## 免费版容量目标

Cloudflare 免费层能完整部署本项目。推荐默认参数下：

- 100+ 用户同时打开支付页可用。
- 支付确认延迟按 15-60 秒级设计。
- 不追求原 Go 版 2 秒全量扫链体验。

主要免费额度瓶颈：

- Workers：100,000 requests/day。
- D1：5M rows read/day，100k rows written/day，单库 500MB。
- Queues：免费额度适合回调/通知，不适合每订单高频扫链。
- Cron Triggers：免费账户 5 个。

## P0-P3 重构范围

### P0：可部署骨架

- `wrangler.jsonc`：Deploy to Cloudflare 主配置，包含 Static Assets、API、D1、DO、Queues、Cron。
- `migrations/0001_init.sql`：D1 schema。

### P1：核心支付链路

- 兼容旧版 `POST /api/create_order` MD5 签名。
- 新增 HMAC-SHA256 v2 签名能力。
- 完整多商户：独立商户 ID、签名密钥、钱包池、订单幂等和回调签名。
- Durable Object 钱包分配和金额锁。
- D1 订单存储。
- signed payment view token。
- 静态支付页 + 低频状态轮询。

### P2：后台管理和安全

- 登录/退出。
- 管理员首次登录自动初始化。
- 商户、钱包、订单、设置、API key 管理。
- Turnstile 登录验证。
- 敏感配置加密存储。
- WAF/Rate Limit 推荐规则。

### P3：后台任务和扩展

- Cron 批量过期订单。
- Queue 创建后扫链和 30 秒级有限重试，Cron 每分钟兜底扫链。
- 商户回调重试。
- Telegram/Bark 通知。
- 自动汇率缓存。
- 旧 SQLite 数据可按 D1 schema 手动迁移。

## 目录结构

```text
cloudflare/
  public/                 Workers Static Assets 静态资源
  src/http/               Hono HTTP API
  src/lib/                认证、签名、D1 store、金额、工具
  src/chains/             Tronscan/TronGrid/Etherscan/OKX 客户端
  src/jobs/               Cron/Queue 任务
  src/worker/             Durable Object
  migrations/             D1 migrations
  scripts/                构建辅助脚本
  wrangler.jsonc          Deploy to Cloudflare 主配置
```

## 本地开发

```bash
cd cloudflare
npm install --cache .npm-cache
npm run build
```

本地 D1 和 Worker：

```bash
npx wrangler d1 create upay_pro
npm run db:migrate:local
npm run dev
```

如果只想检查类型：

```bash
npm run typecheck
```

## Deploy to Cloudflare 一键部署

使用 README 顶部的 **Deploy to Cloudflare** 按钮，让部署者把公开 GitHub 仓库一键部署到自己的 Cloudflare 账号。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/YOUR_GITHUB_USERNAME/YOUR_REPOSITORY)

发布到你自己的仓库后，把按钮 URL 中的 `YOUR_GITHUB_USERNAME/YOUR_REPOSITORY` 改成实际公开仓库地址。

仓库 URL 必须和你上传到 GitHub 的目录结构一致：

```text
方式 A：整个 UPAY_PRO 项目上传到仓库根目录
https://deploy.workers.cloudflare.com/?url=https://github.com/<owner>/<repo>/tree/main/cloudflare

方式 B：只把 cloudflare/ 目录里的内容上传到仓库根目录，当前推荐
https://deploy.workers.cloudflare.com/?url=https://github.com/<owner>/<repo>
```

如果你的默认分支是 `master`，方式 A 要改成：

```text
https://deploy.workers.cloudflare.com/?url=https://github.com/<owner>/<repo>/tree/master/cloudflare
```

Cloudflare 页面提示“无法获取存储库内容”时，优先检查：仓库是否公开、分支名是否正确、URL 里的子目录是否真实存在、`package.json` 和 `wrangler.jsonc` 是否位于该 URL 指向的目录中。

### 唯一推荐部署入口

本项目只维护一个生产部署入口：

```text
Cloudflare Worker + Static Assets + D1 + Durable Objects + Queues + Cron
```

入口文件和配置：

- `wrangler.jsonc`：唯一部署配置。
- `src/index.ts`：Worker 入口，统一处理静态资源、API、Cron、Queue、Durable Object。
- `public/`：静态资源，由 Workers Static Assets 托管。
- `.dev.vars.example`：Deploy to Cloudflare 用来生成 secrets / variables 表单的示例文件。
- `migrations/0001_init.sql`：D1 表结构。
- `package.json`：Cloudflare Workers Builds 会读取 `build` 和 `deploy` 脚本。

### 一键部署流程

1. 将 `cloudflare/README.md` 顶部按钮 URL 中的 `YOUR_GITHUB_USERNAME/YOUR_REPOSITORY` 替换为你的公开仓库地址。当前推荐把 `cloudflare/` 内容上传到仓库根目录，按钮 URL 使用仓库根地址，不要使用 `/tree/main`。
2. 打开 README 顶部的 **Deploy to Cloudflare**。
3. 按页面提示连接 GitHub 或 GitLab。
4. 勾选 **创建专用 Git 存储库**。Deploy to Cloudflare 会把源仓库克隆到你的 GitHub/GitLab 账号，并把这个新仓库关联到 Workers Builds；不勾选时可能出现 `Can't get repository for project with no associated Git installation`。
5. 确认 Cloudflare 创建的新仓库、Worker 名称、D1 名称、Queue 名称。Worker/项目名称建议使用唯一名称，例如 `upay-pro-cf-你的后缀`；如果之前部署失败过并留下同名半成品项目，换一个新名称或先删除旧项目。
6. 保持默认 Build command：`npm run build`。
7. 保持默认 Deploy command：`npm run deploy`。
8. 确认部署。Cloudflare Workers Builds 会安装依赖、构建、执行 D1 migration，并部署 Worker。
9. 部署成功后立即进入 Worker 的 `Settings -> Variables and Secrets` 设置下方必填 secrets，并按需修改默认后台入口。
10. 重新部署一次最新 commit，或在 Deployments 页面点击 Retry deployment。
11. 打开 Worker 域名，访问 `/api/health`，应返回 `ok: true`。
12. 进入 `ADMIN_PATH` 对应的隐藏后台入口，用默认账号 `admin` / `admin12345` 登录，然后立即修改密码。

`wrangler.jsonc` 已配置 `assets.run_worker_first`。除 `/assets/*`、`/js/*`、`/vendor/*` 外，请求会先进入 Worker，再按业务规则转发到 Static Assets。这样可以确保默认首页、固定后台路径和 `ADMIN_PATH` 都由 Worker 判断，不会被静态资源层绕过。

`assets.html_handling` 固定为 `none`，避免 Cloudflare 把 Worker 内部读取的 `/login.html`、`/admin.html`、`/pay.html` 自动重定向成无扩展名路径。

### 不采用的部署方式

以下方式已从项目部署路径中移除，不作为生产部署方案：

- GitHub Actions：本项目不依赖 Actions 部署。
- Cloudflare Pages Git 集成：无法在一个 Pages 项目里完整承载 Queue consumer、Cron 和 Durable Object class。
- Pages Direct Upload ZIP：只适合纯静态资源，不能完成本项目的后台任务和资源绑定。
- 拆分部署：不再维护 `Pages + jobs Worker` 路线，避免免费用户手动绑定多个项目。

如果强行采用 Pages ZIP，会退化成多个手动部署单元：

```text
Pages ZIP 静态资源
  + 手动创建 D1
  + 手动部署 jobs Worker
  + 手动部署 Durable Object
  + 手动绑定 Queue producer/consumer
  + 手动配置 Cron
```

这不符合本项目的一键完整部署目标。

## 绑定 GitHub 仓库部署

如果 Deploy to Cloudflare button 因 GitHub installation 状态异常无法完成，可以改用 Cloudflare Dashboard 里直接绑定 GitHub 仓库的方式。这个方式不是模板一键部署，需要先手动准备资源，并让 `wrangler.jsonc` 与 Cloudflare 项目保持一致。

### 适用前提

当前仓库根目录必须直接包含：

```text
package.json
package-lock.json
wrangler.jsonc
src/
public/
migrations/
scripts/
```

如果这些文件在 `cloudflare/` 子目录中，后续 Root directory 要填 `cloudflare`；如果像当前 `UPAY_PRO_CF` 一样已经在仓库根目录，Root directory 留空或填 `/`。

### 先手动创建 Cloudflare 资源

1. D1 -> Create database，名称建议：

```text
upay_pro
```

创建后复制 D1 database ID，更新 `wrangler.jsonc`：

```jsonc
"database_id": "<你的 D1 database id>",
"preview_database_id": "<你的 D1 database id>"
```

2. Queues -> Create queue，创建 3 个队列：

```text
upay-order-scan
upay-order-expiration
upay-callback-notify
```

3. `wrangler.jsonc` 的 `name` 必须和你在 Cloudflare 创建的 Worker/项目名称一致。比如 Cloudflare 项目名用：

```text
upay-pro-cf-feiling
```

则 `wrangler.jsonc` 也要改成：

```jsonc
"name": "upay-pro-cf-feiling"
```

不要让 Dashboard 项目名是 `upay-pro-cf-feiling`，但 `wrangler.jsonc` 仍然是 `upay-pro`，否则 Workers Builds 可能部署到另一个 Worker 名称。

### Cloudflare Dashboard 创建步骤

1. Workers & Pages -> Create application -> Worker -> 从 Git 导入/连接 GitHub。
2. 选择账号 `feiling123`。
3. 选择仓库 `UPAY_PRO_CF`。
4. Production branch 选择 `main`。
5. Root directory：
   - 仓库根目录就是 Worker 项目：留空或填 `/`。
   - Worker 项目在子目录：填 `cloudflare`。
6. Install command 如果有输入框，填：

```bash
npm ci
```

7. Build command：

```bash
npm run build
```

8. Deploy command：

```bash
npm run deploy
```

9. 如果页面要求 API token，优先使用 Cloudflare 自动生成的 token。若后续 build 在 `wrangler d1 migrations apply` 阶段报权限错误，则改用自定义 API token，并授予至少：
   - Account Settings: Read
   - Workers Scripts: Edit
   - D1: Edit
   - Workers Queues: Edit
   - User Details: Read

### 首次部署后必须设置

直接 Git 部署通常不会像 Deploy Button 一样在模板页收集所有 secrets。首次部署完成后进入：

```text
Workers & Pages -> 你的 Worker -> Settings -> Variables and Secrets
```

添加这三个必填 secrets：

```text
ADMIN_JWT_SECRET
CONFIG_ENCRYPTION_KEY
MERCHANT_SIGNING_SECRET
```

这三个密钥使用 32-128 个不含空格的可打印 ASCII 字符。然后重新触发一次部署，或在 Dashboard 里重新部署最新 commit。

`wrangler.jsonc` 已提供默认后台入口，可在 Cloudflare Variables 中覆盖：

```text
ADMIN_PATH=backend_admin
```

推荐生成值：

```bash
openssl rand -hex 32
```

三个 secret 都要分别生成一个不同的值，不要使用短口令、中文、空格或换行。默认后台登录账号写入 D1：`admin` / `admin12345`，首次登录后请立即修改密码。

部署完成后检查：

```text
https://<你的 worker 域名>/api/health
```

应返回 `ok: true`。

如果 `/api/health` 返回 `database: false`，说明 D1 migration 没有执行成功，需要在 Cloudflare build 日志中检查 `wrangler d1 migrations apply DB --remote`，或手动执行 D1 migrations。

### 需要手动操作的内容

Deploy to Cloudflare 会自动完成代码构建、Worker 创建、静态资源上传和资源绑定，但不会替你决定业务密钥和安全策略。首次部署后必须手动完成：

1. 在 README 顶部按钮 URL 中替换 `YOUR_GITHUB_USERNAME/YOUR_REPOSITORY`，并按实际仓库结构决定是否保留 `/tree/main/cloudflare` 子目录。
2. 在 Cloudflare 部署页面确认 Worker 名称、D1 名称和 Queue 名称。
3. 在 Worker Settings 配置必填 secrets：`ADMIN_JWT_SECRET`、`CONFIG_ENCRYPTION_KEY`、`MERCHANT_SIGNING_SECRET`。
4. 默认管理员写入 D1：`admin` / `admin12345`，首次登录后请立即在后台修改密码。
5. 检查 D1 表结构；如果部署流程没有自动执行 migration，按下方 D1 migrations 章节手动执行。
6. 登录后台设置 `APP_URL`、商户、商户签名密钥、至少一个商户钱包、链上 API key。
7. 默认后台路径是 `/backend_admin`；生产建议在 Worker Variables 中把 `ADMIN_PATH` 改成自己的隐藏后台目录，例如 `/a9f3-upay-console`，不要使用 `/admin`、`/login`、`/api`、`/pay` 等保留路径。
8. 在 Cloudflare WAF 手动添加 5 条 Custom Rules 和 1 条 Rate Limiting Rule。
9. 生产环境建议绑定自定义域名，并把商户系统的 `notify_url`、`redirect_url` 改成正式域名。
10. 如启用 Turnstile，需要在 Cloudflare Turnstile 创建站点，并配置 `TURNSTILE_SITE_KEY`、`TURNSTILE_SECRET_KEY`。

注意：`wrangler.jsonc` 不再使用 `secrets.required` 阻塞首次部署，因为 Deploy Button 或 Workers Builds 在 Worker 首次创建前可能还没有地方保存 runtime secrets。首次部署成功后必须在 Dashboard 设置 secrets，否则后台登录、创建订单、D1 敏感配置加密等功能会拒绝工作。

### Deploy Button 常见错误

如果项目名称下方出现 `HTTP 400`，浏览器 Network 返回：

```json
{
  "code": 10007,
  "message": "This Worker does not exist on your account."
}
```

通常是 Cloudflare 页面在读取同名 Worker 设置时没有找到对象。先换一个唯一项目名，例如 `upay-pro-cf-20260509`，或者到 Workers 列表删除之前失败留下的同名半成品。

如果 Network 返回：

```json
{
  "code": 8000089,
  "message": "Can't get repository for project with no associated Git installation."
}
```

通常是 Workers Builds 项目没有关联 Git 安装。重新进入 Deploy to Cloudflare 流程，确认 GitHub/GitLab 授权完成，并勾选 **创建专用 Git 存储库**。

### 必填 Secrets

部署后在 Cloudflare Dashboard 的 Worker Settings 中设置：

```text
ADMIN_JWT_SECRET
CONFIG_ENCRYPTION_KEY
MERCHANT_SIGNING_SECRET
```

位置：

```text
Workers & Pages -> 你的 Worker -> Settings -> Variables and Secrets -> Add
```

类型选择：

```text
Secret
```

`ADMIN_PATH` 已在 `wrangler.jsonc` 提供默认值，也可以用普通文本 Variable 覆盖；`ADMIN_JWT_SECRET`、`CONFIG_ENCRYPTION_KEY`、`MERCHANT_SIGNING_SECRET` 建议使用 Secret。

长度建议：

| Secret | 用途 | 生产长度范围 | 推荐生成方式 |
| --- | --- | --- | --- |
| `ADMIN_JWT_SECRET` | 管理员登录 Cookie HMAC 签名 | 32-128 个可打印 ASCII 字符，不含空格/换行 | `openssl rand -hex 32`，生成 64 位 hex |
| `CONFIG_ENCRYPTION_KEY` | D1 敏感配置 AES-GCM 加密主密钥 | 32-128 个可打印 ASCII 字符，不含空格/换行 | `openssl rand -hex 32`，生成 64 位 hex |
| `MERCHANT_SIGNING_SECRET` | 商户下单签名和回调签名密钥 | 32-128 个可打印 ASCII 字符，不含空格/换行 | `openssl rand -hex 32`，生成 64 位 hex |

说明：

- 技术上 Worker 会把 `CONFIG_ENCRYPTION_KEY` 先 SHA-256 派生为 AES-GCM key；生产仍建议至少 32 个随机字符。
- `MERCHANT_SIGNING_SECRET` 会被旧版 MD5 和新版 HMAC-SHA256 共用，必须长期稳定保存；更换后商户侧也要同步更新。
- 运行时会对后台 JWT、支付访问令牌、D1 敏感配置加密和后台新建/更新的商户密钥执行同样长度检查。
- 避免使用中文、空格、换行和容易混淆的短口令；不要把这些值提交到 GitHub。

首次管理员默认写入 D1：

```text
username=admin
password=admin12345
```

链上扫描建议设置：

```text
TRONSCAN_API_KEY
TRONGRID_API_KEY
ETHERSCAN_API_KEY
```

可选通知和人机验证：

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
BARK_KEY
TURNSTILE_SITE_KEY
TURNSTILE_SECRET_KEY
```

### Cloudflare Variables

`ADMIN_PATH` 默认在 `wrangler.jsonc` 中设置为 `backend_admin`，访问路径为 `/backend_admin`。生产部署前建议在 Cloudflare Dashboard 的 Worker Variables 中覆盖为随机路径：

```text
ADMIN_PATH=/a9f3-upay-console
```

`ADMIN_PATH` 是后台唯一公开入口。部署到生产前建议改成自己的随机路径，访问方式为：

```text
https://your-domain.example/<ADMIN_PATH>
```

例如 `ADMIN_PATH=/a9f3-upay-console` 时，后台入口是：

```text
https://your-domain.example/a9f3-upay-console
```

固定 `/admin`、`/admin.html`、`/login.html` 都会返回 nginx 风格 404。默认入口是 `/backend_admin`；如果你覆盖 `ADMIN_PATH`，则以覆盖后的路径为准。

旧版 MD5 兼容默认开启：

```text
LEGACY_MD5_ENABLED=true
```

如果所有商户都迁移到 HMAC-SHA256 v2，可在 Worker Settings 的 Variables 中改为：

```text
LEGACY_MD5_ENABLED=false
```

关闭后，未携带 `X-UPAY-Signature-Version: v2` 的 `/api/create_order` 请求会被拒绝。

### D1 migrations 说明

`package.json` 的 `deploy` 脚本已经包含：

```bash
npm run db:migrations:apply && wrangler deploy --config wrangler.jsonc
```

正常一键部署时不需要单独执行 migration。只有部署测试时发现 D1 没有表，才需要手动补跑：

```bash
cd cloudflare
npm install --cache .npm-cache
npx wrangler login
npx wrangler d1 migrations apply DB --remote --config wrangler.jsonc
```

也可以在 Dashboard 执行：

```text
Workers & Pages -> D1 -> upay_pro -> Console
```

把 `migrations/0001_init.sql` 内容复制进去执行。

### 本地验证命令

本地命令只用于部署前自检，不是生产部署入口：

```bash
cd cloudflare
npm install --cache .npm-cache
npm run build
HOME=/private/tmp npx wrangler deploy --config wrangler.jsonc --dry-run
```

## 旧版接口兼容

### 创建订单

保留旧版：

```http
POST /api/create_order
Content-Type: application/json
```

字段：

```json
{
  "type": "USDT-TRC20",
  "merchant_id": "default",
  "order_id": "ORDER123",
  "amount": 100,
  "notify_url": "https://example.com/notify",
  "redirect_url": "https://example.com/return",
  "signature": "md5_signature"
}
```

旧签名仍按 Go 版 `%g` 金额格式、参数排序、直接追加密钥、MD5 小写 hex。
旧签名不包含 `merchant_id` 字段，但验签密钥按 `merchant_id` 选择；不传 `merchant_id` 时兼容旧版 `default` 商户。

结论：`/api/create_order` 旧版入口建议保留，原因是旧 Go 版和现有商户插件会依赖它。生产建议新商户使用 v2；确认没有旧插件依赖后，再将 `LEGACY_MD5_ENABLED=false` 禁用旧 MD5。

生产下单接口会校验 `notify_url` 和 `redirect_url`：

- 必须是 `https://`，外部 `http://` 会被拒绝。
- 拒绝 `localhost`、`127.0.0.1`、IPv4/IPv6 私网、链路本地地址。
- 拒绝带 `username:password@host` 的 URL。

新接口可用 HMAC-SHA256：

```http
X-UPAY-Signature-Version: v2
```

并额外传 `merchant_id`、`timestamp`、`nonce`。
v2 签名会把 `merchant_id` 纳入签名串。

### 多商户

后台 `商户` 页可创建多个商户。每个商户都有独立的：

- `merchant_id`。
- 签名密钥。
- 钱包池。
- 商户订单号幂等范围。
- Durable Object 金额锁命名空间。
- 商户回调签名密钥。

后台 `测试订单` 页可以选择商户并生成支付链接，可用于部署后链路测试，也可以直接发给客户付款。

### 支付链接

返回的 `payment_url` 会带 `pv`：

```text
/pay/checkout-counter/{trade_id}?pv={signed_view_token}
```

`pv` 是只读授权 token。没有 `pv` 的支付页公开 API 会返回 404。

### 后端自动确认

用户关闭支付页也不影响订单确认。后端流程：

1. 创建订单后 15 秒投递一次 `order-scan` Queue。
2. 如果未发现链上入账，订单仍在有效期内，则再次投递扫描消息，默认约 30 秒后重试。
3. 默认订单有效期为 300 秒；超过有效期后订单标记为过期，释放 Durable Object 金额锁，后续不再重试扫描。
4. 检查到支付成功后，订单状态更新为支付成功，并立即投递 `callback-notify` Queue。
5. `callback-notify` 会向订单创建时传入的 `notify_url` 推送支付结果；失败会按退避策略重试，重试次数由后台 `回调最大次数` 控制。
6. Workers Cron 每分钟执行一次兜底任务，处理漏掉的过期订单、待扫订单和回调。

因此前端轮询只是用户体验优化，不是订单确认的唯一机制。

### 商户回调

回调字段保持旧版，不额外添加字段：

```json
{
  "trade_id": "202605091234560001",
  "order_id": "ORDER123",
  "amount": 100,
  "actual_amount": 14.28,
  "token": "wallet-address",
  "block_transaction_id": "tx-hash",
  "status": 2,
  "signature": "md5_signature"
}
```

商户接口返回 HTTP 200 且 body 为 `ok` 或 `success` 才确认成功。

## 免费版安全策略

### Worker 内部处理顺序

动态端点统一遵循：

1. 路由和 method 精确匹配。
2. Content-Type 和 body 大小检查。
3. 字段格式校验。
4. 支付公开 API 先验 `pv`，失败不读 D1。
5. 管理 API 先验管理员 Cookie。
6. 下单接口先做字段、URL、金额校验，再读取商户密钥验签；验签失败不调用 DO、不发 Queue、不写订单。
7. 通过校验后才进入业务逻辑。

### WAF 5 条规则建议

Free 计划支持 5 条 Custom Rules。建议按顺序：

1. Block 危险方法：

```txt
http.request.method in {"TRACE" "TRACK" "CONNECT"}
```

2. Block 扫描器路径：

```txt
starts_with(http.request.uri.path, "/.git") or
starts_with(http.request.uri.path, "/.env") or
starts_with(http.request.uri.path, "/wp-admin") or
http.request.uri.path in {"/wp-login.php" "/xmlrpc.php" "/phpmyadmin" "/adminer.php"}
```

3. Block 非法下单形态：

```txt
http.request.uri.path eq "/api/create_order" and
(http.request.method ne "POST" or not any(lower(http.request.headers["content-type"][*]) contains "application/json"))
```

4. Block 无 `pv` 的支付公开 API：

```txt
(
  starts_with(http.request.uri.path, "/pay/checkout-counter/") or
  starts_with(http.request.uri.path, "/pay/check-status/") or
  starts_with(http.request.uri.path, "/api/public/orders/")
)
and not http.request.uri.query contains "pv="
```

5. Challenge 后台入口。把 `<ADMIN_PATH>` 换成你的真实后台目录，例如 `/a9f3-upay-console`：

```txt
http.request.uri.path eq "<ADMIN_PATH>" or starts_with(http.request.uri.path, "<ADMIN_PATH>/")
```

### 1 条 Rate Limiting Rule

Free 计划只有 1 条 Rate Limiting Rule，优先保护昂贵入口：

```txt
http.request.method eq "POST" and (
  http.request.uri.path eq "/api/create_order" or
  http.request.uri.path eq "<ADMIN_PATH>/login"
)
```

建议阈值：`30 requests / 1 minute / IP`，动作 `429` 或 Managed Challenge。固定商户服务器可按 IP allowlist。

## 部署后检查

1. 打开 `/`，应显示 nginx 风格 `404 Not Found`。
2. 打开 `/api/health`，应返回 `ok: true`。
3. 打开自定义后台入口 `ADMIN_PATH`，用初始账号登录。
4. 在后台设置：
   - 应用 URL
   - 商户和商户签名密钥
   - 至少一个商户钱包地址
   - Tronscan/TronGrid/Etherscan API key
5. 调用 `/api/create_order` 创建测试订单。
6. 打开返回的 `payment_url`，检查二维码、金额、钱包、倒计时。

## 当前限制

- 免费层默认按 30 秒级有限扫链设计，支付确认不是 2 秒实时。
- BSC/ETH/Polygon/Arbitrum 通过 Etherscan V2 查询，必须配置 `ETHERSCAN_API_KEY`。
- 当前不包含旧 SQLite 自动迁移工具；新部署直接使用 D1 schema，旧库迁移需按实际数据手动导入。
- 支付页二维码使用开源 `qrcode-generator`，由构建脚本复制到 `public/vendor/qrcode.js`。

## 后续扩展

- Webhook Provider：优先使用链上 webhook 替代轮询，降低免费层成本。
- 更细粒度审计日志：生产高频场景建议升级 Workers Paid 后开启。
- 插件 SDK：为 WHMCS、易支付、智简魔方生成 Cloudflare 版配置向导。
