# dsh-model-fingerprint

[English](README.md) | 中文

DeepSeek Harness (DSH) 插件：通过中转站 / 自定义网关接入 Claude、GPT、Gemini、DeepSeek 等模型时，验证端点背后是不是它声称的模型。它识别三类问题：

- **模型被替换**：例如声称 `claude-sonnet-4-5`，实际是别的模型；
- **被注入 system prompt**：中转站在你的请求前偷偷加了提示词；
- **参数被篡改**：`max_tokens`、`stop`、`temperature` 等被改写或丢弃。

插件用原生 `fetch` 直接向目标端点发原始 HTTP 请求（不经过 DSH 的 LLM adapter），所以能看到原始响应头、id、usage 等字段。支持 OpenAI Chat Completions、OpenAI Responses、Anthropic Messages、Gemini 四种协议。

> 结论是统计判断，置信度是启发式估计，不是绝对结论。中转站可能混合路由，请在不同时段多次复测。

## 安装

要求：DSH `>=0.2.3-alpha.2 <0.3.0`（DSH 本身需要 Node `^24.22.3 || >=26.13.1`），以及 PATH 上的 `pnpm`。

```sh
# 1. 打包（prepack 会自动构建 lib/）
cd plugins/dsh-model-fingerprint
pnpm install
pnpm pack                      # 生成 dsh-model-fingerprint-0.1.0.tgz

# 2. 安装到 profile（web 为 `dsh web` 使用的 profile）
dsh plugin --profile web add ./dsh-model-fingerprint-0.1.0.tgz

# 3. 确认插件层已生效（应看到 "# == dsh-model-fingerprint"）
dsh --profile web --dump-config | grep -A2 model-fingerprint
```

也可以直接链接源码目录（需要先 `pnpm install && pnpm build`）：`dsh plugin --profile web add ./plugins/dsh-model-fingerprint`。卸载：`dsh plugin --profile web remove dsh-model-fingerprint`。

安装时 pnpm 会提示 “missing peer @deepseek-ai/cordis / @deepseek-ai/dsh-tools”，这是预期行为：DSH 的 profile 设置了 `autoInstallPeers: false`，这两个 peer 由正在运行的 dsh 提供。其余依赖（js-tiktoken、yaml、schemastery）已打包进 `lib/`，安装时不需要再下载。

## 配置

### 凭据

key 只通过**引用名**传入（`apiKeyEnv` / `credentialRef`，例如 `RELAY_API_KEY`），插件从不接受明文 key。解析顺序：

1. DSH 凭据服务 `ctx.credentials`（`$DSH_HOME/.credentials.yaml` 优先，其次启动环境与 `.env`），在 **Settings → Models** 保存的 key 就在这里；
2. 没有凭据服务时（例如 `headless` profile 禁用了它），读取启动环境变量；
3. 最后读取 `$DSH_HOME/.credentials.yaml` 的 `refs:`（文件必须是 600 权限，否则拒绝读取）。

所有输出（Markdown、JSON、保存的报告、错误信息）都会打码。

### 用 providerId 复用 profile 里的中转站配置

如果中转站已经在 **Settings → Models → 自定义模型 API** 里配置过，只需传 `target.providerId`。插件优先从运行中的 Loader 读取 `llm-pi-ai` 的实时配置（与模型适配器使用的是同一份），否则读取 `$DSH_HOME/profiles/<profile>/cordis.patch.yml` 与 `$DSH_HOME/cordis.patch.yml`。会读取 `api`、`baseURL`、`apiKeyEnv`、`headers` 与 `compat.maxTokensField`。`deepseek` / `deepseek-official` 映射到 DSH 自带的 DeepSeek 路由（Anthropic Messages，`https://api.deepseek.com/anthropic`）。

### 插件配置（可选）

在 profile 的 `cordis.patch.yml` 中覆盖（patch 会替换整个 `config`，需要写出所有你要改的键）：

```yaml
- id: model-fingerprint
  config:
    extraOfficialHosts: []        # 额外视为“官方”的域名（或 host:port）
    requestTimeoutMs: 60000       # 单请求超时
    maxRetries: 3                 # 429/5xx/网络错误重试（指数退避 + 抖动）
    minIntervalMs: 250            # 同一端点请求最小间隔；每遇到一次 429 翻倍（上限 15s）
    defaultSamples: 3
    defaultBudget: { maxRequests: 120, maxInputTokens: 60000, maxOutputTokens: 12000, maxCostUsd: 0.5 }
    saveReports: true             # 每次 verify 的报告写入数据目录
    thinkingStyle: enabled        # 签名探针的 Claude thinking 方式；API 要求时自动切换 adaptive
    # dataDir: /abs/path          # 默认 $DSH_HOME/data/model-fingerprint
    # allowInsecureHttp: false    # 是否允许非 localhost 的 http://
```

