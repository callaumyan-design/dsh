# dsh-model-fingerprint

English | [中文](README.zh.md)

A DeepSeek Harness (DSH) plugin that checks whether a model endpoint — a relay, reseller, or custom gateway in front of Claude, GPT, Gemini, DeepSeek, … — really serves the model it claims. It looks for three problems:

- **model substitution** — the endpoint claims `claude-sonnet-4-5` but runs something else;
- **injected system prompt** — the relay silently prepends its own instructions;
- **tampered parameters** — `max_tokens`, `stop`, `temperature`, … rewritten or dropped.

Requests go straight to the endpoint with native `fetch` (not through the DSH LLM adapters), so raw headers, ids, and usage fields stay visible. Four wire protocols are supported: OpenAI Chat Completions, OpenAI Responses, Anthropic Messages, and Gemini.

> Verdicts are statistical judgments with a heuristic confidence, never certainty. Relays can route only some requests to the real model, so re-test at different times.

## Install

Requirements: DSH `>=0.2.3-alpha.2 <0.3.0` (DSH itself needs Node `^24.22.3 || >=26.13.1`) and `pnpm` on PATH.

```sh
# 1. pack (prepack builds lib/)
cd plugins/dsh-model-fingerprint
pnpm install
pnpm pack                      # -> dsh-model-fingerprint-0.1.0.tgz

# 2. install into a profile (`web` is the profile `dsh web` boots)
dsh plugin --profile web add ./dsh-model-fingerprint-0.1.0.tgz

# 3. confirm the layer ("# == dsh-model-fingerprint")
dsh --profile web --dump-config | grep -A2 model-fingerprint
```

A checkout can also be linked after `pnpm install && pnpm build`: `dsh plugin --profile web add ./plugins/dsh-model-fingerprint`. Remove it with `dsh plugin --profile web remove dsh-model-fingerprint`.

pnpm reports "missing peer @deepseek-ai/cordis / @deepseek-ai/dsh-tools" during installation. That is expected: DSH profiles set `autoInstallPeers: false`, and the running dsh supplies those two peers. Everything else (js-tiktoken, yaml, schemastery) is bundled into `lib/`, so nothing else is downloaded.

## Configure

### Credentials

Keys are passed **by reference name only** (`apiKeyEnv` / `credentialRef`, e.g. `RELAY_API_KEY`); raw keys are refused. Resolution order:

1. the DSH credentials service `ctx.credentials` — `$DSH_HOME/.credentials.yaml` first, then the launch environment and `.env` files. Keys saved under **Settings → Models** live here;
2. without that service (the `headless` profile disables it): the launch environment;
3. finally the `refs:` section of `$DSH_HOME/.credentials.yaml`, which is refused unless the file mode is owner-only (600).

Every output (Markdown, JSON, saved reports, error messages) is redacted.

### Reuse a relay already configured in the profile (`providerId`)

If the relay is set up under **Settings → Models → Custom model API**, pass only `target.providerId`. The plugin first reads the live `llm-pi-ai` configuration from the running Loader (the same configuration the model adapters use). Otherwise it falls back to `$DSH_HOME/profiles/<profile>/cordis.patch.yml` and `$DSH_HOME/cordis.patch.yml`. It reads `api`, `baseURL`, `apiKeyEnv`, `headers`, and `compat.maxTokensField`. `deepseek` / `deepseek-official` map to DSH's built-in DeepSeek route (Anthropic Messages at `https://api.deepseek.com/anthropic`).

### Plugin settings (optional)

Override in the profile's `cordis.patch.yml`. A patch replaces the whole `config`, so list every key you change.

```yaml
- id: model-fingerprint
  config:
    extraOfficialHosts: []        # extra hosts (or host:port) treated as official
    requestTimeoutMs: 60000
    maxRetries: 3                 # 429/5xx/network, exponential backoff with jitter
    minIntervalMs: 250            # spacing per endpoint; doubles after every 429 (max 15 s)
    defaultSamples: 3
    defaultBudget: { maxRequests: 120, maxInputTokens: 60000, maxOutputTokens: 12000, maxCostUsd: 0.5 }
    saveReports: true             # write every verify report to the data directory
    thinkingStyle: enabled        # Claude thinking style for the signature probe; switches to adaptive when the API asks
    # dataDir: /abs/path          # default $DSH_HOME/data/model-fingerprint
    # allowInsecureHttp: false    # allow http:// beyond localhost
```

## Tools

### `model_fingerprint_verify`

