# PLAN.md — 締め切り番 実装計画

## 1. 概要

### システムとは
「締め切り番」は、タスク名と締め切りを入れるだけで、

- 優先度（高・中・低）とその理由を一文で付け、
- やり忘れを防ぐ「ひとこと助言」を添え、
- 残タスク全体を見た「今日の方針」を一文で示す

個人用タスク整理ツールである。画面は一枚（一覧）、動きは「追加」と「済み」の二つ。

### プロトタイプが証明したこと
- **締め切りの近さから優先度を正しく序列化できる。** 「請求書を送る（今日）」→高、「本を読む（来月）」→中、「レポート作成（明日）」→高。確かめる項目1は成立した。
- **理由・助言は、タスク名と締め切りだけから自然な日本語の一文として生成できる。** 「数字の整合性と、先月の報告書との比較だけ先に確認しておくと安心です」のように、タスクの中身に踏み込んだ助言が出ている。
- **「今日の方針」は、複数タスクの締め切り・優先度を踏まえた一文に書き直せる**（済みの例1）。

### プロトタイプが露呈した問題（本実装で直す）
| 問題 | 観測箇所 | 対処 |
|---|---|---|
| 「追加」で今日の方針が更新されない（4例すべて `""` のまま） | 追加の全ゴールデン例 | 方針生成を独立したステップ・独立したLLM呼び出しにし、コードで必ず実行する |
| 「済み」で対象タスクが複製された | 済みの例2（1件→2件に増殖） | タスクにIDを持たせ、済みフラグの更新はコードで行う。LLMに一覧全体を書き換えさせない |
| 「済みのタスクの数」が全件数を表示している | 画面定義 `{count:タスク}` | `done = true` を数える |
| 済みでないタスクを優先度順に並べる指示が画面に反映されていない | 画面定義 | 表示時のフィルタ・ソートをコードで実装 |
| 1アクション 2.7〜5.0秒 | 全例の `ms` | 決定的処理は即時反映し、LLM生成は非同期で後から埋める |

## 2. 動きのステップ分類

凡例: **コード** = 通常のコード / **モデル** = 学習済みモデル・LLMが必要 / **外部** = 外部サービス・データ / **LLM維持** = LLMに残す

### 追加

| # | ステップ | 分類 | 理由 |
|---|---|---|---|
| 1 | 入力の「タスク名」「締め切り」を新タスクに設定 | **コード** | 単純な代入。ID・作成日時の付与もここで行う |
| 2a | 締め切り文字列の解釈（「今日」「明日」「来月」「2024-05-20 17:00」→日時） | **コード**（+ **外部**: システム時刻 / Asia/Tokyo） | 相対表現は有限で辞書化できる。LLMに任せると再現性がなく、確かめる項目1の序列が揺れる |
| 2b | 締め切りの近さから優先度の基準値を決める | **コード** | ルール（当日・翌日=高、1週間以内=中、それ以降=低）で全ゴールデン例を再現できる |
| 2c | タスクの中身（名前）から優先度を補正する | **LLM維持**（ローカル小型、構造化出力、省略可） | 「請求書」「役員会」など内容依存の判断はルール化しにくい。ただし補正は±1段階に制限し、締め切り由来の序列を壊さない。失敗時はルール値のまま |
| 3 | 優先度の理由を一文で書く | **LLM維持**（文章生成） | 自然な日本語の一文はテンプレートでは痩せる。失敗時はテンプレート（「{締め切り}が締め切りのため、優先度を{優先度}にしました。」）にフォールバック |
| 4 | ひとこと助言を書く | **LLM維持**（文章生成） | 中身に即した助言はLLMの価値そのもの。失敗時は締め切りベースの定型助言 |
| 5 | 済み = false | **コード** | 定数 |
| 6 | 一覧に追加 | **コード** | DBへのINSERT |
| 7 | 今日の方針を書き直す | **LLM維持**（要約生成） | 未完了タスク全体を読む要約。入力は未完了タスクの名前・締め切り・優先度のみに絞って渡す。失敗時は「まず『{最優先タスク名}』から着手しましょう。」 |

### 済み

| # | ステップ | 分類 | 理由 |
|---|---|---|---|
| 1 | 対象タスクの済みを true に | **コード** | IDで一意に特定してUPDATE。プロトタイプの複製バグはここをLLMに任せたことが原因 |
| 2 | 残タスクを見て今日の方針を書き直す | **LLM維持** | 追加のステップ7と同じ関数を再利用。残タスクが0件なら「今日のタスクはすべて完了です。」をコードで返し、LLMを呼ばない |