## 工具

### `model_fingerprint_verify`

| 参数 | 说明 |
|---|---|
| `target` | **必填**。`providerId`，或 `baseURL` + `protocol` + `model` + `apiKeyEnv`（或 `credentialRef`） |
| `claimedModel` | 端点声称的模型，默认等于 `target.model` |
| `reference` | 可选，**官方**端点（只允许 `api.anthropic.com`、`api.openai.com`、`generativelanguage.googleapis.com`、`api.deepseek.com` 及 `extraOfficialHosts`）。`baseURL`/`protocol` 按厂商自动补全，通常只需 `{ "apiKeyEnv": "ANTHROPIC_API_KEY" }` |
| `probes` | 默认 `tokenizer, protocol, params, behavior, performance`；`signature`、`context_limit` 需要显式列出 |
| `budget` | `maxRequests` / `maxInputTokens` / `maxOutputTokens` / `maxCostUsd`，可覆盖单价 `inputPricePerMTok` / `outputPricePerMTok` |
| `samples` | 采样次数，1–10，默认 3 |
| `baseline` | 基线 id、`latest`（默认，自动选同模型最新基线）或 `none` |
| `contextTokens` | `context_limit` 探针的提示长度（默认为公开窗口的 75%） |
| `dryRun` | 只估算请求数 / token / 费用，不发送任何请求 |

返回 `{ markdown, report }`：Markdown 报告和结构化 JSON。完整 JSON 与 Markdown 另存到 `$DSH_HOME/data/model-fingerprint/reports/`。每条证据的格式为 `{ probe, strength: strong|medium|weak, result: match|mismatch|inconclusive, detail, raw, category }`。

### `model_fingerprint_record`

用**官方**端点（非官方域名会被拒绝）录制基线，保存到 `$DSH_HOME/data/model-fingerprint/baselines/<model>/`。之后即使没有官方 key，`verify` 也能和基线比较。参数：`endpoint`（同上）、`model`、`probes`（默认 5 个低成本探针）、`budget`、`samples`、`dryRun`。

### `model_fingerprint_list`

列出已录制的基线（id、模型、协议、录制时间、官方端点、包含的探针）。参数：`model`（可选，用于过滤）。

## 使用示例

在 DSH 对话里直接说：

> 用 model_fingerprint_verify 检查 provider `my-relay` 是否真的是 claude-sonnet-4-5，用 ANTHROPIC_API_KEY 作为官方参考。

对应的工具参数：

```json
{
  "target": { "providerId": "my-relay" },
  "claimedModel": "claude-sonnet-4-5",
  "reference": { "apiKeyEnv": "ANTHROPIC_API_KEY" }
}
```

不经过 profile、直接指定端点：

```json
{
  "target": { "baseURL": "https://relay.example.com/v1", "protocol": "openai-completions", "model": "gpt-4o", "apiKeyEnv": "RELAY_API_KEY" },
  "samples": 3
}
```

先录制基线、再无官方 key 验证：

```json
{ "endpoint": { "apiKeyEnv": "ANTHROPIC_API_KEY" }, "model": "claude-sonnet-4-5" }
```

```json
{ "target": { "providerId": "my-relay" }, "claimedModel": "claude-sonnet-4-5", "baseline": "latest" }
```

开启高费用探针（需要提高预算）：

```json
{
  "target": { "providerId": "my-relay" }, "claimedModel": "claude-opus-4-1",
  "reference": { "apiKeyEnv": "ANTHROPIC_API_KEY" },
  "probes": ["tokenizer", "signature"],
  "budget": { "maxCostUsd": 1.5, "maxOutputTokens": 20000 }
}
```

报告节选（真实 dsh headless 端到端测试，中转站注入了 system prompt）：

```
**结论：不一致**　置信度：较高（约 0.80，启发式估计，不代表绝对确定）
| 模型被替换 | 未发现 | tokenizer.delta, protocol.envelope, protocol.shape |
| 被注入 system prompt | 发现 | tokenizer.injection |
| tokenizer.delta | 强 | ✅ 一致 | 9/9 段语料的 token 差值与期望一致（来源：count_tokens）。 |
| tokenizer.injection | 强 | ❌ 不一致 | 疑似注入 system prompt：最小请求多出约 45 tokens（目标 56，期望 11，来源：官方参考端点同一请求）。 |
```

## 探针：原理与局限