| Argument | Meaning |
|---|---|
| `target` | **Required.** `providerId`, or `baseURL` + `protocol` + `model` + `apiKeyEnv` (or `credentialRef`) |
| `claimedModel` | Model the endpoint claims; defaults to `target.model` |
| `reference` | Optional **official** endpoint (only `api.anthropic.com`, `api.openai.com`, `generativelanguage.googleapis.com`, `api.deepseek.com`, plus `extraOfficialHosts`). `baseURL`/`protocol` default from the vendor; usually `{ "apiKeyEnv": "ANTHROPIC_API_KEY" }` is enough |
| `probes` | Default `tokenizer, protocol, params, behavior, performance`; `signature` and `context_limit` only when listed |
| `budget` | `maxRequests` / `maxInputTokens` / `maxOutputTokens` / `maxCostUsd`, plus price overrides `inputPricePerMTok` / `outputPricePerMTok` |
| `samples` | 1–10, default 3 |
| `baseline` | Baseline id, `latest` (default: newest baseline for the model) or `none` |
| `contextTokens` | Prompt size for `context_limit` (default 75% of the advertised window) |
| `dryRun` | Estimate requests/tokens/cost only; send nothing |

Returns `{ markdown, report }`: a Markdown report plus structured JSON. The full JSON and Markdown are also saved under `$DSH_HOME/data/model-fingerprint/reports/`. Each evidence item is `{ probe, strength: strong|medium|weak, result: match|mismatch|inconclusive, detail, raw, category }`.

### `model_fingerprint_record`

Records a baseline from an **official** endpoint (non-official hosts are refused) into `$DSH_HOME/data/model-fingerprint/baselines/<model>/`, so later `verify` runs can compare against it without an official key. Arguments: `endpoint`, `model`, `probes` (default: the five low-cost probes), `budget`, `samples`, `dryRun`.

### `model_fingerprint_list`

Lists recorded baselines (id, model, protocol, time, official endpoint, probes). Optional `model` filter.

## Examples

In a DSH session:

> Use model_fingerprint_verify to check whether provider `my-relay` really serves claude-sonnet-4-5, with ANTHROPIC_API_KEY as the official reference.

Tool arguments:

```json
{
  "target": { "providerId": "my-relay" },
  "claimedModel": "claude-sonnet-4-5",
  "reference": { "apiKeyEnv": "ANTHROPIC_API_KEY" }
}
```

An endpoint not configured in the profile:

```json
{
  "target": { "baseURL": "https://relay.example.com/v1", "protocol": "openai-completions", "model": "gpt-4o", "apiKeyEnv": "RELAY_API_KEY" },
  "samples": 3
}
```

Record once with the official key, verify later without it:

```json
{ "endpoint": { "apiKeyEnv": "ANTHROPIC_API_KEY" }, "model": "claude-sonnet-4-5" }
```

```json
{ "target": { "providerId": "my-relay" }, "claimedModel": "claude-sonnet-4-5", "baseline": "latest" }
```

Expensive probes (raise the budget):

```json
{
  "target": { "providerId": "my-relay" }, "claimedModel": "claude-opus-4-1",
  "reference": { "apiKeyEnv": "ANTHROPIC_API_KEY" },
  "probes": ["tokenizer", "signature"],
  "budget": { "maxCostUsd": 1.5, "maxOutputTokens": 20000 }
}
```

Report excerpt (real `dsh` headless run against a relay that injects a system prompt):

```
**结论：不一致**　置信度：较高（约 0.80，启发式估计，不代表绝对确定）
| 模型被替换 | 未发现 | tokenizer.delta, protocol.envelope, protocol.shape |
| 被注入 system prompt | 发现 | tokenizer.injection |
| tokenizer.delta | 强 | ✅ 一致 | 9/9 段语料的 token 差值与期望一致（来源：count_tokens）。 |
| tokenizer.injection | 强 | ❌ 不一致 | 疑似注入 system prompt：最小请求多出约 45 tokens（目标 56，期望 11，来源：官方参考端点同一请求）。 |
```

(Report text is in Chinese; field names are English.)

## Probes: how they work and where they stop

| Probe | Evidence | Default |
|---|---|---|
| Differential tokenizer `tokenizer` | strong (injection estimate: strong with a same-protocol reference, medium with a baseline, weak from the template estimate; "no injection" is capped at medium) | ✔ |
| Protocol fingerprint `protocol` | medium (headers weak) | ✔ |
| Parameter compliance `params` | medium | ✔ |
| Signature replay `signature` | strong (a failed OpenAI/Gemini replay is medium) | opt-in, needs reference |
| Behavior `behavior` | weak | ✔ |
| Performance `performance` | weak | ✔ |
| Context limit `context_limit` | medium | opt-in |

**1. Differential tokenizer.** A fixed corpus — English, Chinese, Japanese/Korean, code, emoji ZWJ sequences, rare Unicode, long digit runs, whitespace mixes, mixed text — is sent as two prompts per segment: the minimal prompt M and M + segment. The difference Δ of `input_tokens` cancels every constant prefix, an injected system prompt included, so Δ depends only on the tokenizer. Every request uses max_tokens=1 (16 on OpenAI Responses, its minimum). Expected Δ comes from:

- Anthropic: the official `count_tokens` (needs a reference);
- OpenAI: local tiktoken (`o200k_base`, or `cl100k_base` for older models);
- Gemini: the official `countTokens` (needs a reference);
- other vendors: a reference measurement or a baseline.

A segment matches within ±max(1, 3%) and mismatches beyond ±max(3, 15%). Mismatches on ≥40% of segments are a strong mismatch; ≥20% is medium. The absolute minimal count, compared with the same request on the official endpoint, estimates the injected prompt size. *Limits:* model families share tokenizers (GPT-4o/4.1/5; all Gemini versions), so the probe separates vendors and families, not sibling models. Usage is self-reported, and proportionally faked usage is not cancelled by the difference.

**2. Protocol fingerprint.** Vendor-native envelope rules, checked on the response:

- id prefixes (`msg_`, `chatcmpl-`, `resp_`, `toolu_`, `call_`, …);
- `stop_reason` / `finish_reason` vocabularies;
- usage structure (Anthropic `cache_*_input_tokens`, OpenAI `*_tokens_details`, …);
- `system_fingerprint`;
- model echo;
- streaming event order.

When the protocols match, the shape is also compared with the reference or baseline. Headers are recorded as presence + format only (e.g. `req_ + [0-9a-f]{32}`), never values, and count as weak evidence. *Limits:* non-native combinations (Claude behind an OpenAI-compatible API) cannot use the official rules, and a careful relay can forge envelopes.

**3. Parameter compliance.** Five checks:

- exact truncation at `max_tokens=17`;
- `stop` sequences (Anthropic must report `stop_reason=stop_sequence`);
- output stability across `samples` runs at `temperature=0`, compared with the reference or baseline;
- tool-call wire format and id prefixes under a forced tool_choice;
- logprobs (OpenAI Chat): present, and every token a single `o200k_base` token.

For OpenAI reasoning models (o-series / GPT-5) the official API rejects `stop`, `temperature`, and `logprobs`, so an endpoint that accepts them is flagged. Only HTTP 400/422 counts as "parameter refused". The context-window test is the separate, opt-in `context_limit` probe. *Limits:* a relay that silently drops unsupported parameters is reported as tampering, which it technically is.

**4. Signature replay.** The target is asked for a signed reasoning artifact: a Claude thinking signature, an OpenAI Responses `encrypted_content`, or a Gemini `thoughtSignature`. The artifact is then replayed in a multi-turn request to the **official** API, which verifies it.

**No error code is hard-coded.** Every run first calibrates on the official API's live behavior:

- a positive control (an artifact the official API just issued, replayed unchanged) must be accepted;
- a negative control (the same artifact with its signature altered) must be rejected, and its status/error type define what "rejected" looks like.

If calibration fails, the probe reports no conclusion. Otherwise the target's artifact is classified:

- accepted → strong match;
- rejected the same way as the negative control → mismatch (strong for Claude; medium for OpenAI/Gemini, whose signatures may be account- or project-bound).

*Limits:* replay proves the vendor's official model produced the output, not which model of that vendor. Thinking requests are relatively expensive.

**5. Behavior.** After LLMmap (Pasquini et al., 2024): seven high-discrimination questions at temperature 0 — banner grabbing, knowledge cutoff, an event around the cutoff, letter counting, refusal style, format following, and self-description after malformed input. Answers are compared with the reference or baseline by character 3-gram cosine similarity (no extra model), and vendor names in the self-description are checked. *Limits:* an injected system prompt can steer these answers; weak evidence only.

**6. Performance.** TTFT and decode speed (tokens/s) over `samples` streamed runs, reported as median and quartiles. Only decode speed is compared with the reference or baseline; a ratio outside 0.4–2.5 is a weak mismatch. *Limits:* load, region, and network dominate, and relays add TTFT.

## Scoring

- any strong mismatch → **不一致** (inconsistent)
- a strong match and no medium-or-stronger mismatch → **一致** (consistent)
- otherwise → **可疑** (suspicious), with the reasons listed

Confidence is a bounded heuristic: at most 0.95 for consistent and 0.97 for inconsistent, labelled 高 / 较高 / 中等 / 低. A strong match and a strong mismatch inside the same problem category lower it and point to possible mixed routing. The report's three-problem table rates each category separately as 发现 (detected) / 疑似 (suspected) / 未发现 (not detected) / 无法判断 (unknown).

## Cost

Before sending anything the plugin estimates requests, input tokens, and the sum of output caps, and aborts if any `budget` limit would be exceeded. While running it also meters every request (retries included) and stops further requests once a limit is reached. The table shows the plugin's own `dryRun` **upper bounds**: output is counted at each request's cap, and prices are approximate list prices, with unknown models at a conservative $15/$75 per 1M tokens. Real spend is usually well below these numbers.

