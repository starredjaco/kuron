<div align="center">

# kuron

**不让 Claude 写应用代码，而是让 Claude 直接扮演整个应用。**<br>
写下一个想法，几分钟内就能亲手试用；觉得满意，再生成真正开发所需的计划和提示词。

[![GitHub stars](https://img.shields.io/github/stars/Ag3497120/kuron?style=for-the-badge)](https://github.com/Ag3497120/kuron/stargazers)
[![MIT License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](LICENSE)
[![在浏览器中试用](https://img.shields.io/badge/%E5%9C%A8%E6%B5%8F%E8%A7%88%E5%99%A8%E4%B8%AD-%E8%AF%95%E7%94%A8-6750a4?style=for-the-badge)](https://claude.ai/artifact/UMMbf2FcV3ULi6d5WaW1yp)

[English](README.md) · [日本語](README.ja.md) · **中文**

[![同时粘贴六个应用想法：温室、餐车、火星基地、耳机、山火监控、仓库机器人，每一个都作为完整系统运行](https://kuron.pages.dev/demo-en.gif)](https://kuron.pages.dev/demo-en.mp4)

*同时粘贴六个想法，每一个都作为完整系统运行。▶ [观看 2 分钟视频](https://kuron.pages.dev/demo-en.mp4)*

### [▶ 在浏览器中打开 kuron](https://claude.ai/artifact/UMMbf2FcV3ULi6d5WaW1yp)

无需安装，使用你自己的 claude.ai 账号运行。

</div>

---

## 为什么做这个

我是一名学生，也是独立开发者。有了 AI，做出能运行的原型已经比手写快了很多倍。但只靠脑子或计划书去想象各种想法和市场需求，对个人来说很难。
原型图（mockup）帮助不大：界面很容易做，真正决定一个想法是否有用的，是界面背后的行为。

所以 kuron 把顺序倒过来：**先用真正能运行的东西试一试，再去开发。** 名字来自日语「空論」（kūron），意思是“纸上谈兵”。

## 怎么用

1. **写下想法**：用自然语言写，任何语言都可以。一句话就够，写一页也行。
2. **亲手试用**：Claude 为每个设备或角色准备最简单的界面，然后扮演通常最费时间的部分：后端、数据以及界面之间的连接。
   每按一次按钮，都由扮演系统的 Claude 处理。不生成任何应用代码。
3. **反推开发计划**：满意之后，kuron 会根据系统实际的行为写出规格说明、开发排期，以及交给编程智能体（coding agent）的提示词。

## 功能

- **多设备共享同一个状态**：前台平板、医生电脑、患者手机、候诊室显示屏看到的是同一份数据，一次操作会同步到所有界面。
- **用一句话修改**：比如“显示每位患者紧急程度的理由”，Claude 会改写自己的界面和行为。
- **“现有技术”开关**：用 AI 时，任何想法看起来都很容易实现。所以 Claude 会对每个操作估算：如果用今天的技术真正做出来，需要普通代码、
  AI 模型、外部服务，还是目前做不到；出错的频率和延迟是多少。打开开关后，原型就按这个估算来运行。
- **检查**：在系统副本上运行“有人使用系统”的场景并判定结果。
- **反推**：输出规格、黄金示例、开发计划和提示词。
- **现实世界组件**：测试声音、耳机的声音处理、语音朗读、绘图、图片。

**不适合**：生产环境（每次操作需要几秒和几美分，结果也会略有不同）、像素级的 UI 设计、游戏等需要即时反应的场景、大量且精确的数据处理。
- **不只是表单。** 想法长什么样由 AI 决定：普通部件、AI 自己用 HTML 和 CSS 写的页面、可以点击、拖动或用按键操作的图，
  以及舞台（AI 声明物体和反射规则，由设备逐帧运行，只把有意义的事——过关、需要判断的姿势——告诉 AI）。
- **预演**（默认关闭）。没人操作时，AI 在世界的副本上先演出接下来可以按的东西；准备好的结果按下即生效。会多用一些 AI。

## 在本地运行

```bash
npx github:Ag3497120/kuron try
```

会把示例复制到 `./kuron-examples` 并打开 http://127.0.0.1:4870/。需要 Node.js 20 以上，以及以下之一：已登录的
[Claude Code](https://claude.com/claude-code)、下表中任一服务的 API 密钥，或 [Ollama](https://ollama.com)。

| 模型名 | 运行在 | 需要 |
|---|---|---|
| `claude-…`（默认） | Claude Code（`claude -p`，工具作为 MCP 服务器提供） | 已登录的 Claude Code |
| `codex:<model>` | Codex CLI（`codex exec`，工具以 MCP 服务器的形式提供） | 已登录的 Codex CLI |
| `anthropic:<model>` | Anthropic API | `ANTHROPIC_API_KEY` |
| `openai:<model>` | OpenAI，或通过 `KURON_OPENAI_BASE_URL` 指定的兼容服务器 | `OPENAI_API_KEY` |
| `gemini:` · `openrouter:` · `groq:<model>` | 各服务的 OpenAI 兼容 API | `GEMINI_API_KEY` · `OPENROUTER_API_KEY` · `GROQ_API_KEY` |
| `lmstudio:<model>` | 本机的 LM Studio | 无 |
| 其他名称 | 本机的 Ollama | Ollama |

在开发界面中，点击顶栏的模型名称即可打开设置：准备用的模型和按钮操作用的模型都可以在运行中切换为上面任意一种。

## 规则

代码里只有通用的工具（数据的存取、界面定义、通知、声音、朗读、绘图、定时器、检查、估算）、对每次工具调用做格式检查并用文字回复的机制，
以及最简单的渲染器。代码里绝不写业务判断、词表、对 AI 意图的猜测，或针对某个想法的特殊处理。原型行为不对时，告诉 AI 它应该怎么做即可。

## 分享你的想法

kuron 还需要更多想法来测试，尤其是能让它出错的想法。欢迎以 `examples/<名称>.kuron` 的形式提交 Pull Request，或在 Issue 里写下哪些可行、
哪些出了问题。详见 [CONTRIBUTING.md](CONTRIBUTING.md)（英文）。

## 许可证

MIT