### 画面（動きではないが実装が必要）

| 要素 | 分類 | 内容 |
|---|---|---|
| 一覧の表示順 | **コード** | 済み=false のみ、優先度 高→中→低、同順位は締め切り日時の早い順、不明日時は末尾 |
| 済みの数 | **コード** | `count(done = true)` |
| 優先度バッジ | **コード** | 高=赤、中=黄、低=灰 |

外部サービスは不要。必要な外部データはシステム時刻のみ。

## 3. アーキテクチャとデータモデル

### 構成
```
ブラウザ (ui/, 素のHTML+JS)
   │ fetch /api/*
Node.js HTTPサーバー (lib/server と同系の薄いサーバー)
   ├─ actions/add.js, actions/done.js   … 決定的処理（同期）
   ├─ deadline.js                      … 締め切りパーサー + 優先度ルール
   ├─ enrich.js                        … LLM呼び出し（理由・助言・方針）+ フォールバック
   └─ store.js                         … SQLite (better-sqlite3)
Ollama (ローカルLLM, JSON Schema 構造化出力, timeout 8s)
```

### 処理の流れ（追加）
1. リクエスト受信 → 締め切り解釈 → ルール優先度 → INSERT（理由・助言は仮テンプレート、`enrich_status = 'pending'`）→ 即レスポンス。
2. バックグラウンドで LLM を1回呼び、`{優先度補正, 優先度の理由, ひとこと助言}` を取得して UPDATE。
3. 続けて方針生成 LLM を1回呼び `policy` を UPDATE。
4. フロントは2秒間隔ポーリング（または SSE）で `pending` のタスクを差し替える。

### データモデル（SQLite）

```sql
CREATE TABLE tasks (
  id              TEXT PRIMARY KEY,          -- uuid
  name            TEXT NOT NULL,             -- 名前
  deadline_raw    TEXT NOT NULL,             -- 締め切り（入力そのまま）
  deadline_at     TEXT,                      -- 解釈した日時 ISO8601 / 解釈不能は NULL
  priority        TEXT NOT NULL CHECK (priority IN ('高','中','低')),
  priority_reason TEXT NOT NULL DEFAULT '',  -- 優先度の理由
  advice          TEXT NOT NULL DEFAULT '',  -- ひとこと助言
  done            INTEGER NOT NULL DEFAULT 0,-- 済み
  enrich_status   TEXT NOT NULL DEFAULT 'pending', -- pending | done | fallback
  created_at      TEXT NOT NULL,
  done_at         TEXT
);

CREATE TABLE policy (
  id          INTEGER PRIMARY KEY CHECK (id = 1), -- 1行のみ
  text        TEXT NOT NULL DEFAULT '',           -- 今日の方針
  updated_at  TEXT NOT NULL
);
```

### 型（TypeScript 相当）
```ts
type Priority = '高' | '中' | '低';
interface Task {
  id: string; name: string; deadlineRaw: string; deadlineAt: string | null;
  priority: Priority; priorityReason: string; advice: string;
  done: boolean; enrichStatus: 'pending' | 'done' | 'fallback';
  createdAt: string; doneAt: string | null;
}
interface State { tasks: Task[]; policy: string; }   // 画面に返す形。仕様の State と対応
```

### API
| メソッド | パス | 入力 | 出力 |
|---|---|---|---|
| GET | `/api/state` | - | `State`（未完了を優先度順に並べ済み、`doneCount` 付き） |
| POST | `/api/tasks` | `{ name, deadline }` | 追加された `Task` |
| POST | `/api/tasks/:id/done` | - | 更新後の `Task` と `policy` |

### LLM 契約（構造化出力）
- `enrichTask(name, deadlineRaw, deadlineAt, rulePriority, today)` → `{ priority: Priority, priority_reason: string, advice: string }`。`priority` は `rulePriority` から1段階以内しか動かせない（コードで検証・クランプ）。
- `writePolicy(openTasks[], today)` → `{ policy: string }`。
- 文の検証（コード側）: 空でない、1文（句点「。」「！」「？」が末尾に1つ、途中にない）、80文字以内。違反時は1回だけ再試行、再度違反ならフォールバック。

