# Kuron language (空論語)

Kuron is a programming language whose CPU is a large language model.
A Kuron program is a **design document**: headings and bullets in any human language.
The local LLM compiles it into typed state, screens and instruction lists, and then executes those
instructions every time the user acts. Whatever you can describe — judgement, prediction,
generation, simulation of things that do not exist yet — runs immediately, with no code and no dependencies.

Pipeline: **upstream (Claude Code) writes or revises the program → the local LLM compiles it → the local LLM runs it as the CPU.**

## Structure

Keywords can be written in Japanese, English, Chinese or Korean. Everything else (names, bullets) is free text in any language; the system answers in the language of the program (or the one set with `Language:`).

| Part | Japanese | English | Chinese | Korean |
|---|---|---|---|---|
| Title | `# システム: 名前` | `# System: Name` | `# 系统: 名称` | `# 시스템: 이름` |
| Summary | `説明: …` | `Description: …` | `描述: …` | `설명: …` |
| Form | `形: サイト` | `Form: Website` | `形态: 网站` | `형태: 웹` |
| Language (optional) | `言語: 日本語` | `Language: English` | `语言: 中文` | `언어: 한국어` |
| State | `## 状態` | `## State` | `## 状态` | `## 상태` |
| Screen | `## 画面 名前（形）` | `## Screen Name (form)` | `## 页面 名称（形态）` | `## 화면 이름 (형태)` |
| Actions | `## 動き` + `### 名前` | `## Actions` + `### Name` | `## 动作` + `### 名称` | `## 동작` + `### 이름` |
| Timer | `## 毎 30 秒 名前` | `## Every 30 seconds Name` | `## 每 30 秒 名称` | `## 매 30 초 이름` |
| On start | `## 起動` | `## On start` | `## 启动` | `## 시작` |
| Checks | `## 確かめる` | `## Checks` | `## 验证` | `## 확인` |
| Real world (optional) | `## 実機` | `## Device` | `## 设备` | `## 장치` |

Forms: website / phone / desktop / IoT device / terminal / watch (any other word becomes a generic device panel).
Each screen can choose its own form, so one program can be a whole system: an IoT device, the phone app that watches it and an admin site, sharing one state.

## The real world, without code

A program is meant to be **used**, not watched, and no code is ever written for it. Every program can use the same
general real-world components, and the LLM-CPU does all the judging, analysing and deciding while the program runs:

- **camera** — live camera or a dropped-in test picture; every N seconds the frame goes to an action as an image.
- **mic** — live microphone; every N seconds the sound features (level per band, what is rising, words heard) go to an action.
- **sounds** — test sounds described as data in a list (kind, frequency band, level, timing, envelope, words) and synthesized;
  an action can write that list, so the LLM invents the test situation.
- **output** — the person's earphones or speakers, through bands whose gains an action sets, with a processing on/off switch.
- **speak** — reads a text aloud; **drawing** — shows an SVG picture an action drew.

Just describe the screen in words ("the camera picture, judged every 3 s by 「構図を見る」"). When something is missing, the
compiler adds it itself (fields, screen parts, actions, a test situation) in the program's own words before compiling.

**Ideal vs existing technology.** The compiler also estimates how the idea would behave if built today with existing technology
(delay, sound leaking past earphones, late or wrong judgements, coarse intervals). The dev UI switch *Ideal / Existing tech*
makes the running prototype behave that way, so both can be felt side by side.

An optional `## 実機` / `## Device` section says in words what the real-world side must do; it guides the compiler's additions.

## Writing a good program (rules for upstream authors)

1. **State** — one bullet per field, `name: description`. Name the field before the colon; that exact name is used everywhere.
   For lists of things, list the properties: `- 注文: 品名・数量・状態（受付/発送済み）・お客様の名前 を持つ一覧`.
   Ask for demo data explicitly when the system should start filled: `- 顧客: … の一覧。最初からそれらしい顧客が8社ある`.
2. **Screens** — one bullet per visible part, top to bottom. Name inputs by what the user types ("タスク名と締め切りの入力欄") and buttons by their action name ("「追加」ボタン"). Say what each list shows and how it is filtered or ordered.
3. **Actions** — one `###` per button, one bullet per step. Steps may be ordinary ("選んだ注文を発送済みにする") or impossible-for-normal-code ("中身と締め切りから優先度を決める", "この顧客が来月解約しそうか予測し、理由を一文で書く"). Write them as plainly as you would tell a colleague.
4. **Timers** — `## 毎 N 秒` with steps; use them to simulate the outside world (sensors drifting, orders arriving).
5. **Checks** — one bullet per scenario: what the user does, then what must be true. Make the expectation concrete and visible in the state ("請求書を送るの優先度が本を読むより高い").

## Example

```
# システム: 締め切り番
説明: タスクを入れると、締め切りと中身から今日やるべき順に並べ、やり忘れそうなものを先回りして教えてくれる
形: サイト

## 状態
- タスク: 名前・締め切り・優先度（高/中/低）・済み・ひとこと助言 を持つ一覧
- 今日の方針: 残っているタスク全体を見た、今日の進め方の一文

## 画面 一覧
- 見出し「今日やること」と今日の方針
- タスク名と締め切りの入力欄、「追加」ボタン
- 済みでないタスクを優先度の高い順に表示。各行に名前・締め切り・優先度の印・ひとこと助言・「済み」ボタン

## 動き
### 追加
- 入力された名前と締め切りで新しいタスクを作る
- 中身と締め切りから優先度（高・中・低）を決め、やり忘れを防ぐひとこと助言を書く
- 今日の方針を、残りのタスク全体を見て書き直す
### 済み
- 選んだタスクを済みにする
- 今日の方針を書き直す

## 確かめる
- 「請求書を送る（今日）」と「本を読む（来月）」を追加すると、請求書を送るの優先度が本を読むより高くなる
```

## What the compiler produces

`.kuron/ir.json` — language-neutral IR: `state.fields` + JSON schema + initial value, `screens[].view` (UI components),
`events{}` (reads / writes / inputs / CPU steps), `checks[]` (steps + expectations). Every CPU step's output is
constrained by the state schema, so the running system always keeps a valid shape.

## From Kuron to a real implementation

`kuron reverse` writes `reverse/SPEC.md` (the IR as a specification), `reverse/examples.jsonl` (every action the CPU
actually executed: inputs, state before, state after — golden examples for the real code) and asks upstream to write
`reverse/PLAN.md`: which steps become ordinary code, which need a model or an outside service, the schedule, and the
exact prompts to give an implementation agent step by step.
