# dsh-opencode-doctor

[English](README.en.md) | 中文

给 DeepSeek Harness 装上**已经探测过可用性**的 OpenCode 模型路由。

网关的 `/models` 接口列的是它**能提供**什么，不是你**有权用**什么。地区封锁、余额不足、只限官方客户端的免费层——这些只有真的发一次请求才会暴露。这个包把这件事提前做完了：每个模型都真发过一次请求，结论写进模型名里。

## 效果

DSH 的模型选择器**只渲染模型名**（不显示描述），所以可用性结论直接写进名字：

```
Claude Opus 5.5
GPT-6 Luna（地区限制）
Claude Fable 5（需充值）
Cat Jam Free（限官方客户端）
```

顺带的好处：选择器自带模糊搜索，输入「需充值」就能筛出整组。

## 安装

```bash
dsh plugin --profile web add dsh-opencode-doctor
```

装完**重启 dsh**，进 **设置 → 模型** 就能看到新路由。

## 注册了什么

路由是**按实际能跑通的协议**生成的，所以不是每个网关都有三条。下面是发布时的实测结果（`probe` 日期见 `models.catalog.json`）：

| 路由 id | 协议 | 可用 / 总数 | 端点 |
|---|---|---|---|
| `opencode-go-doctor-anthropic` | Anthropic Messages | 2 / 2 | `opencode.ai/inference/go/v1/messages` |
| `opencode-go-doctor-openai` | OpenAI 兼容 | 26 / 33 | `opencode.ai/inference/go/openai/v1` |
| `opencode-go-doctor-responses` | OpenAI Responses | 2 / 2 | `opencode.ai/inference/go/openai/v1` |
| `opencode-zen-doctor-anthropic` | Anthropic Messages | 7 / 7 | `opencode.ai/inference/v1/messages` |
| `opencode-zen-doctor-openai` | OpenAI 兼容 | 13 / 35 | `opencode.ai/inference/v1` |
| `opencode-zen-doctor-responses` | OpenAI Responses | 4 / 4 | `opencode.ai/inference/v1` |

合计 **54 个可用 / 83 个模型**。

同一个模型在不同协议下的可用性并不一致——比如 Zen 的 Claude 只认 Anthropic Messages，`grok-4.7` 只认 Responses。`probe` 会逐个协议试，把模型归到它真正能跑的那条路由上。

> **路由名为什么带 `-doctor`？** 因为 `dsh-opencode-go` 占用了 `opencode-go`。DSH 里同一个路由 id 注册两次会让整个组合加载失败，加后缀后两个插件可以共存。代价是模型列表里会同时出现两份（一份带标注、一份不带）——按需留一个就好。

> **Anthropic 路由的 baseURL 为什么不含 `/v1`？** pi-ai 走 Anthropic SDK，SDK 自己会拼 `/v1/messages`。写成 `.../v1` 会变成 `.../v1/v1/messages` 直接 404。这是踩过的坑。

> **Responses 路由为什么不提供「关闭」档？** pi-ai 把 `off` 转发成 `reasoning_effort: "none"`，而这条路由上的模型（grok、gpt-codex）不接受 `none`。所以只声明真实可用的档位。

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

已经装过 `dsh-opencode-go` 的话，key 名是同一个，不用重复配。

## CLI

装完之后有个 `dsh-opencode-doctor` 命令（`npx dsh-opencode-doctor` 也行）：

```bash
npx dsh-opencode-doctor list      # 看目录里有什么、哪些被标注（离线）
npx dsh-opencode-doctor check     # 确认凭证能读到、三个网关都通
npx dsh-opencode-doctor probe     # 重新探测，重写 catalog + patch
npx dsh-opencode-doctor render    # 只从 catalog 重新生成 patch（离线）
```

`probe` 会对每个模型真发一次请求，结果写回 `models.catalog.json` 和 `cordis.patch.yml`。日常用不着跑——只有网关更新了模型、或者你想重新确认一遍时再跑。

常用参数：`--gateway <slug>` 只测一个、`--concurrency <n>` 并发数、`--key <key>` 直接给 key。

## 标注词汇

| 标注 | 含义 |
|---|---|
| （需充值） | 账户余额不足 |
| （限官方客户端） | 免费层模型，只能在 OpenCode 客户端里用 |
| （地区限制） | 你所在的地区不可用 |
| （需授权训练数据） | 需要先授权用你的数据训练 |
| （暂不可用） | 其他失败 |

没有标注 = 探测时可用。

## 数据来源

`models.catalog.json` 是探测结果，包含每个模型的上下文窗口、输出上限、推理档位。上下文窗口等元数据取自 [models.dev](https://models.dev) 并人工校对过。

## 工作原理

这个包是**纯配置插件**——没有运行时代码，只有一份 `cordis.patch.yml`，往 `@deepseek-ai/dsh-llm-pi-ai`（dsh-base 里已挂载、默认零路由）注册 provider。DSH 启动时读 `package.json` 的 `dsh.bundle.patch` 应用它。

因为是纯配置，它不会在宿主进程里跑任何代码，也不碰你的其它配置。

## 已知限制

- 探测结论**有时效**。网关改权限、你的余额变化都会让它过期，重新跑 `probe` 即可。
- 探测只验证「能不能建立一次对话」，不验证长上下文、工具调用、图片输入这些能力。
- Zen 网关的 Claude 模型走 Anthropic Messages 协议，非 Claude 走 OpenAI 协议——`probe` 会自动识别并分到正确路由。

## License

MIT