| 探针 | 证据强度 | 默认 |
|---|---|---|
| 差分分词器 `tokenizer` | 强（注入估算：同协议 reference 为强、基线为中、模板估算为弱，未发现注入时最高为中） | ✔ |
| 协议指纹 `protocol` | 中（响应头为弱） | ✔ |
| 参数合规 `params` | 中 | ✔ |
| 签名回放 `signature` | 强（OpenAI/Gemini 失败时为中） | 显式开启，需要 reference |
| 行为探针 `behavior` | 弱 | ✔ |
| 性能 `performance` | 弱 | ✔ |
| 上下文上限 `context_limit` | 中 | 显式开启 |

**1. 差分分词器。** 内置固定语料（英文、中文、日文/韩文、代码、emoji ZWJ 序列、罕见 Unicode、长数字、空白组合、混合文本）。每段发两次请求：最小提示 M，以及 M + 语料，取 `input_tokens` 差值 Δ。所有固定前缀（包括注入的 system prompt）都会在差值中抵消，所以 Δ 只取决于分词器。每次请求 max_tokens=1（OpenAI Responses 最低为 16）。期望值来源：Anthropic 用官方 `count_tokens`（需要 reference），OpenAI 用本地 tiktoken（`o200k_base`，老模型用 `cl100k_base`），Gemini 用官方 `countTokens`（需要 reference），其他厂商用 reference 实测或基线。单段容差为 ±max(1, 3%)，超过 ±max(3, 15%) 算不符；≥40% 的语料段不符记为强不一致，≥20% 记为中。最小请求的绝对 token 数与官方同一请求比较，可以估算“疑似注入 token 数”。*局限：* 同族模型常共用分词器（GPT-4o/4.1/5；Gemini 各版本），只能区分厂商/家族；usage 由端点自报，按比例伪造的 usage 无法被差分抵消。

**2. 协议指纹。** 按厂商原生规则检查响应：id 前缀（`msg_`、`chatcmpl-`、`resp_`、`toolu_`、`call_`…）、`stop_reason` / `finish_reason` 枚举、usage 结构（例如 Anthropic 的 `cache_*_input_tokens`、OpenAI 的 `*_tokens_details`）、`system_fingerprint`、模型回显、流式事件顺序。协议相同时还会与 reference 或基线的结构形态比较。响应头只记录“是否存在 + 格式”（例如 `req_ + [0-9a-f]{32}`），不保存值，属于弱证据。*局限：* 非原生协议（例如通过 OpenAI 兼容接口转发 Claude）无法套用官方规则；认真的中转站可以伪造响应结构。

**3. 参数合规。** 依次检查：`max_tokens=17` 是否精确截断；`stop` 序列是否生效（Anthropic 应返回 `stop_reason=stop_sequence`）；`temperature=0` 下 `samples` 次输出是否稳定（与 reference 或基线比较）；强制 tool_choice 时工具调用的格式与 id 前缀；logprobs（OpenAI Chat）是否返回，以及返回的 token 是否都是 `o200k_base` 的单个 token。对 OpenAI 推理模型（o 系列 / GPT-5），官方会拒绝 `stop`、`temperature`、`logprobs`，目标端点若接受，也会被记为不符。只有 HTTP 400/422 被视为“拒绝参数”。上下文上限测试是单独的 `context_limit` 探针，默认关闭。*局限：* 中转站静默丢弃不支持的参数也会被记为“参数被篡改”（这本身就是改写）。

**4. 签名回放。** 让目标端点返回带签名的推理产物：Claude thinking 签名、OpenAI Responses 的 `encrypted_content`、Gemini `thoughtSignature`，然后把它放进多轮对话，回放给**官方** API 校验。**判定不写死任何错误码**，每次运行都先用官方 API 的真实行为校准：正对照（官方刚签发的产物原样回放）必须被接受，负对照（篡改签名）必须被拒绝，并以负对照的状态码 / 错误类型定义“拒绝”。校准失败就不下结论。目标产物被接受记为强一致；被以与负对照相同的方式拒绝记为不一致（Claude 为强，OpenAI/Gemini 为中，因为这两家的签名可能与账号或项目绑定）。*局限：* 只能证明“是该厂商的官方模型生成的”，不能区分同厂商的不同型号；thinking 请求较贵。

**5. 行为探针。** 参考 LLMmap（Pasquini 等，2024），在 temperature=0 下问 7 个高区分度问题：自我介绍、知识截止时间、截止前后的事件、数字母、拒答风格、格式指令遵循、畸形输入后的自述。与 reference 或基线做字符 3-gram 余弦相似度比较（不调用额外模型），并检查自我介绍里提到的厂商名。*局限：* 注入的 system prompt 可以操纵这些回答，所以只作弱证据。

**6. 性能。** `samples` 次流式请求，统计首 token 时间（TTFT）与解码速度（tokens/s）的中位数和四分位数。只用解码速度与 reference 或基线比较：比值在 0.4–2.5 之外记为弱不一致。*局限：* 受负载、地域、网络影响大；中转站会增加 TTFT。