| Scenario (samples=3) | Requests | Input tokens | Output cap | Cost cap |
|---|---|---|---|---|
| claude-sonnet-4-5, defaults, no reference | 30 | 1,225 | 1,201 | $0.022 |
| claude-sonnet-4-5, defaults + reference | 56 | 1,707 | 2,139 | $0.037 |
| claude-opus-4-1, defaults + reference | 56 | 1,707 | 2,139 | $0.186 |
| claude-sonnet-4-5, signature only (+reference) | 5 | 5,700 | 6,372 | $0.113 |
| gpt-4o (chat), defaults, no reference | 31 | 1,245 | 1,209 | $0.015 |
| gpt-5 (responses), defaults, no reference | 27 | 1,155 | 6,451 | $0.066 |
| gemini-2.5-flash, defaults + reference | 56 | 1,707 | 9,819 | $0.025 |
| deepseek-chat (chat), defaults, no reference | 30 | 1,225 | 1,201 | $0.003 |
| claude-sonnet-4-5, context_limit only | 1 | 150,050 | 16 | $0.450 |

Reasoning models reserve extra output room for hidden reasoning, hence the higher caps. Anthropic `count_tokens` and Gemini `countTokens` calls count as requests but not as tokens.

## Security

- Keys are resolved by reference only (credentials service / environment / `.credentials.yaml`); raw keys are refused. All output is redacted: known keys are replaced exactly, and generic shapes such as `sk-…`, `AIza…`, and `Bearer …` are masked too.
- Each key is bound to its endpoint's origin. The target key goes only to the target; the official key goes only to an allowlisted official host. Redirects are never followed, so a custom auth header cannot be carried to another host. If target and reference resolve to the same key while the target is not official, the run is refused.
- `baseURL` must be https (except localhost) without credentials, query, or fragment.
- Timeouts, exponential backoff with jitter, and `Retry-After` are honored; after a 429 the endpoint is paced more slowly for the rest of the run.
- Expensive probes (`signature`, `context_limit`) must be listed explicitly and stay within the budget.

## Known limitations

- Mixed routing: a relay can send only some requests to the real model. One run covers only its own requests, so re-test at different times.
- Without a reference or baseline, the tokenizer probe gives strong evidence only for OpenAI (local tiktoken), not for Anthropic, Gemini, or other vendors.
- Families share tokenizers and signature replay is family-level, so "consistent" means consistent with that vendor/family. Model-level evidence comes from echo, behavior, and performance, all of which are weak.
- Price, context-window, and native-envelope tables come from public information and may age. Override prices with `budget.inputPricePerMTok` / `outputPricePerMTok`.
- Signature-replay verdicts depend on live calibration. The automated tests use a simulated official API; against the real APIs, a failed calibration yields "no conclusion" rather than a guess.
- Report prose is Chinese only (field names are English).

## Development

```sh
pnpm install
pnpm typecheck
pnpm test        # vitest: unit tests + end-to-end tests against local mock relays
pnpm build       # esbuild bundle into lib/
```

- `test/fixtures.ts` — genuine-shaped and forged samples for all four protocols.
- `test/mock/mock-llm.ts` — local mock official APIs (vendor tokenizers, native envelopes, verifiable signatures) and mock relays (pass-through / injected system prompt / parameter tampering / substitute model).

### Installation check with a real dsh

```sh
pnpm pack
export DSH_HOME=$(mktemp -d)
dsh plugin --profile web add ./dsh-model-fingerprint-0.1.0.tgz
dsh --profile web --dump-config | grep -A2 model-fingerprint
dsh web --no-open --port 3999            # boots with the plugin loaded

# Drive a real agent turn that calls the tool (Node >= 24 strips the TypeScript):
node test/dsh-e2e/servers.ts ports.json &  # mock official API, injecting relay, driver LLM
dsh plugin --profile headless add ./dsh-model-fingerprint-0.1.0.tgz
# write $DSH_HOME/profiles/headless/cordis.patch.yml with the ports from ports.json:
#   llm-pi-ai providers `mockdriver` (openai-completions, apiKeyEnv DRIVER_KEY) and
#   `myrelay` (anthropic-messages, apiKeyEnv RELAY_KEY); agent-default-model -> mockdriver;
#   model-fingerprint.extraOfficialHosts -> [<official host:port>]
DRIVER_KEY=driver-key-abcdefghijkl RELAY_KEY=relay-key-abcdefghijklmn OFFICIAL_KEY=official-key-abcdefghijkl \
  dsh --profile headless --approval-policy never "Verify whether my relay really serves claude-sonnet-4-5."
```
