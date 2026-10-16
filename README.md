# dsh-opencode-doctor

[English](README.en.md) | **中文**

**给 DeepSeek Harness（DSH）装上「已经实测过可用性」的 OpenCode 模型路由。**

哪些模型真能用、哪些被地区封锁 —— 装完在选择器里一眼看到；被封锁的自动走你本地的代理，额度还能一条命令查出来。

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.18-brightgreen.svg)](package.json)
[![GitHub topic](https://img.shields.io/badge/topic-dsh--plugin-blueviolet.svg)](https://github.com/topics/dsh-plugin)

---

## 0.2.2 更新了什么

| 更新 | 说明 |
|---|---|
| 🤝 **官方插件一起装** | `dsh-opencode-go` 成为本插件的依赖并被自动激活 —— 不用再单独装一次，额度胶囊和账号设置页直接可用 |
| 🔌 **代理端口可改** | 新增 `--proxy` 参数和 `OPENCODE_DOCTOR_PROXY` 环境变量，端口不再是硬编码 |
| 🔍 **`check` 会查冲突** | 直接报出「你自己的 patch 会覆盖掉本插件的路由」和「`model-proxy` / `opencode-go` 被重复插入」这类静默问题 |
| 📌 **安装带 tag** | 安装命令固定到版本 tag，不再装浮动的 `main` |

### 0.2.0 有什么

| 更新 | 说明 |
|---|---|
| 🌏 **地区限制自动跳过** | 15 个被地区封锁的模型自动走本地代理（默认 `127.0.0.1:7897`），其余模型继续直连，互不影响 |
| 🔑 **网关自包含** | `dsh-model-proxy` 已写成依赖，装插件时自动装上，不用你另外找东西装 |
| 🧹 **标注更干净** | 已经修好的问题不再写在模型名里 —— 「地区限制」这几个字已经消失 |
| ★ **常用模型清单** | 10 个最常用的模型加了 ★，选择器里输入 ★ 直接筛出来 |
| 📊 **额度查询** | 新增 `usage` 命令：已用 / 剩余 / 本周 / 本月，一屏看完 |
| 🐛 **协议分派修复** | 之前模型碰到「地区限制」就停止换协议，会被错误地塞进 OpenAI 路由；现在会继续试到真正能跑的那条 |

## 解决什么问题

网关的 `/models` 接口告诉你它**能提供**什么，不告诉你你**有权用**什么。

地区封锁、余额不足、只限官方客户端的免费层 —— 这些只有真的发一次请求才会暴露。等你选中模型、写好 prompt、按下回车，才发现它根本跑不了。

这个插件把这件事**提前做完**：79 个模型，每一个都真发过一次请求，结论直接写进模型名。

## 效果

DSH 的模型选择器只渲染模型名（不显示描述字段），所以可用性结论就写在名字里：

```
★ Claude Opus 5.5
★ Claude Sonnet 5.5
★ Grok 4.7
★ DeepSeek V4.1 Flash
★ GPT-5.3 Codex
Claude Fable 5（需充值）
Cat Jam Free（限官方客户端）
```

**已经修好的问题不再标注。** 地区封锁的 15 个模型现在由插件自己走代理，名字里干干净净 —— 之前的「（地区限制）」字样不会出现了。

顺带的好处：选择器自带模糊搜索。

- 输入「**★**」→ 只剩常用模型
- 输入「**需充值**」→ 筛出余额不足的那组
- 输入「**限官方客户端**」→ 排除只能官方客户端用的免费层

## 安装

```bash
dsh plugin --profile web add github:fffcodefox/dsh-opencode-doctor#v0.2.2
```

**tag 一定要带。** 不带 tag 装的是浮动的 `main`，别人拿到的版本无法复现，你以后往 main 推什么都会直接打到所有已安装的人身上。

装完**重启 dsh**，进 **设置 → 模型**，就能看到下面这些新路由。

> **官方插件一起装好了。** `dsh-opencode-go` 写在本插件的 `dependencies` 里，安装时自动带上，并由本插件的 patch 自动激活 —— 你**不需要**再单独装一次，也不需要把它加进 `dsh.profile.bundles`。额度胶囊、账号设置页都跟着一起来。
>
> 不想要它？在自己的 profile patch 里写：
>
> ```yaml
> - id: opencode-go
>   disabled: true
> ```

> **纯配置插件。** 它的全部行为都在 `cordis.patch.yml` 里，不跑任何运行时代码（`lib/index.mjs` 的 `apply` 是空的，只为符合插件规范）。所以它不会影响 DSH 宿主的稳定性，也不会碰你的其它配置。
>
> 唯一的例外是上面那条 `opencode-go`：它会让官方插件在同一个 profile 里跑起来。两个插件可以共存（路由 id 不同），代价是同一个模型在选择器里出现两份 —— 想只留带标注的那份，用官方插件自己的 `modelVisibility` 把它的模型藏掉。

## 地区限制是怎么跳过的

探测发现 15 个模型在中国大陆被封锁（`unsupported_country_region_territory`）。插件不再只是把它们标出来，而是让它们**走代理出去**：

```
你在 DSH 里选 gpt-6-luna
        │
        ├─ 命中代理清单？──是──→ 127.0.0.1:7897 ──→ opencode.ai   ✅
        │                              （探测不到就自动回落直连）
        └──────────────否────────────→ 直连 opencode.ai             ✅
```

- **按模型分流，不做全局代理。** 只有清单里的 15 个模型走代理，其它模型一点不受影响 —— 不会出现「本来能直连的模型被代理带慢」的情况。
- **清单是精确 id，不是通配符。** 避免误伤本来正常的模型。
- **没代理也能用。** `fallbackToDirect` 打开着：代理连不上时，这些模型退回直连，行为和你没装插件时一样。
- **只拦 opencode.ai。** 出口规则限定在这个域名。

### 代理端口不是 7897 怎么改？

默认值 `http://127.0.0.1:7897` 只是 Clash Verge / Mihomo 的常用端口，**不是要求**。三种改法，按省事程度排：

**1. 命令行重写（推荐）** —— 重新生成 patch，端口跟着写进去：

```bash
npx dsh-opencode-doctor render --proxy http://127.0.0.1:7890
```

`probe` 接受同一个参数，重探模型时会一起写进去：

```bash
npx dsh-opencode-doctor probe --proxy http://127.0.0.1:10809
```

不想每次敲参数，就设个环境变量，`render` / `probe` 都会用它：

```bash
OPENCODE_DOCTOR_PROXY=http://127.0.0.1:7890 npx dsh-opencode-doctor render
```

当前生效的值不用猜 —— `npx dsh-opencode-doctor check` 第一行就会打出来。

**2. 在 profile patch 里覆盖** —— 适合不想动插件目录的人：

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: model-proxy
  name: dsh-model-proxy
  config:
    enabled: true
    proxy: "http://127.0.0.1:7890"   # ← 只改这里
    origins:
      - opencode.ai
    models: [ ... 原样抄过来 ... ]
    fallbackToDirect: true
```

DSH 的 patch 是**整体替换** `config` 对象（不是深合并），所以要连 `origins` / `models` 一起抄过去，只改 `proxy` 那一行。

**3. 直接改插件目录里的 `cordis.patch.yml`** —— 能跑，但升级插件会覆盖，不推荐。

**端口写错了会怎样？** 不会崩。`fallbackToDirect: true` 让这些模型回落直连 —— 行为和没装插件一样，只是那 15 个地区受限模型连不上。而且它们名字里**不带**标注（插件认为已经修好了），所以如果你发现它们报错，第一个要查的就是这个端口。

> **只留一条 `model-proxy` 行。** 如果 `dsh-model-proxy` 也被单独列在你 profile 的 `dsh.profile.bundles` 里，它自带的 patch 会再插一条（默认 7890）—— 两条同 id 的行是**串联**而不是覆盖，请把那个名字从 bundles 列表里删掉。`npx dsh-opencode-doctor check` 会把这种情况直接报出来。作为本插件的依赖，它照样装着、能被解析到。

## ★ 常用模型

选择器里没有「收藏」这个功能，但名字可以模糊搜索 —— 所以把最常用的 10 个模型加了 ★ 前缀，**输入 ★ 就只剩它们**：

`Claude Opus 5.5` · `Claude Sonnet 5.5` · `Claude Haiku 5.5` · `GPT-5.3 Codex` · `Grok 4.7` · `DeepSeek V4.1 Flash` · `GLM-5.3` · `Kimi K3` · `Qwen3.8 Max` · `MiniMax-M3`

同一个模型出现在多条路由上时会**都**带星，所以不管它最后落在哪个协议，都筛得出来。

## 额度查询

不用再登网页翻额度，一条命令：

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

- 三个窗口就是官方面板里的滚动窗口 / 本周 / 本月，`剩余 = 100 − 已用`。
- 进度条到 70% 变黄、90% 变红，快用完了一眼就能看出来。
- 加 `--json` 可以接进脚本。
- key 只以 `st_96e…c4d9` 这种打码形式显示，不会完整打印。

## 覆盖范围

路由按**实际能跑通的协议**生成，所以不是每个网关都有三条。下面是发布时的实测结果（探测日期见 `models.catalog.json`）：

| 路由 id | 协议 | 可用 / 总数 | 端点 |
|---|---|---|---|
| `opencode-go-doctor-anthropic` | Anthropic Messages | 2 / 2 | `opencode.ai/inference/go/v1/messages` |
| `opencode-go-doctor-openai` | OpenAI 兼容 | 30 / 31 | `opencode.ai/inference/go/openai/v1` |
| `opencode-go-doctor-responses` | OpenAI Responses | 4 / 4 | `opencode.ai/inference/go/openai/v1` |
| `opencode-zen-doctor-anthropic` | Anthropic Messages | 7 / 8 | `opencode.ai/inference/v1/messages` |
| `opencode-zen-doctor-openai` | OpenAI 兼容 | 11 / 21 | `opencode.ai/inference/v1` |
| `opencode-zen-doctor-responses` | OpenAI Responses | 13 / 13 | `opencode.ai/inference/v1` |

**合计 67 个无标注 / 79 个模型下发**，覆盖 Claude、GPT、Grok、DeepSeek、GLM、Qwen、Kimi、MiniMax 等系列。其中 15 个靠上面的代理才能连上。

同一个模型在不同协议下的可用性并不一致 —— 比如 Zen 的 Claude 只认 Anthropic Messages，`grok-4.7` 只认 Responses，`gpt-6-luna` 只在 Responses + 代理下能跑。`probe` 会逐个协议试，把模型归到它**真正能跑**的那条路由上。

## 标注词汇

| 标注 | 含义 |
|---|---|
| （需充值） | 账户余额不足 |
| （限官方客户端） | 免费层模型，只能在 OpenCode 官方客户端里用 |
| （需授权训练数据） | 需要先授权用你的数据训练 |
| （暂不可用） | 其它失败 |

**没有标注 = 探测时可用。** 地区封锁的模型**不在这里**：它们已经被插件修好（走代理），所以名字里不留字。

> 探测内部仍然会记录「地区限制」这个结论（`models.catalog.json` 里的 `code: region`）—— 它决定了谁进代理清单。只是不再写进模型名。

## 凭证

插件从 `refs.OPENCODE_API_KEY` 读 key，按这个顺序找：

1. 环境变量 `OPENCODE_API_KEY` / `OPENCODE_GO_API_KEY` / `OPENCODE_ZEN_API_KEY`
2. `$DSH_HOME/.credentials.yaml`（默认 `~/.dsh/.credentials.yaml`）的 `refs` 块
3. OpenCode 自己的 `auth.json`（`~/.local/share/opencode/`、`$OPENCODE_DATA/`、`%APPDATA%\opencode\`）

```yaml
# ~/.dsh/.credentials.yaml
refs:
  OPENCODE_API_KEY: st_xxxxxxxx
```

已经装过 `dsh-opencode-go` 的话，key 名是同一个，**不用重复配置**。

**你的 key 不会被写进插件或仓库。** `cordis.patch.yml` 里只有 `apiKeyEnv: OPENCODE_API_KEY` 这个变量名，key 本体在 DSH 启动时从上面这些位置读，请求时放在 `Authorization` 头里发给 opencode.ai —— 和官方客户端做的事一样。

## CLI

装完之后有个 `dsh-opencode-doctor` 命令（`npx dsh-opencode-doctor` 也行）：

```bash
npx dsh-opencode-doctor list      # 看目录里有什么、哪些被标注（离线）
npx dsh-opencode-doctor usage     # 查 Go 套餐额度：已用 / 剩余 / 本周 / 本月
npx dsh-opencode-doctor check     # 凭证、两个网关、以及组合冲突，一次查完
npx dsh-opencode-doctor probe     # 重新探测，重写 catalog + patch
npx dsh-opencode-doctor render    # 只从 catalog 重新生成 patch（离线）
```

`probe` 会对每个模型真发一次请求，结果写回 `models.catalog.json` 和 `cordis.patch.yml`。日常用不着跑 —— 只有网关更新了模型、或你想重新确认一遍时再跑。**重跑 probe 也会自动刷新代理清单**，网关哪天放开某个模型的地区限制，它会自动回到直连。

常用参数：`--gateway <slug>` 只测一个网关、`--concurrency <n>` 并发数、`--timeout <ms>` 单请求超时、`--key <key>` 直接给 key、`--proxy <url>` 出口代理（`probe` / `render` 用）。

`check` 不打网络请求也能干活 —— 它先读本机配置，把**会让插件静默失效的组合**报出来（你自己的 patch 覆盖了 `llm-pi-ai`、`model-proxy` / `opencode-go` 被重复插入），然后才去验证凭证和网关。装完插件先跑一次这个。

## 常见问题

**我没有代理，装了会不会变差？**
不会。代理连不上时清单里的模型自动回落直连（`fallbackToDirect`），表现和你没装插件一样；其它 64 个模型本来就走直连。

**我本来就在用 `dsh-model-proxy`，会打架吗？**
会重复。`dsh-model-proxy` 自己带的 bundle patch 也会插一条 `model-proxy`（默认 `127.0.0.1:7890`，只匹配 `grok-*` / `gpt-*-luna`）。两条同 id 的行**不会互相覆盖**，而是串成两条 dispatcher —— 于是 `grok-*` 会先去敲 7890。把它从 profile 的 `dsh.profile.bundles` 列表里删掉即可：它作为本插件的依赖仍然装着、能被解析到，而插件插入的那条就是唯一生效的一条。

**装完看不到新路由？**
重启 dsh。模型列表在启动时组装，热重载不一定覆盖 provider 注册。

**Gemini 为什么不在列表里？**
Zen 的 4 个 Gemini 走的是 Google 原生协议（`generateContent`），而 DSH 的 `llm-pi-ai` 只接受 `openai-completions` / `openai-responses` / `anthropic-messages` 三种 —— 写第四种会让**整个** provider 配置校验失败，把其它路由一起带倒。所以它们暂时不下发；探测结果留在 catalog 里，上游哪天放开就会自动回来。

**会和 `dsh-opencode-go` 冲突吗？**
不会，而且现在它**本来就装着**。官方插件是本插件的依赖，patch 里 insert 的那条 `opencode-go` 行负责激活它 —— 你不用再单独装、也不用加进 `dsh.profile.bundles`。路由 id 带了 `-doctor` 后缀，两边可以共存，代价是同一个模型在选择器里出现两份。想只留带标注的那份，用官方插件自己的 `modelVisibility` 藏掉它的模型：

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: opencode-go
  config:
    modelVisibility:
      claude-opus-5-5: false   # 逐个模型关；省略的保持显示
```

**不想要官方插件怎么办？**
在 profile patch 里关掉它（`disabled` 是开关，不会删掉依赖）：

```yaml
- id: opencode-go
  disabled: true
```

**我自己的 `- id: llm-pi-ai` 会不会把插件的路由弄没？**
会 —— 这是最容易踩的一个坑。DSH 的 patch 是**整体替换** `config` 对象，而 profile patch 在插件 patch **之后**应用，所以你写的那条会把插件的 `providers` 整块换掉，6 条路由全消失。修法是把你的 provider 抄进插件那条，或者干脆别在 patch 里写 `llm-pi-ai` —— 从**网页的「模型」设置页**加 provider 不会冲突，那条路径走的是 settings 文档，按 `providers.<id>` 逐项深合并。`npx dsh-opencode-doctor check` 会把这种冲突直接报出来。

**标注会不会过期？**
会。网关改权限、你的余额变化都会让它失效。重跑 `npx dsh-opencode-doctor probe` 即可刷新。

**`usage` 报错 / 显示没有数据？**
这个接口在 Go 网关下（`/zen/go/v1/usage`），只有 Go 套餐的 key 才有。用 Zen-only 的 key 会取不到。

**为什么 Anthropic 路由的 baseURL 不含 `/v1`？**
pi-ai 走 Anthropic SDK，SDK 自己会拼 `/v1/messages`。写成 `.../v1` 会变成 `.../v1/v1/messages` 直接 404。

**为什么 Responses 路由没有「关闭推理」这一档？**
pi-ai 把 `off` 转发成 `reasoning_effort: "none"`，而这条路由上的模型（grok、gpt-codex）不接受 `none`。所以只声明真实可用的档位。

**需要额外装什么吗？**
不用。两个依赖都写在这个包的 `dependencies` 里，装插件时自动装上：`dsh-model-proxy`（地区限制转发）和 `dsh-opencode-go`（官方插件，提供额度胶囊和账号设置页）。

## 工作原理

一份 `cordis.patch.yml`，干三件事：

1. 往 `@deepseek-ai/dsh-llm-pi-ai` 注册 6 条 provider 路由；
2. `insert` 一条 `opencode-go` 行 —— 官方插件作为依赖已经装好了，这一行负责把它**激活**；
3. `insert` 一条 `model-proxy` 行，交给 `dsh-model-proxy` 按模型名分流出口。

DSH 启动时读 `package.json` 的 `dsh.bundle.patch` 应用它。因为是纯配置，它不在宿主进程里跑任何代码。

### patch 的两层语义（踩坑点）

DSH 的 patch 有**两种**合并行为，搞混了会静默丢配置：

| 层 | 写在哪 | 行为 |
|---|---|---|
| **组合层** | `cordis.patch.yml`（插件 / profile / home / `--patch`） | `target[key] = value` —— **整体替换**，不深合并 |
| **settings 层** | 网页「模型」设置页写下的 `llm-pi-ai.providers.<id>` | 逐项**递归深合并**，只覆盖同名的那个 provider |

于是有个反直觉的后果：从**网页设置页**加自己的 provider，不会影响插件的 6 条路由；但在 **patch 文件**里写一条 `- id: llm-pi-ai`，会把插件的 `providers` 整块换掉，6 条路由全部消失（profile patch 在插件 patch 之后应用）。`npx dsh-opencode-doctor check` 会把这个情况直接报出来。

### 应用顺序

```
@deepseek-ai/dsh-base → …其它 bundle… → dsh-opencode-doctor
    → ~/.dsh/profiles/<name>/cordis.patch.yml
        → ~/.dsh/cordis.patch.yml
            → --patch 覆盖
```

越靠后优先级越高，所以上面那三条 `insert` 出来的行都是**可覆盖的** —— 你在自己那层再写一次同 id 的行就是覆盖（`model-proxy` 的 `config` 要整块抄，见上文）。

`models.catalog.json` 是探测结果，含每个模型的上下文窗口、输出上限、推理档位、以及归属哪条路由。元数据取自 [models.dev](https://models.dev) 并人工校对。

## 发版流程

安装命令固定到 tag，所以**每次发版都要改 tag 名**，否则 README 指向的还是旧版本：

```bash
# 1. 改 package.json 的 version（0.2.2 → 0.2.3）
# 2. 改 README.md / README.en.md 安装命令里的 tag（#v0.2.2 → #v0.2.3）
# 3. 提交、打 tag、推
git add -A
git commit -m "release: v0.2.3"
git tag -a v0.2.3 -m "v0.2.3 — <一句话>"
git push origin main --follow-tags

# 4. 建 Release（把 tag 和说明带上）
gh release create v0.2.3 --title "v0.2.3 — <一句话>" --notes-file <notes.md>
```

三处必须同时更新，漏一处就会出现「README 说 v0.2.3、装出来是 v0.2.2」。发完用 `npx dsh-opencode-doctor -v` 核对一次。

## 已知限制

- 探测结论**有时效**，见上文。
- 只验证「能不能建立一次对话」，**不验证**长上下文、工具调用、图片输入这些能力。
- 走代理的模型需要你本地有一个 HTTP 代理（Clash Verge / Mihomo / 其它都行），插件不内置代理服务器。
- Zen 网关的 Claude 走 Anthropic Messages 协议，非 Claude 走 OpenAI 协议 —— `probe` 会自动识别并分到正确路由。

## License

MIT