## 4. スケジュール（リスクの高い順）

| 順 | 作業項目 | 見積 | リスクと理由 |
|---|---|---|---|
| W1 | 締め切りパーサーと優先度ルール（`deadline.js`） | 6h | 確かめる項目1の序列がここに依存。日本語相対表現の網羅と境界（「来週」「月末」「今週中」「5/20」「2024-05-20 17:00」）が難所 |
| W2 | LLM生成層（`enrich.js`）: 構造化出力・検証・再試行・フォールバック・タイムアウト | 8h | 出力品質とJSON崩れ。方針が空のまま残るプロトタイプの欠陥を確実に潰す |
| W3 | データモデルと永続化（`store.js`）、マイグレーション | 4h | 低。ただしIDの導入が済みの複製バグ解消の前提 |
| W4 | アクション実装（追加・済み）と API、非同期エンリッチ | 5h | 同期部と非同期部の整合（pending 状態の扱い） |
| W5 | 画面（一覧・ソート・バッジ・済み数・pending表示） | 5h | 低 |
| W6 | テスト（確かめる項目・ゴールデン例・LLMモック） | 5h | LLM部分をモック化して決定的に流す仕組み |
| W7 | 実LLMでの品質評価と調整（プロンプト調整、遅延計測） | 4h | ローカルモデル依存。ゴールデン例を基準に人手確認 |
| | **合計** | **37h** | |

## 5. 実装エージェント向けプロンプト

共通の前置き（各プロンプトの先頭に付ける）:
> 参照: `reverse/締め切り番/SPEC.md`（仕様）、`reverse/締め切り番/examples.jsonl`（ゴールデン例）、本 `PLAN.md`。Node.js、依存は `better-sqlite3` のみ追加可。プロンプトやコメントは日本語で書く。

### W1 締め切りパーサーと優先度ルール
```
SPEC.md と PLAN.md 第3章を読み、`lib/deadline.js` を実装してください。

1. `parseDeadline(raw: string, now: Date, tz = 'Asia/Tokyo'): { at: Date | null, kind: 'exact'|'relative'|'unknown' }`
   対応する表現: 「今日」「本日」「明日」「明後日」「今週中」「週末」「来週」「来月」「月末」「年内」、
   「M/D」「M月D日」「YYYY-MM-DD」「YYYY-MM-DD HH:mm」「YYYY/MM/DD」。全角数字も受ける。
   時刻のない相対表現は当日 23:59 とする。解釈できないときは null を返す。
2. `rulePriority(at: Date | null, now: Date): '高'|'中'|'低'`
   - at が now から 48 時間以内（過ぎているものも含む）→ 高
   - 7 日以内 → 中
   - それ以降 → 低
   - null（不明）→ 中
3. `comparePriority(a, b)`: 高 > 中 > 低 の比較関数。
4. `sortOpenTasks(tasks)`: done=false を抽出し、優先度の高い順、同順位は deadlineAt 昇順（null は末尾）。

テスト `test/deadline.test.js`（node:test）:
- examples.jsonl の入力「今日」「明日」「来月」「2024-05-20 17:00」「2024-05-21 12:00」「2024-05-25 18:00」を
  now = 2024-05-20T09:00+09:00 として解釈し、優先度がそれぞれ 高・高・低・高・高・低 になること。
  （ゴールデン例の「来月」=中、「2024-05-21 12:00」=中 はLLMの補正結果であり、ルール値はこれで良い）
- 「請求書を送る（今日）」のルール優先度が「本を読む（来月）」より厳密に高いこと。
- 不明な文字列 "いつか" が null / 中 になること。
```

