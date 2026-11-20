# 科技晨读

每天早上一份数码圈、科技圈的大事。AI 从十几家中英文科技媒体过去一天的报道里挑出大事，合并重复报道，写中文标题和摘要；另附 Product Hunt 今日新品和 GitHub 热榜。

可以安装到手机和电脑桌面，离线可读；用通行密钥（面容 / 指纹）登录后，收藏、已读和关注的分类在设备之间同步；可以开启每日推送。

```
news/
  app/       网页应用（PWA），发布到 GitHub Pages 的 /news/
  server/    后端（Azure Functions）：每日抓取与 AI 摘要、登录、同步、推送
```

## 每天发生什么

1. **06:47（北京时间）** 定时任务抓取所有来源（`server/src/lib/sources/config.js`）。单个来源失败不影响其他来源。
2. **AI 选题**：把过去 36 小时的报道（最多 250 条）交给 AI，选出最多 30 件大事，合并报道同一件事的多条新闻，分到 7 个分类，按 1–5 分打重要程度。
3. **AI 摘要**：每件事写中文标题和 2–3 句摘要；新品和 GitHub 仓库各写一句话定位和简介。
4. 保存这一期，给开启了推送的设备发通知。

AI 任何一步失败，这一期照常出，显示各媒体的原标题，失败原因记在这一期的 `aiErrors` 里。

## 换用任何 AI

AI 只通过一个接口调用，用哪家由服务器的环境变量决定，不用改代码：

| 变量 | 说明 |
| --- | --- |
| `AI_PROVIDER` | `anthropic`、`openai`、`custom` 或 `none` |
| `AI_MODEL` | 模型名。`anthropic` 默认 `claude-opus-5-5`；`openai` 必填 |
| `AI_API_KEY` | 密钥（`anthropic` 也认 `ANTHROPIC_API_KEY`） |
| `AI_BASE_URL` | 接口地址：`openai` 填兼容接口根地址；`custom` 填你自己服务的完整地址；`anthropic` 可选（走代理时用） |
| `AI_AUTH_HEADER` | 放密钥的请求头，默认 `Authorization: Bearer`；Azure OpenAI 填 `api-key` |
| `AI_JSON_MODE` | `openai` 的 JSON 输出方式：`json_object`（默认）、`json_schema`、`none`（接口不支持时） |

常见配置：

```bash
# Claude
AI_PROVIDER=anthropic  AI_API_KEY=sk-ant-...

# DeepSeek
AI_PROVIDER=openai  AI_BASE_URL=https://api.deepseek.com/v1  AI_MODEL=deepseek-chat  AI_API_KEY=sk-...

# 通义千问
AI_PROVIDER=openai  AI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1  AI_MODEL=qwen-plus  AI_API_KEY=sk-...

# Azure OpenAI（地址填到 chat/completions 为止，带 api-version）
AI_PROVIDER=openai  AI_AUTH_HEADER=api-key  AI_API_KEY=...  AI_MODEL=<部署名>
AI_BASE_URL=https://<资源名>.openai.azure.com/openai/deployments/<部署名>/chat/completions?api-version=2024-10-21

# 本机 Ollama
AI_PROVIDER=openai  AI_BASE_URL=http://localhost:11434/v1  AI_MODEL=qwen2.5:14b
```

**自定义接口**（`AI_PROVIDER=custom`）：服务器把 `{ "system", "prompt", "schema", "maxTokens" }` POST 到 `AI_BASE_URL`，你的服务返回符合 `schema` 的 JSON（或 `{ "result": ... }`）。可以在里面接任何 AI、做缓存或人工审核。

新增一种接口：在 `server/src/lib/ai/` 写一个返回 `{ name, model, generateJson() }` 的函数，并在 `index.js` 里登记。

## 部署到 Azure

服务器用 Azure Functions 的 Flex Consumption 计划（按用量计费；每天跑一次加上平时的接口请求，一般在每月免费额度内），另有一个存储账户，费用很低。AI 接口的费用另算。

