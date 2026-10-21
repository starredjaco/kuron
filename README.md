# lucid — 空論語（kuron）

> 明晰夢（lucid dream）のように、意図して見る「動く幻覚」。

**LLM を CPU とするプログラミング言語。** 設計書のように書いたプログラムを、LLM がコンパイルし、LLM が CPU として実行します（既定は Claude Sonnet 5.5 と Haiku 5.5、ローカルモデルにも切り替え可能）。
普通なら作るのに何時間もかかるもの、今の技術では書けない処理（判断・予測・生成・まだ無いものの模擬）も、書いたその場で**手で触って使える形**で動きます。動きを確かめたら、実行記録を正解例にして、本物を作るための仕様・計画・プロンプトまで逆算します。

*A programming language whose CPU is an LLM. A design document is compiled by one LLM and executed by another (Claude Sonnet / Haiku through Claude Code, or local models), so things that would take hours to build — or that ordinary code cannot do — run immediately and can be tried by hand. Then the recorded executions become golden examples for the real implementation plan.*

```
人の指示 ──▶ Claude Code（上流）: プログラムを書く・直す・計画を立てる
              │
              ▼
          app.kuron（設計書の形の空論語。日本語・英語・中国語・韓国語の見出しで書ける）
              │  ローカル LLM = コンパイラ（状態の型・画面・命令列・検証へ）
              ▼
          .kuron/ir.json
              │  ローカル LLM = CPU（操作のたびに命令列を実行。結果は状態の型で縛られる）
              ▼
          動くシステム（サイト・スマホ・IoT・ターミナル… 複数の機器が1つの状態を共有）
              │  触る → 要望 → Claude が直す → 再コンパイル（変わった節だけ）
              ▼
          kuron reverse: SPEC.md + examples.jsonl（実行記録 = 正解例）+ PLAN.md（日程・手順・プロンプト）
```

## 必要なもの / Requirements

- Node.js 20+
- [Claude Code](https://claude.com/claude-code)（`claude` コマンド。ログイン済みであること）
- ローカル構成で動かす場合のみ [Ollama](https://ollama.com) とモデル

## 役割分担 / Roles

| 役割 | `--preset claude`（既定） | `--preset local` |
|---|---|---|
| 上流: 指示の解釈・プログラムを書く/直す・計画 | Claude Code（既定モデル） | Claude Code（既定モデル） |
| コンパイラ: プログラム → 型・画面・命令列 | `claude-sonnet-5-5` | `qwen3.8:27b-mlx` |
| CPU: 操作のたびに命令列を実行 | `claude-haiku-5-5` | `qwen3.5:4b` |

`claude-` で始まるモデルは Claude Code（`claude -p --json-schema`）経由、それ以外は Ollama で動きます。役割ごとに `--compile-model` / `--cpu-model` か `kuron.json`（`{"preset": "local", "cpuModel": "…"}`）で変えられます。
顧客データを外に出せないデモやオフラインでは `--preset local` を使います。

## 使い方 / Usage

```bash
kuron new "冷蔵庫の中身から今夜の献立を決める冷蔵庫と、買い物リストが届くスマホ" -o fridge.kuron
kuron dev fridge.kuron          # http://127.0.0.1:4870/ 開発画面、/present 発表モード
kuron check fridge.kuron        # 検証を LLM-CPU で実行
kuron reverse fridge.kuron      # reverse/fridge/ に SPEC.md・examples.jsonl・PLAN.md
```

開発画面: 左で実際のシステムを操作し、右で **状態 / 実行記録（CPU が実行した命令と変化）/ 検証 / 要望 / 逆算 / ソース** を見ます。
下の欄に「ここをこうしたい」と書いて **Claude に反映させる** を押すと、上流の Claude Code がプログラムを書き直し、ローカル LLM が変わった節だけコンパイルし直します。
**発表モード**（`/present`）は顧客に見せる画面で、右下の「要望をメモ」で、その場の要望を画面の文脈ごと記録できます。

## 言語 / Language

[docs/LANGUAGE.md](docs/LANGUAGE.md) を参照。最小の例:

```
# システム: 締め切り番
説明: タスクを入れると、締め切りと中身から今日やるべき順に並べる
形: サイト

## 状態
- タスク: 名前・締め切り・優先度（高/中/低）・済み を持つ一覧

## 画面 一覧
- タスク名と締め切りの入力欄、「追加」ボタン
- 済みでないタスクを優先度の高い順に表示。各行に「済み」ボタン

## 動き
### 追加
- 入力された名前と締め切りで新しいタスクを作る
- 中身と締め切りから優先度を決める
### 済み
- 選んだタスクを済みにする

## 確かめる
- 「請求書を送る（今日）」と「本を読む（来月）」を追加すると、請求書を送るの優先度が高くなる
```

## 時間の目安（M1 Max 64GB で実測）

**一言から使えるまで: 約 1 分**（Claude 構成。開発画面の「＋ 新しく作る」、または `kuron new` → `kuron compile`）

| 段階 | claude | local |
|---|---|---|
| 上流がプログラムを書く（新規は Sonnet 5.5） | 約 20 秒 | 同左 |
| 初回コンパイル（状態 → 画面 → 一覧・動き・検証を同時に） | 30〜45 秒 | 約 2.5 分 |
| 再コンパイル（画面や動きだけ変えたとき） | 数秒〜20 秒 | 4〜30 秒 |
| CPU 1 回の実行 | 3〜12 秒（生成する量が多いと 30 秒ほど） | 3〜8 秒 |

例: 「来客の受付をして、担当者に知らせ、待ち時間が長い人を教えてくれる受付システム」→ 63 秒、「読んだ本を登録すると、次に読むべき本を3冊すすめてくれる読書記録」→ 54 秒。
Claude 構成の費用は Claude Code の利用枠から消費されます。実行記録に 1 回ごとの見積もりが出ます。

## 開発画面 / Dev UI

`kuron dev <フォルダ>` で、フォルダ内のすべての `.kuron` を上部の一覧から切り替えられます。「＋ 新しく作る」で一言から新しいプログラムを作り、そのまま開きます。
使っている状態は `.kuron/<名前>/state.json` に保存され、再起動しても続きから使えます。「## 毎 N 秒」の動きは開いている間、実際に時間どおり動きます。

## License

MIT