### W2 LLM生成層
```
PLAN.md 第3章「LLM 契約」に従い `lib/enrich.js` を実装してください。Ollama の /api/chat を
format に JSON Schema を渡して呼び、`OLLAMA_MODEL` 環境変数でモデルを選べるようにします。

1. `enrichTask({ name, deadlineRaw, deadlineAt, rulePriority, today })`
   → `{ priority, priorityReason, advice }`
   - プロンプトには examples.jsonl の「追加」4例のうち 2 例を few-shot として埋め込む。
   - 返った priority が rulePriority から 2 段階以上離れていたら rulePriority 側に 1 段階だけ寄せる。
2. `writePolicy({ openTasks: [{name, deadlineRaw, priority}], today })` → `{ policy }`
   - openTasks が空なら LLM を呼ばず「今日のタスクはすべて完了です。」を返す。
   - few-shot には examples.jsonl の「済み」例1（4タスク→方針一文）を使う。
3. 文の検証 `isOneSentence(s)`: 空でない、80 文字以内、末尾が「。」「！」「？」のいずれか 1 つ、
   途中に句点がない。違反時は 1 回だけ再生成し、それでも違反ならフォールバック文を返し
   `fallback: true` を付ける。
4. タイムアウト 8 秒、Ollama 不達時もフォールバックで必ず解決する（例外を上に投げない）。
5. フォールバック文:
   - 理由: 「締め切りが{deadlineRaw}のため、優先度を{priority}にしました。」
   - 助言: 高「今日のうちに着手し、終わったら済みを押しましょう。」/ 中「今週中に一度手を付けておきましょう。」/ 低「カレンダーに締め切りを登録しておきましょう。」
   - 方針: 「まず『{最優先タスク名}』から着手しましょう。」

テスト `test/enrich.test.js`: Ollama を fetch のモックで置き換え、(a) 正常JSON、(b) 2文を返す、
(c) タイムアウト、の 3 ケースで契約どおりの戻り値になることを確認する。
```

### W3 データモデルと永続化
```
PLAN.md 第3章の SQL をそのまま使い、`lib/store.js` を better-sqlite3 で実装してください。

- `openStore(path)`: ファイルがなければテーブルを作成し、policy に id=1 の空行を入れる。
- `insertTask(task)`, `getTask(id)`, `updateTask(id, patch)`, `listTasks()`, `getPolicy()`, `setPolicy(text)`.
- `toState()`: SPEC.md の State 形（キーは「タスク」「今日の方針」、各タスクのキーは
  名前・締め切り・優先度・優先度の理由・済み・ひとこと助言）に変換し、加えて `id` と
  `enrichStatus` を持たせる。締め切りは deadline_raw を返す。
- すべて同期API。`:memory:` パスでテスト可能にする。

テスト `test/store.test.js`: 挿入→更新→一覧、済みを true にしても件数が増えないこと
（examples.jsonl「済み」例2 の複製が起きないことを明示的に確認）。
```

### W4 アクション実装と API
```
`lib/actions.js` と `lib/api.js` を実装し、SPEC.md の「追加」「済み」を次の分担で再現してください。

追加 `addTask({ name, deadline }, deps)`:
  1. 入力検証（name 空は 400）。
  2. deadline.js で解釈とルール優先度。
  3. store に INSERT（理由・助言はフォールバック文、enrich_status='pending'）し、即座にタスクを返す。
  4. 非同期で enrich.enrichTask → updateTask、続けて writePolicy → setPolicy、enrich_status='done' か 'fallback'。
     ここは await せずに `queueMicrotask`/Promise で流し、エラーは必ず捕まえてログに出す。
済み `markDone(id, deps)`:
  1. store.updateTask(id, { done: true, doneAt: now })。存在しなければ 404。
  2. 残タスクで writePolicy → setPolicy。残 0 件なら LLM を呼ばない。
  3. 更新後のタスクと方針を返す。

API: GET /api/state、POST /api/tasks、POST /api/tasks/:id/done。GET /api/state は
sortOpenTasks で並べた未完了一覧、済み一覧、doneCount、policy を返す。

テスト `test/actions.test.js`: enrich をモックして
- 「請求書を送る（今日）」「本を読む（来月）」を追加し、前者の優先度が後者より高い。
- 追加直後に理由が空でなく 1 文である（フォールバック文でも満たす）。
- 追加→済みで done=true、件数は 1 のまま、policy が済み前と異なる文字列になっている。
```

### W5 画面
```
`ui/` に依存なしの HTML+JS で SPEC.md の画面「一覧」を実装してください。

- 見出し「今日やること」、その下に今日の方針（空なら「タスクを追加すると方針が表示されます」）。
- タスク名・締め切りの入力欄と「追加」ボタン。Enter でも追加。追加後は入力欄を空に。
- 未完了タスクを GET /api/state の順序どおりに表示。各行に 名前・締め切り・優先度バッジ
  （高=赤、中=黄、低=灰）・優先度の理由・ひとこと助言・「済み」ボタン。
- enrichStatus が 'pending' の行は理由・助言を薄い色で表示し、2 秒間隔で /api/state を再取得して
  'pending' が消えるまで差し替える。pending が無くなったらポーリングを止める。
- 下部に「済みのタスクの数: N」。N は done=true の数。
- 400px 幅でも崩れないこと。
```

