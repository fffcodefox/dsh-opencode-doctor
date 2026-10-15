# dsh-opencode-doctor

**English** | [中文](README.md)

**Pre-probed OpenCode model routes for DeepSeek Harness (DSH).**

See which models actually work — and which are region-blocked or out of credit — right in the model picker, instead of finding out one failed request at a time.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.18-brightgreen.svg)](package.json)
[![GitHub topic](https://img.shields.io/badge/topic-dsh--plugin-blueviolet.svg)](https://github.com/topics/dsh-plugin)

---

## The problem

A gateway's `/models` endpoint tells you what it *offers*, not what you are *entitled to use*.

Region blocks, exhausted balances, free tiers that only work inside the vendor's own client — none of that shows up until you actually send a request. So you pick a model, write your prompt, hit enter, and only then discover it never had a chance.

This plugin does that work **up front**: all 83 models were called once, for real, and the verdict is written into the model name.

## What it looks like

The DSH model picker renders only the model name (there is no description field), so the verdict goes in the name:

```
Claude Opus 5.5
Claude Sonnet 5.5
Grok 4.7
DeepSeek V4.1 Flash
GPT-6 Luna（地区限制）
Claude Fable 5（需充值）
Cat Jam Free（限官方客户端）
Gemini 4 Argon（协议不兼容）
```

The picker's fuzzy search then becomes a filter:

- type **需充值** → every model with no credit left
- type **地区限制** → everything that needs a proxy
- type **限官方客户端** → the free tiers you cannot use here

> The annotations are Chinese, matching the picker's own UI language. See [Availability vocabulary](#availability-vocabulary) below.

## Install

**From GitHub (recommended — no npm required):**

```bash
dsh plugin --profile web add github:fffcodefox/dsh-opencode-doctor
```

**From npm (once published):**

```bash
dsh plugin --profile web add dsh-opencode-doctor
```

Restart dsh, then look under **Settings → Models** for the new routes.

> **Config-only plugin.** All of its behaviour lives in `cordis.patch.yml`; it runs no runtime code (`apply` in `lib/index.mjs` is empty, present only to satisfy the plugin convention). That is why it cannot destabilise the DSH host, and why it will not touch your other settings.

## What it registers

Routes are generated from **whichever wire protocol actually worked**, so not every gateway has all three. Figures below are from the published probe (date in `models.catalog.json`):

| Route id | Protocol | Usable / total | Endpoint |
|---|---|---|---|
| `opencode-go-doctor-anthropic` | Anthropic Messages | 2 / 2 | `opencode.ai/inference/go/v1/messages` |
| `opencode-go-doctor-openai` | OpenAI compatible | 26 / 33 | `opencode.ai/inference/go/openai/v1` |
| `opencode-go-doctor-responses` | OpenAI Responses | 2 / 2 | `opencode.ai/inference/go/openai/v1` |
| `opencode-zen-doctor-anthropic` | Anthropic Messages | 7 / 7 | `opencode.ai/inference/v1/messages` |
| `opencode-zen-doctor-openai` | OpenAI compatible | 8 / 35 | `opencode.ai/inference/v1` |
| `opencode-zen-doctor-responses` | OpenAI Responses | 4 / 4 | `opencode.ai/inference/v1` |

**49 usable / 83 models**, spanning Claude, GPT, Grok, Gemini, DeepSeek, GLM, Qwen, Kimi and MiniMax families.

The same model is not equally usable on every protocol — Zen's Claude models answer only on Anthropic Messages, `grok-4.7` only on Responses. `probe` tries each protocol in turn and files the model under the route it genuinely works on.

## Availability vocabulary

| Note | Meaning |
|---|---|
| （需充值） | Account balance exhausted |
| （限官方客户端） | Free-tier model, usable only inside the official OpenCode client |
| （地区限制） | Blocked in your region — usually needs a proxy |
| （需授权训练数据） | Requires opting in to training-data use |
| （协议不兼容） | Listed by the gateway but answers none of the three wire protocols (mostly Gemini-family) |
| （暂不可用） | Other failure |

**No note = usable at probe time.**

## Credentials

The plugin reads its key from `refs.OPENCODE_API_KEY`, looked up in this order:

1. Environment variables `OPENCODE_API_KEY` / `OPENCODE_GO_API_KEY` / `OPENCODE_ZEN_API_KEY`
2. The `refs` block of `$DSH_HOME/.credentials.yaml` (default `~/.dsh/.credentials.yaml`)
3. OpenCode's own `auth.json` (`~/.local/share/opencode/`, `$OPENCODE_DATA/`, `%APPDATA%\opencode\`)

```yaml
# ~/.dsh/.credentials.yaml
refs:
  OPENCODE_API_KEY: st_xxxxxxxx
```

If you already run `dsh-opencode-go`, the key name is the same — **nothing to configure again**.

## CLI

Installing the package also gives you a `dsh-opencode-doctor` command (`npx dsh-opencode-doctor` works too):

```bash
npx dsh-opencode-doctor list      # what's in the catalog, and what's annotated (offline)
npx dsh-opencode-doctor check     # confirm the credential resolves and both gateways answer
npx dsh-opencode-doctor probe     # re-probe, rewriting catalog + patch
npx dsh-opencode-doctor render    # regenerate the patch from the catalog (offline)
```

`probe` sends one real request per model and writes the results back to `models.catalog.json` and `cordis.patch.yml`. You do not need to run it day to day — only when a gateway adds models, or when you want to re-confirm.

Useful flags: `--gateway <slug>` to probe one gateway, `--concurrency <n>`, `--key <key>`.

## FAQ

**Installed it but no new routes?**
Restart dsh. The model list is assembled at boot, and hot reload does not always cover provider registration.

**Does it conflict with `dsh-opencode-go`?**
No. Route ids carry a `-doctor` suffix so both plugins can coexist — registering the same route id twice fails the whole composition in DSH. The trade-off is that some models appear twice (one annotated, one not); keep whichever you prefer.

**Do the annotations go stale?**
Yes. Gateway permissions and your balance both change. Re-run `npx dsh-opencode-doctor probe` to refresh.

**Why doesn't the Anthropic route's baseURL contain `/v1`?**
pi-ai drives the Anthropic SDK, which appends `/v1/messages` itself. Writing `.../v1` produces `.../v1/v1/messages` and a 404.

**Why is there no "reasoning off" level on the Responses route?**
pi-ai forwards `off` as `reasoning_effort: "none"`, and the models on that route (grok, gpt-codex) reject `none` outright. Only real levels are declared.

**Anything else to install?**
No. `dsh-base` already mounts `@deepseek-ai/dsh-llm-pi-ai` with zero routes; this plugin only registers providers on it.

## How it works

One `cordis.patch.yml` registering six provider routes on `@deepseek-ai/dsh-llm-pi-ai`. DSH reads `dsh.bundle.patch` from `package.json` and applies it at boot.

Because it is pure configuration, it runs no code inside the host process.

`models.catalog.json` is the probe result, including each model's context window, output cap and reasoning levels. Metadata comes from [models.dev](https://models.dev), hand-checked.

## Known limitations

- Probe results are **time-sensitive** — see above.
- Only "can a conversation be established" is verified. Long context, tool calling and image input are **not** tested.
- Zen's Claude models speak Anthropic Messages while non-Claude models speak OpenAI; `probe` detects this and routes accordingly.

## License

MIT
