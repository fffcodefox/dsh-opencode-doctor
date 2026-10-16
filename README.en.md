# dsh-opencode-doctor

**English** | [中文](README.md)

**Pre-probed OpenCode model routes for DeepSeek Harness (DSH).**

See which models actually work — and which are out of credit — right in the model picker; the region-blocked ones are routed through your local proxy automatically, and the quota is one command away.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.18-brightgreen.svg)](package.json)
[![GitHub topic](https://img.shields.io/badge/topic-dsh--plugin-blueviolet.svg)](https://github.com/topics/dsh-plugin)

---

## What 0.2.2 changed

| Change | Detail |
|---|---|
| 🤝 **Companion comes along** | `dsh-opencode-go` is now a dependency and gets activated by this plugin's patch — nothing to install separately, and the quota pill plus account settings page arrive with it |
| 🔌 **Proxy port is configurable** | New `--proxy` flag and `OPENCODE_DOCTOR_PROXY` environment variable; the port is no longer hardcoded |
| 🔍 **`check` reports conflicts** | It now names the silent breakages: your own patch overriding this plugin's routes, and `model-proxy` / `opencode-go` being inserted twice |
| 📌 **Pinned install** | The install command targets a version tag instead of floating `main` |

### What 0.2.0 changed

| Change | Detail |
|---|---|
| 🌏 **Region blocks skipped** | The 15 region-blocked models now ride a local proxy (default `127.0.0.1:7897`); everything else keeps its direct connection, unaffected |
| 🔑 **Self-contained gateway** | `dsh-model-proxy` is declared as a dependency, so installing this plugin installs the proxy with it — nothing extra to hunt down |
| 🧹 **Cleaner names** | Problems this plugin already fixed no longer appear in the model name — 「地区限制」 is gone |
| ★ **Everyday shortlist** | 10 commonly used models carry a ★; type ★ in the picker to filter down to them |
| 📊 **Quota lookup** | New `usage` command: used / remaining, rolling / weekly / monthly, on one screen |
| 🐛 **Protocol dispatch fixed** | A model that hit a region block used to stop the protocol ladder and get filed under OpenAI; it now keeps trying until it finds the protocol that really works |

## The problem

A gateway's `/models` endpoint tells you what it *offers*, not what you are *entitled to use*.

Region blocks, exhausted balances, free tiers that only work inside the vendor's own client — none of that shows up until you actually send a request. So you pick a model, write your prompt, hit enter, and only then discover it never had a chance.

This plugin does that work **up front**: all 79 models were called once, for real, and the verdict is written into the model name.

## What it looks like

The DSH model picker renders only the model name (there is no description field), so the verdict goes in the name:

```
★ Claude Opus 5.5
★ Claude Sonnet 5.5
★ Grok 4.7
★ DeepSeek V4.1 Flash
★ GPT-5.3 Codex
Claude Fable 5（需充值）
Cat Jam Free（限官方客户端）
```

**Anything this plugin already fixed carries no annotation.** The 15 region-blocked models are routed through the proxy for you, so 「（地区限制）」 no longer appears in their names.

The picker's fuzzy search then becomes a filter:

- type **★** → the everyday shortlist only
- type **需充值** → every model with no credit left
- type **限官方客户端** → the free tiers you cannot use here

> The annotations are Chinese, matching the picker's own UI language. See [Availability vocabulary](#availability-vocabulary) below.

## Install

```bash
dsh plugin --profile web add github:fffcodefox/dsh-opencode-doctor#v0.2.2
```

**Keep the tag.** Without it you get floating `main`: the version someone receives is not reproducible, and anything you push to `main` lands on every installed copy.

Restart dsh, then look under **Settings → Models** for the new routes.

> **The official companion is installed with it.** `dsh-opencode-go` is declared in this package's `dependencies`, so it is installed along the way, and this plugin's patch activates it — you do **not** install it separately, and you do **not** add it to `dsh.profile.bundles`. The quota pill and the account settings page come with it.
>
> Don't want it? Add this to your profile patch:
>
> ```yaml
> - id: opencode-go
>   disabled: true
> ```

> **Config-only plugin.** All of its behaviour lives in `cordis.patch.yml`; it runs no runtime code (`apply` in `lib/index.mjs` is empty, present only to satisfy the plugin convention). That is why it cannot destabilise the DSH host, and why it will not touch your other settings.
>
> The one thing it does beyond configuration is that `opencode-go` row: it makes the official plugin run inside the same profile. The two plugins coexist (their route ids differ) at the cost of showing the same model twice in the picker — hide the official set with its own `modelVisibility` if you want only the annotated one.

## How the region block is skipped

The probe found 15 models blocked from mainland China (`unsupported_country_region_territory`). Instead of merely labelling them, the plugin routes them **through a proxy**:

```
you pick gpt-6-luna in DSH
        │
        ├─ on the proxy list? ──yes──→ 127.0.0.1:7897 ──→ opencode.ai   ✅
        │                                  (unreachable → falls back to direct)
        └───────────────────no────────→ direct to opencode.ai           ✅
```

- **Per-model, not global.** Only the 15 listed ids take the proxy hop; every other model keeps its direct connection — no "working model suddenly got slower".
- **Exact ids, never globs.** A glob that over-matched would silently reroute a perfectly healthy model.
- **Works without a proxy.** `fallbackToDirect` is on: if the proxy is unreachable those models fall back to a direct call, exactly as they behaved before you installed anything.
- **Scoped to `opencode.ai`** as the only origin the proxy may take over.

### Proxy on a different port?

The default `http://127.0.0.1:7897` is just Clash Verge / Mihomo's usual port — it is **not** a requirement. Three ways to change it, easiest first:

**1. Rewrite it from the command line (recommended)** — regenerates the patch with the port written in:

```bash
npx dsh-opencode-doctor render --proxy http://127.0.0.1:7890
```

`probe` takes the same flag, so re-probing writes it in as well:

```bash
npx dsh-opencode-doctor probe --proxy http://127.0.0.1:10809
```

Prefer not to type it every time? Set the environment variable and both commands pick it up:

```bash
OPENCODE_DOCTOR_PROXY=http://127.0.0.1:7890 npx dsh-opencode-doctor render
```

You never have to guess the effective value — the first line of `npx dsh-opencode-doctor check` prints it.

**2. Override it in your profile patch** — for people who would rather not touch the plugin directory:

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: model-proxy
  name: dsh-model-proxy
  config:
    enabled: true
    proxy: "http://127.0.0.1:7890"   # ← change only this
    origins:
      - opencode.ai
    models: [ ... copy these across verbatim ... ]
    fallbackToDirect: true
```

A DSH patch **replaces the whole `config` object** (it does not deep-merge), so copy `origins` / `models` across too and change only `proxy`.

**3. Edit `cordis.patch.yml` in the plugin directory** — it works, but upgrading the plugin overwrites it. Not recommended.

**What if the port is wrong?** Nothing breaks. `fallbackToDirect: true` sends those models down a direct connection — the same behaviour you had before installing — so the only symptom is that the 15 region-blocked models fail, and their names carry **no** annotation (the plugin believes it already fixed them). If they error, the port is the first thing to check.

> **Keep exactly one `model-proxy` row.** If `dsh-model-proxy` is also listed in your profile's `dsh.profile.bundles`, its own patch inserts a second row (default 7890) — two rows sharing an id **chain** instead of overriding, so drop that name from the bundles list. `npx dsh-opencode-doctor check` reports exactly this case. As a dependency of this plugin it stays installed and resolvable either way.

## The ★ shortlist

The picker has no favourites feature, but it does fuzzy-search names — so the 10 models most people reach for first carry a ★ prefix, and **typing ★ leaves only them**:

`Claude Opus 5.5` · `Claude Sonnet 5.5` · `Claude Haiku 5.5` · `GPT-5.3 Codex` · `Grok 4.7` · `DeepSeek V4.1 Flash` · `GLM-5.3` · `Kimi K3` · `Qwen3.8 Max` · `MiniMax-M3`

When a model appears on more than one route, **all** of those entries are starred, so the filter works no matter which protocol it ended up on.

## Quota lookup

No more opening the dashboard to check your balance:

```bash
npx dsh-opencode-doctor usage
```

```
OpenCode Go 额度  st_96e…c4d9 ← ~/.dsh/.credentials.yaml → refs.OPENCODE_API_KEY

  窗口             已用  用掉                   剩余   重置
  滚动窗口 rolling  41%  ████████░░░░░░░░░░░░    59%   10-16 01:18
  本周     weekly   49%  ██████████░░░░░░░░░░    51%   10-19 08:00
  本月     monthly  24%  █████░░░░░░░░░░░░░░░    76%   11-13 23:55
```

- The three windows are the same ones the official panel shows; `remaining = 100 − used`.
- The bar turns yellow at 70% and red at 90%, so a nearly spent window is obvious at a glance.
- `--json` for scripting.
- Your key is only ever shown masked, as `st_96e…c4d9`.

## What it registers

Routes are generated from **whichever wire protocol actually worked**, so not every gateway has all three. Figures below are from the published probe (date in `models.catalog.json`):

| Route id | Protocol | Usable / total | Endpoint |
|---|---|---|---|
| `opencode-go-doctor-anthropic` | Anthropic Messages | 2 / 2 | `opencode.ai/inference/go/v1/messages` |
| `opencode-go-doctor-openai` | OpenAI compatible | 30 / 31 | `opencode.ai/inference/go/openai/v1` |
| `opencode-go-doctor-responses` | OpenAI Responses | 4 / 4 | `opencode.ai/inference/go/openai/v1` |
| `opencode-zen-doctor-anthropic` | Anthropic Messages | 7 / 8 | `opencode.ai/inference/v1/messages` |
| `opencode-zen-doctor-openai` | OpenAI compatible | 11 / 21 | `opencode.ai/inference/v1` |
| `opencode-zen-doctor-responses` | OpenAI Responses | 13 / 13 | `opencode.ai/inference/v1` |

**67 unannotated / 79 models registered**, spanning Claude, GPT, Grok, DeepSeek, GLM, Qwen, Kimi and MiniMax families. 15 of them need the proxy above to connect at all.

The same model is not equally usable on every protocol — Zen's Claude models answer only on Anthropic Messages, `grok-4.7` only on Responses, and `gpt-6-luna` only on Responses *through the proxy*. `probe` tries each protocol in turn and files the model under the route it genuinely works on.

## Availability vocabulary

| Note | Meaning |
|---|---|
| （需充值） | Account balance exhausted |
| （限官方客户端） | Free-tier model, usable only inside the official OpenCode client |
| （需授权训练数据） | Requires opting in to training-data use |
| （暂不可用） | Other failure |

**No note = usable at probe time.** Region-blocked models are **not** listed here: the plugin already fixed them by routing them through the proxy, so their names stay clean.

> The probe still records a 「地区限制」 verdict internally (`code: region` in `models.catalog.json`) — that is what decides who joins the proxy list. It just no longer reaches the model name.

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

**Your key is never written into the plugin or the repository.** `cordis.patch.yml` only names the variable (`apiKeyEnv: OPENCODE_API_KEY`); the key itself is resolved by DSH at boot and sent as an `Authorization` header to opencode.ai — exactly what the official client does.

## CLI

Installing the package also gives you a `dsh-opencode-doctor` command (`npx dsh-opencode-doctor` works too):

```bash
npx dsh-opencode-doctor list      # what's in the catalog, and what's annotated (offline)
npx dsh-opencode-doctor usage     # Go quota: used / remaining, rolling / weekly / monthly
npx dsh-opencode-doctor check     # credential, both gateways, and composition conflicts
npx dsh-opencode-doctor probe     # re-probe, rewriting catalog + patch
npx dsh-opencode-doctor render    # regenerate the patch from the catalog (offline)
```

`probe` sends one real request per model and writes the results back to `models.catalog.json` and `cordis.patch.yml`. You do not need to run it day to day — only when a gateway adds models, or when you want to re-confirm. **Re-probing also refreshes the proxy list**: the day a gateway lifts a region block, that model returns to a direct connection on its own.

Useful flags: `--gateway <slug>` to probe one gateway, `--concurrency <n>`, `--timeout <ms>`, `--key <key>`, `--proxy <url>` for the egress proxy (`probe` / `render`).

`check` does useful work before it touches the network: it reads your local configuration and names the **compositions that would silently disable this plugin** (your own patch overriding `llm-pi-ai`, `model-proxy` / `opencode-go` inserted twice), then verifies the credential and both gateways. Run it once after installing.

## FAQ

**I don't have a proxy — will installing this make things worse?**
No. When the proxy is unreachable the listed models fall back to a direct connection (`fallbackToDirect`), which is how they behaved before; the other 64 models were always direct.

**I already use `dsh-model-proxy` — will they fight?**
They will duplicate. `dsh-model-proxy`'s own bundle patch also inserts a `model-proxy` row (default `127.0.0.1:7890`, matching `grok-*` / `gpt-*-luna`). Two rows sharing that id do **not** override each other — they chain into two dispatchers, so `grok-*` first tries 7890. Remove it from your profile's `dsh.profile.bundles` list: as a dependency of this plugin it stays installed and resolvable, and the row this plugin inserts is the only live one.

**Installed it but no new routes?**
Restart dsh. The model list is assembled at boot, and hot reload does not always cover provider registration.

**Why are the Gemini models missing?**
Zen's four Gemini models speak Google's native protocol (`generateContent`), and DSH's `llm-pi-ai` accepts only `openai-completions` / `openai-responses` / `anthropic-messages` — naming a fourth fails validation for the **entire** provider config and takes every other route down with it. So they are held back for now; the probe result stays in the catalog and they reappear automatically once upstream widens that table.

**Does it conflict with `dsh-opencode-go`?**
No — and it is installed anyway. The official plugin is a dependency of this one, and the `opencode-go` row this plugin inserts is what activates it: nothing to install separately, nothing to add to `dsh.profile.bundles`. Route ids carry a `-doctor` suffix so both plugins coexist, at the cost of some models appearing twice. To keep only the annotated copy, hide the official set with its own `modelVisibility`:

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: opencode-go
  config:
    modelVisibility:
      claude-opus-5-5: false   # per model; anything omitted stays visible
```

**What if I don't want the official plugin?**
Turn it off from your profile patch (`disabled` is a switch — the dependency stays installed):

```yaml
- id: opencode-go
  disabled: true
```

**Will my own `- id: llm-pi-ai` row wipe this plugin's routes?**
Yes — this is the easiest trap to fall into. A DSH patch **replaces the whole `config` object**, and the profile patch is applied *after* the plugin patch, so your row swaps out the entire `providers` map and all six routes vanish. Merge your providers into that row, or avoid `llm-pi-ai` in patch files altogether — adding providers from the web **Models** page does not conflict, because that path writes the settings document, which deep-merges per `providers.<id>`. `npx dsh-opencode-doctor check` reports this conflict directly.

**Do the annotations go stale?**
Yes. Gateway permissions and your balance both change. Re-run `npx dsh-opencode-doctor probe` to refresh.

**`usage` errors out, or shows no data?**
That endpoint lives on the Go gateway (`/zen/go/v1/usage`) and needs a key with a Go plan; a Zen-only key returns nothing.

**Why doesn't the Anthropic route's baseURL contain `/v1`?**
pi-ai drives the Anthropic SDK, which appends `/v1/messages` itself. Writing `.../v1` produces `.../v1/v1/messages` and a 404.

**Why is there no "reasoning off" level on the Responses route?**
pi-ai forwards `off` as `reasoning_effort: "none"`, and the models on that route (grok, gpt-codex) reject `none` outright. Only real levels are declared.

**Anything else to install?**
No. Both dependencies are declared in this package's `dependencies` and install with the plugin: `dsh-model-proxy` (region-block routing) and `dsh-opencode-go` (the official plugin, which provides the quota pill and the account settings page).

## How it works

One `cordis.patch.yml` doing three things:

1. Registers six provider routes on `@deepseek-ai/dsh-llm-pi-ai`.
2. `insert`s an `opencode-go` row — the official plugin is already installed as a dependency, and this row is what **activates** it.
3. `insert`s a `model-proxy` row, handing per-model egress to `dsh-model-proxy`.

DSH reads `dsh.bundle.patch` from `package.json` and applies it at boot. Because it is pure configuration, it runs no code inside the host process.

### The two patch layers (the trap)

A DSH patch merges in **two different ways**, and mixing them up loses configuration silently:

| Layer | Written in | Behaviour |
|---|---|---|
| **Composition** | `cordis.patch.yml` (plugin / profile / home / `--patch`) | `target[key] = value` — a **whole-value replacement**, no deep merge |
| **Settings** | `llm-pi-ai.providers.<id>` written by the web Models page | **Recursive deep merge**, overriding only that one provider |

The counter-intuitive consequence: adding your own provider from the **web settings page** leaves the plugin's six routes alone, but writing a `- id: llm-pi-ai` row in a **patch file** replaces the plugin's entire `providers` map and removes all six (the profile patch is applied after the plugin patch). `npx dsh-opencode-doctor check` reports this.

### Apply order

```
@deepseek-ai/dsh-base → …other bundles… → dsh-opencode-doctor
    → ~/.dsh/profiles/<name>/cordis.patch.yml
        → ~/.dsh/cordis.patch.yml
            → --patch overlays
```

Later layers win, so all three inserted rows are **overridable** — write the same row id in your own layer and it takes over (copy `model-proxy`'s `config` across verbatim; see above).

`models.catalog.json` is the probe result, including each model's context window, output cap, reasoning levels and the route it belongs to. Metadata comes from [models.dev](https://models.dev), hand-checked.

## Releasing

The install command is pinned to a tag, so **every release must move the tag name** or the README keeps pointing at the old version:

```bash
# 1. bump version in package.json (0.2.2 → 0.2.3)
# 2. update the tag in README.md / README.en.md (#v0.2.2 → #v0.2.3)
# 3. commit, tag, push
git add -A
git commit -m "release: v0.2.3"
git tag -a v0.2.3 -m "v0.2.3 — <one line>"
git push origin main --follow-tags

# 4. create the Release
gh release create v0.2.3 --title "v0.2.3 — <one line>" --notes-file <notes.md>
```

All three places have to move together; miss one and you get "README says v0.2.3, installing gives v0.2.2". Verify with `npx dsh-opencode-doctor -v` afterwards.

## Known limitations

- Probe results are **time-sensitive** — see above.
- Only "can a conversation be established" is verified. Long context, tool calling and image input are **not** tested.
- Proxied models need a local HTTP proxy (Clash Verge / Mihomo / anything else); the plugin does not ship a proxy server.
- Zen's Claude models speak Anthropic Messages while non-Claude models speak OpenAI; `probe` detects this and routes accordingly.

## License

MIT