### W6 テスト整備
```
PLAN.md 第6章「受け入れ」に列挙したテストをすべて `test/` に実装し、`npm test` で
Ollama なしに通るようにしてください。LLM は `test/fakeEnrich.js` で置き換え、examples.jsonl の
after 側の文（優先度の理由・ひとこと助言・今日の方針）をそのまま返す決定的な実装にします。
さらに `npm run test:live` を用意し、OLLAMA_MODEL が設定されているときだけ実 LLM で
第6章の「生成文の性質テスト」を実行するようにしてください。
```

### W7 実LLM評価
```
`scripts/eval.js` を書き、examples.jsonl の各 before/inputs を実 LLM に通し、
(1) 優先度がゴールデンと一致した割合、(2) 理由・助言・方針が isOneSentence を通った割合、
(3) 各アクションの所要 ms の中央値、を表で出力してください。目標は (1) 100%、(2) 95% 以上、
(3) 同期レスポンス 300ms 未満・非同期エンリッチ完了 6 秒未満。
未達なら enrich.js のプロンプト（few-shot の選び方、文長の指示）を調整し、結果を README に記録する。
```

## 6. 受け入れ条件（テスト）

### 6.1 「確かめる」項目の翻訳（モックLLM、決定的）

| 元の項目 | テスト |
|---|---|
| 請求書（今日）と本（来月）を追加すると請求書の優先度が高い | `addTask('請求書を送る（今日）','今日')`, `addTask('本を読む（来月）','来月')` → state のタスクが 2 件、`comparePriority(請求書.優先度, 本.優先度) > 0`。実LLMでも必ず成立（補正の1段階制限により、高 vs 低 は最悪でも 中 vs 中 にならないことをユニットテストで保証: ルール差が 2 段階なら補正後も差 ≥ 1） |
| 追加したタスクの理由が空でない一文 | `addTask('レポート作成','明日')` → `isOneSentence(優先度の理由) === true`。pending 時のフォールバック文、enrich 後の文の両方で検証 |
| 追加して済みにすると済みになる | `addTask` → `markDone(id)` → `済み === true`、件数 1、`今日の方針` が済み前と異なる非空文字列 |

### 6.2 ゴールデン例からの回帰テスト

- **追加 例1〜4**: 入力を与え、after のタスク件数・名前・締め切り・済み=false・優先度（高/中/高/高）がコードのルール+モック補正で再現されること。例2「本を読む（来月）」はルール値 低、ゴールデンは 中。モック補正で 中 を返し、クランプが通ることを確認する。
- **追加の全例に対し `今日の方針` が空でない**（プロトタイプの欠陥を回帰防止として固定）。
- **済み 例1**: 4 タスクの before を投入し index 0 相当の id を済みに → 件数 4 のまま、対象のみ done=true、他 3 件は変更なし、方針が書き換わる。
- **済み 例2**: 1 タスクを済みに → 件数が **1 のまま**（複製禁止）。

### 6.3 決定的部品のユニットテスト
- `parseDeadline`: 第5章 W1 の表現一覧すべてに期待日時。境界: 48 時間ちょうど、7 日ちょうど、過去日。
- `sortOpenTasks`: 高→中→低、同順位は締め切り昇順、null 末尾、done は除外。
- 済みの数 = done=true の件数（全件数ではない）。

### 6.4 生成文の性質テスト（実LLM、`test:live`）
- 理由・助言・方針のそれぞれが `isOneSentence` を通る割合 ≥ 95%（10 回繰り返し）。
- 方針が未完了タスクのうち最優先タスクの名前を含む割合 ≥ 80%。
- 残タスク 0 件のとき方針が固定文「今日のタスクはすべて完了です。」であり、LLM が呼ばれない。
- Ollama を停止した状態で追加・済みが両方とも成功し、`enrichStatus = 'fallback'` になる。

### 6.5 非機能
- POST /api/tasks の同期レスポンス 300ms 未満（ローカル）。
- エンリッチ完了まで 6 秒未満（ゴールデンの 2.7〜5.0 秒と同等以下）。
- サーバー再起動後もタスクと方針が残る（SQLite ファイル永続化）。