1. 先把代码合并到 `main`。
2. 打开 [Azure Cloud Shell](https://shell.azure.com)（选 Bash），运行：

   ```bash
   bash <(curl -fsSL https://raw.githubusercontent.com/callaumyan-design/dsh/main/news/server/deploy/azure-setup.sh)
   ```

   脚本会建好全部资源、问你用哪家 AI 并让你输入密钥（只存在你的函数应用配置里）、自动生成推送密钥和管理密钥、部署代码、触发第一期。可以重复运行：已有的资源和密钥会保留，AI 可以选择更换。
   默认地区是新加坡（`southeastasia`），想换就在命令前加 `LOCATION=australiaeast` 之类。
3. 脚本最后列出 5 个仓库变量（`AZURE_CLIENT_ID`、`AZURE_TENANT_ID`、`AZURE_SUBSCRIPTION_ID`、`AZURE_FUNCTIONAPP_NAME`、`NEWS_API_BASE`），加到仓库 Settings → Secrets and variables → Actions → Variables（Cloud Shell 里登录过 `gh` 的话，脚本可以代劳）。然后在 Actions 页面运行一次「科技晨读（App）」。

之后：
- 改了 `news/server/` 的代码合并到 `main`，测试通过后自动部署（GitHub Actions 用一个托管身份登录 Azure，它只信任本仓库的 `main` 分支，只能部署这一个函数应用，仓库里不存任何 Azure 密钥）。
- App 发布到网站的 `/news/`，后端地址取自 `news/app/.env.production`，没有这个文件就用仓库变量 `NEWS_API_BASE`。

## 服务器配置

部署脚本会自动填好下面这些；手动改在 Azure 门户 → 函数应用 → 设置 → 环境变量。

| 变量 | 说明 |
| --- | --- |
| `AzureWebJobsStorage` | 存储账户连接字符串（Functions 自带）。每期新闻存 Blob，账号与同步数据存 Table |
| `APP_ORIGINS` | 允许访问的网页来源，逗号分隔，如 `https://callaumyan-design.github.io` |
| `RP_ID` | 通行密钥绑定的域名，即网页所在域名，如 `callaumyan-design.github.io` |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | 推送通知的密钥对（`npx web-push generate-vapid-keys` 生成） |
| `ADMIN_KEY` | 手动触发生成用：`POST /api/admin/run`，请求头 `x-admin-key` |

> 通行密钥绑定在网页所在的域名上。以后把网页换到别的域名，已有的通行密钥会失效，需要重新注册。

App 的后端地址写在 `app/.env.production`（或仓库变量 `NEWS_API_BASE`），以部署脚本打印的为准：

```
VITE_API_BASE=https://<应用名>-<随机串>.<地区>-01.azurewebsites.net/api
```

两者都没有时，GitHub Actions 只测试构建，不发布。

## 接口一览

公开：`GET /api/editions/latest`、`GET /api/editions`、`GET /api/editions/{日期}`、`GET /api/push/key`、`POST /api/push/subscribe`、`POST /api/push/unsubscribe`
登录：`POST /api/auth/register/options|verify`、`POST /api/auth/login/options|verify`、`POST /api/auth/logout`
需登录：`GET /api/me`、`PUT /api/me/prefs`、`POST /api/me/read`、`GET|PUT|DELETE /api/me/bookmarks[/{id}]`

## 本地开发

```bash
cd news/server && npm install
npm test                                  # 单元测试
AZURITE=1 npm test                        # 另开终端先运行 npx azurite --inMemoryPersistence
node scripts/dev-server.js                # 本地接口（内存存储 + 示例数据），http://localhost:7071/api
AI_PROVIDER=... node scripts/run-once.js  # 抓一次真实新闻，结果写到 edition-<日期>.json

cd news/app && npm install
VITE_API_BASE=http://localhost:7071/api npm run dev
```
