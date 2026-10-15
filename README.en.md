# dsh-opencode-doctor

English | [中文](README.md)

**Availability-probed** OpenCode model routes for DeepSeek Harness.

A gateway's `/models` endpoint tells you what it *can* serve — not what your account *may* use, and not which wire protocol each model answers on. Region blocks, empty balances, client-only free tiers and protocol mismatches only show up when you actually send a request. This package does that ahead of time and writes the verdict into the model name.

## What it looks like

The DSH model picker renders **only the model name** (there is no description line), so the verdict goes in the name:

```
Claude Opus 5.5
GPT-6 Luna（地区限制）
Claude Fable 5（需充值）
Cat Jam Free（限官方客户端）
```

Bonus: the picker has fuzzy search, so typing `需充值` filters the whole group.

## Install

Straight from GitHub (**recommended — no npm required**):

```bash
dsh plugin --profile web add github:fffcodefox/dsh-opencode-doctor
```

Once the package is on npm you can also install by name:

```bash
dsh plugin --profile web add dsh-opencode-doctor
```

Restart dsh, then look under **Settings → Models**.

> This is a **config-only** plugin: all of its behaviour lives in `cordis.patch.yml` and it runs no runtime code (`apply` in `lib/index.mjs` is empty, present only to satisfy the plugin convention). That is why it cannot destabilise the DSH host.


## Routes registered

Route ids carry a `-doctor` suffix and a protocol suffix on purpose — `dsh-opencode-go` owns `opencode-go`, and registering the same route id twice fails the whole composition. The trade-off: if both plugins are installed you will see two copies of some models (one annotated, one not). Keep whichever you prefer.

## Credential

The plugin reads `refs.OPENCODE_API_KEY`, resolved in this order:

1. Env var `OPENCODE_API_KEY` / `OPENCODE_GO_API_KEY` / `OPENCODE_ZEN_API_KEY`
2. The `refs` block of `$DSH_HOME/.credentials.yaml` (default `~/.dsh/.credentials.yaml`)
3. OpenCode's own `auth.json` (`~/.local/share/opencode/`, `$OPENCODE_DATA/`, `%APPDATA%\opencode\`)

```yaml
# ~/.dsh/.credentials.yaml
refs:
  OPENCODE_API_KEY: st_xxxxxxxx
```

If you already run `dsh-opencode-go`, the key name is the same — nothing extra to configure.

## CLI

```bash
npx dsh-opencode-doctor list      # what the shipped catalog contains (offline)
npx dsh-opencode-doctor check     # is the credential readable, do the gateways answer
npx dsh-opencode-doctor probe     # re-probe everything, rewrite catalog + patch
npx dsh-opencode-doctor render    # regenerate the patch from the catalog (offline)
```

`probe` sends one real request per model per protocol and writes the result back to `models.catalog.json` and `cordis.patch.yml`. You rarely need it — only when the gateway adds models, or when you want to re-confirm your access.

Useful flags: `--gateway <key>` to probe one gateway, `--concurrency <n>`, `--key <key>`.

## Availability vocabulary

| Note | Meaning |
|---|---|
| （需充值） | Account balance exhausted |
| （限官方客户端） | Free-tier model, usable only inside the OpenCode client |
| （地区限制） | Blocked in your region |
| （需授权训练数据） | Requires opting in to training-data use |
| （协议不兼容） | Listed by the gateway but answers none of the three wire protocols (mostly Gemini-family) |
| （暂不可用） | Other failure |

No note = usable at probe time.

## Data source

`models.catalog.json` holds the probe result, including context window, output limit and reasoning levels per model. Metadata beyond the verdict comes from [models.dev](https://models.dev), hand-checked.

## How it works

This is a **config-only plugin** — no runtime code, just a `cordis.patch.yml` that registers provider routes on `@deepseek-ai/dsh-llm-pi-ai` (already mounted by dsh-base with zero routes by default). DSH reads `dsh.bundle.patch` from `package.json` at boot and applies it.

Because there is no runtime code, nothing executes in the host process and nothing else in your config is touched.

## Known limits

- Verdicts **go stale**. Access changes and balance changes both invalidate them — re-run `probe`.
- Probing only verifies "a conversation can be established", not long context, tool calling or image input.
- On the Zen gateway the Claude models answer on Anthropic Messages while non-Claude models answer on OpenAI-compatible — `probe` detects this and files each model under the right route.

## License

MIT
