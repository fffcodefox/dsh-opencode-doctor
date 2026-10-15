# dsh-opencode-doctor

[English](README.en.md) | **中文**

**给 DeepSeek Harness（DSH）装上「已经实测过可用性」的 OpenCode 模型路由。**

哪些模型真能用、哪些被地区封锁或余额不足 —— 装完在选择器里一眼看到，不用一个个试错。

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.18-brightgreen.svg)](package.json)
[![GitHub topic](https://img.shields.io/badge/topic-dsh--plugin-blueviolet.svg)](https://github.com/topics/dsh-plugin)

---

## 解决什么问题

网关的 `/models` 接口告诉你它**能提供**什么，不告诉你你**有权用**什么。

地区封锁、余额不足、只限官方客户端的免费层 —— 这些只有真的发一次请求才会暴露。等你选中模型、写好 prompt、按下回车，才发现它根本跑不了。

这个插件把这件事**提前做完**：83 个模型，每一个都真发过一次请求，结论直接写进模型名。

## 效果

DSH 的模型选择器只渲染模型名（不显示描述字段），所以可用性结论就写在名字里：

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

顺带的好处：选择器自带模糊搜索。

- 输入「**需充值**」→ 筛出余额不足的那组
- 输入「**地区限制**」→ 看看哪些需要挂代理
- 输入「**限官方客户端**」→ 排除只能官方客户端用的免费层

## 安装

**从 GitHub 装（推荐，不依赖 npm）：**

```bash
dsh plugin --profile web add github:fffcodefox/dsh-opencode-doctor
```

**从 npm 装（包已发布后可用）：**

```bash
dsh plugin --profile web add dsh-opencode-doctor
```

装完**重启 dsh**，进 **设置 → 模型**，就能看到下面这些新路由。

> **纯配置插件。** 它的全部行为都在 `cordis.patch.yml` 里，不跑任何运行时代码（`lib/index.mjs` 的 `apply` 是空的，只为符合插件规范）。所以它不会影响 DSH 宿主的稳定性，也不会碰你的其它配置。

## 覆盖范围

路由按**实际能跑通的协议**生成，所以不是每个网关都有三条。下面是发布时的实测结果（探测日期见 `models.catalog.json`）：

| 路由 id | 协议 | 可用 / 总数 | 端点 |
|---|---|---|---|
| `opencode-go-doctor-anthropic` | Anthropic Messages | 2 / 2 | `opencode.ai/inference/go/v1/messages` |
| `opencode-go-doctor-openai` | OpenAI 兼容 | 26 / 33 | `opencode.ai/inference/go/openai/v1` |
| `opencode-go-doctor-responses` | OpenAI Responses | 2 / 2 | `opencode.ai/inference/go/openai/v1` |
| `opencode-zen-doctor-anthropic` | Anthropic Messages | 7 / 7 | `opencode.ai/inference/v1/messages` |
| `opencode-zen-doctor-openai` | OpenAI 兼容 | 8 / 35 | `opencode.ai/inference/v1` |
| `opencode-zen-doctor-responses` | OpenAI Responses | 4 / 4 | `opencode.ai/inference/v1` |

**合计 49 个可用 / 83 个模型**，覆盖 Claude、GPT、Grok、Gemini、DeepSeek、GLM、Qwen、Kimi、MiniMax 等系列。

同一个模型在不同协议下的可用性并不一致 —— 比如 Zen 的 Claude 只认 Anthropic Messages，`grok-4.7` 只认 Responses。`probe` 会逐个协议试，把模型归到它**真正能跑**的那条路由上。

## 标注词汇

| 标注 | 含义 |
|---|---|
| （需充值） | 账户余额不足 |
| （限官方客户端） | 免费层模型，只能在 OpenCode 官方客户端里用 |
| （地区限制） | 你所在的地区不可用，通常需要代理 |
| （需授权训练数据） | 需要先授权用你的数据训练 |
| （协议不兼容） | 网关列出了它，但三种协议都跑不通（多为 Gemini 系） |
| （暂不可用） | 其他失败 |

**没有标注 = 探测时可用。**

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

## CLI

装完之后有个 `dsh-opencode-doctor` 命令（`npx dsh-opencode-doctor` 也行）：

```bash
npx dsh-opencode-doctor list      # 看目录里有什么、哪些被标注（离线）
npx dsh-opencode-doctor check     # 确认凭证能读到、两个网关都通
npx dsh-opencode-doctor probe     # 重新探测，重写 catalog + patch
npx dsh-opencode-doctor render    # 只从 catalog 重新生成 patch（离线）
```

`probe` 会对每个模型真发一次请求，结果写回 `models.catalog.json` 和 `cordis.patch.yml`。日常用不着跑 —— 只有网关更新了模型、或你想重新确认一遍时再跑。

常用参数：`--gateway <slug>` 只测一个网关、`--concurrency <n>` 并发数、`--key <key>` 直接给 key。

## 常见问题

**装完看不到新路由？**
重启 dsh。模型列表在启动时组装，热重载不一定覆盖 provider 注册。

**会和 `dsh-opencode-go` 冲突吗？**
不会。路由 id 带了 `-doctor` 后缀，两个插件可以共存 —— DSH 里同一个路由 id 注册两次会让整个组合加载失败。代价是模型列表里会出现两份（一份带标注、一份不带），按需留一个就好。

**标注会不会过期？**
会。网关改权限、你的余额变化都会让它失效。重跑 `npx dsh-opencode-doctor probe` 即可刷新。

**为什么 Anthropic 路由的 baseURL 不含 `/v1`？**
pi-ai 走 Anthropic SDK，SDK 自己会拼 `/v1/messages`。写成 `.../v1` 会变成 `.../v1/v1/messages` 直接 404。

**为什么 Responses 路由没有「关闭推理」这一档？**
pi-ai 把 `off` 转发成 `reasoning_effort: "none"`，而这条路由上的模型（grok、gpt-codex）不接受 `none`。所以只声明真实可用的档位。

**需要额外装什么吗？**
不需要。DSH 的 `dsh-base` 里已经挂载了 `@deepseek-ai/dsh-llm-pi-ai`（默认零路由），这个插件只是往它上面注册 provider。

## 工作原理

一份 `cordis.patch.yml`，往 `@deepseek-ai/dsh-llm-pi-ai` 注册 6 条 provider 路由。DSH 启动时读 `package.json` 的 `dsh.bundle.patch` 应用它。

因为是纯配置，它不在宿主进程里跑任何代码。

`models.catalog.json` 是探测结果，含每个模型的上下文窗口、输出上限、推理档位。元数据取自 [models.dev](https://models.dev) 并人工校对。

## 已知限制

- 探测结论**有时效**，见上文。
- 只验证「能不能建立一次对话」，**不验证**长上下文、工具调用、图片输入这些能力。
- Zen 网关的 Claude 走 Anthropic Messages 协议，非 Claude 走 OpenAI 协议 —— `probe` 会自动识别并分到正确路由。

## License

MIT