## 评分

- 任一强不一致 → **不一致**
- 有强一致，且没有中等及以上的不一致 → **一致**
- 其他情况 → **可疑**，并列出原因

置信度是有上限的启发式值（“一致”最高 0.95，“不一致”最高 0.97），标签为 高 / 较高 / 中等 / 低。同一类问题内同时出现强一致和强不一致时会降低置信度，并提示可能存在混合路由。报告中的“三类问题”表单独给出每类问题的判断：发现 / 疑似 / 未发现 / 无法判断。

## 费用估算

执行前插件会先估算请求数、输入 token 和输出上限合计，超过 `budget` 就中止，不发送任何请求；运行中也会实时计数，耗尽时停止后续请求。下表是插件 `dryRun` 给出的**上限**（输出按每次请求的上限计，价格是公开价目的近似值，未知模型按 $15/$75 每百万 token 保守估算）。实际花费通常明显更低。

| 场景（samples=3） | 请求数 | 输入 token | 输出上限 | 费用上限 |
|---|---|---|---|---|
| claude-sonnet-4-5，默认探针，无 reference | 30 | 1,225 | 1,201 | $0.022 |
| claude-sonnet-4-5，默认探针 + reference | 56 | 1,707 | 2,139 | $0.037 |
| claude-opus-4-1，默认探针 + reference | 56 | 1,707 | 2,139 | $0.186 |
| claude-sonnet-4-5，仅 signature（+reference） | 5 | 5,700 | 6,372 | $0.113 |
| gpt-4o（chat），默认探针，无 reference | 31 | 1,245 | 1,209 | $0.015 |
| gpt-5（responses），默认探针，无 reference | 27 | 1,155 | 6,451 | $0.066 |
| gemini-2.5-flash，默认探针 + reference | 56 | 1,707 | 9,819 | $0.025 |
| deepseek-chat（chat），默认探针，无 reference | 30 | 1,225 | 1,201 | $0.003 |
| claude-sonnet-4-5，仅 context_limit | 1 | 150,050 | 16 | $0.450 |

推理模型的输出上限会额外预留思考空间，所以更高。Anthropic `count_tokens` 与 Gemini `countTokens` 只计请求数，不计 token 费用。

## 安全

- key 只能通过引用名从凭据服务 / 环境变量 / `.credentials.yaml` 读取，明文 key 会被拒绝。所有输出都会打码（已知 key 精确替换，加上 `sk-…`、`AIza…`、`Bearer …` 等通用格式）。
- 每个 key 绑定到自己端点的 origin：目标 key 只发往目标端点；官方 key 只发往官方域名（reference 必须在白名单内）。不跟随重定向，以免自定义鉴权头被带到别的主机。目标与 reference 解析出同一个 key、但目标不是官方域名时，直接拒绝运行。
- `baseURL` 必须是 https（localhost 除外），不能包含用户名密码、查询串或片段。
- 超时、指数退避加抖动、遵守 `Retry-After`；遇到 429 后该端点后续请求降速。
- 高费用探针（`signature`、`context_limit`）必须显式列出，并受预算约束。

## 已知限制

- 中转站可能混合路由（部分请求走真模型）。单次检测只覆盖本次请求，请分时段多次复测。
- 没有 reference 或基线时，Anthropic / Gemini / 其他厂商的分词器探针无法给出强证据（OpenAI 可以用本地 tiktoken）。
- 同族模型共用分词器，签名回放也不区分型号：“一致”的含义是“与该厂商该家族一致”，型号层面的证据主要来自协议回显、行为与性能，都较弱。
- 价格表、上下文窗口表、原生响应规则基于公开资料，可能过时；可以用 `budget.inputPricePerMTok` / `outputPricePerMTok` 覆盖价格。
- 签名回放的判定依赖运行时校准。本插件的自动化测试使用模拟的官方 API；在真实官方 API 上，若校准失败，插件会给出“无结论”，而不会猜测结果。
- 报告文字目前只有中文（字段名为英文）。

## 开发

```sh
pnpm install
pnpm typecheck
pnpm test        # vitest：单元测试 + 本地 mock 中转站端到端测试
pnpm build       # esbuild 打包到 lib/
```

- `test/fixtures.ts`：四种协议的真实形态样本与伪造样本。
- `test/mock/mock-llm.ts`：本地 mock 官方 API（各自的分词器、原生响应结构、可校验的签名）与 mock 中转站（透传 / 注入 system prompt / 篡改参数 / 替换模型）。
- `test/dsh-e2e/servers.ts`：用真实 `dsh` 安装验证时使用的服务器，由一个模拟 LLM 驱动 agent 调用本工具（参见英文 README 的 *Installation check with a real dsh*）。
