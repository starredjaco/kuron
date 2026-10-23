# kuron design: an LLM with hands

kuron lets any idea — even one that would take ~50 hours to build — appear built within minutes and be tried by hand.
It does this by **letting an LLM behave as the system**. Code only gives the LLM hands and a minimal face.

## The line we do not cross

| Code may contain | Code must never contain |
|---|---|
| Generic hands that know nothing about any idea: store and read data, define and draw screens, take a picture, listen, play sounds, shape sound by bands, speak, draw, run a timer | Business judgement of any kind |
| A minimal, generic renderer (headings, text, lists, inputs, buttons, a few real-world components) | Word lists or vocabularies (priority orders, yes/no words, units) |
| Strict input schemas for the hands, and the errors they return | Guessing what the LLM meant (unit conversion, keyword matching) |
| Persistence, transport, timing | Exceptions for one idea, or patches that "fix" one prototype's symptom |

When something does not fit, a hand returns a plain error **to the LLM**, and the LLM corrects itself. We never add a rule in
code to cover the mismatch. When a prototype behaves wrongly, the person says how it should behave and the LLM changes itself.

## Shape

```
person ── one line / a request ──▶ ┌──────────────────────────────┐
                                   │  agent (any LLM with tools)  │  Claude Code via MCP, Codex via MCP,
UI event / timer / camera frame ─▶ │  + the system's brief        │  or a local model through Ollama tool calling
                                   └──────────────┬───────────────┘
                                                  │ calls hands
                    ┌─────────────────────────────▼─────────────────────────────┐
                    │ hands (lib/hands.js, also served as an MCP server)         │
                    │  world: overview · query · apply · values                  │
                    │  face:  define_screen · notify                             │
                    │  world-facing: look (camera) · listen (mic) · play_sounds │
                    │                shape_sound (bands) · speak · draw          │
                    │  time:  set_timer      self: write_brief · add_check       │
                    │  reality: set_reality                                       │
                    └─────────────────────────────┬─────────────────────────────┘
                                                  ▼
                       world (lib/world.js): collections of items, values, screens,
                       timers, brief, checks, reality — saved as .kuron/<name>/world.json
                                                  ▼
                       minimal face (ui/): draws screens from the world, sends events
```

There is no compiler and no grammar. A `.kuron` file is just the idea in words (optional).

## The world

- **collections**: named lists of items. Each item is a JSON object with an `id` the hands assign. The LLM chooses the
  properties; nothing is typed in advance.
- **values**: named single values (a summary sentence, the current time, a mode).
- **screens**: what `define_screen` saved. Each has a device form (website, phone, desktop, IoT, terminal, watch, any other
  word) and parts. A screen, once defined, is reused until the LLM redefines it, so the face stays stable.
- **timers**: name, every N seconds, the intent to run.
- **brief**: the system's own description of how it behaves, written by the LLM at setup and updated by requests. It is
  given to the LLM on every turn — this is the "program".
- **checks**: scenarios in words, run later by the agent and judged by an LLM.
- **reality**: the estimate of how an existing-technology implementation would behave (latency, leak, delays, errors).

## Parts of a screen (the minimal face)

heading, text, metric, input, select, button, list, table, badge, chart, image, divider, camera, mic, sounds, output, speak,
drawing. Text may contain `{value name}`, `{count:collection}`, `{count:collection|property=value}`; inside a list row,
`{property}`. A list names its collection and, if wanted, `where` (property = value) and `order` (property plus the values in
display order, or numeric ascending/descending) — **the LLM writes the order, code only applies it**. A button names an
**intent** in plain words ("register this patient", "call the next one"); pressing it sends that intent to the agent with the
inputs on the screen and the row item.

## Turns

1. **Setup (once, ~1–3 min).** Input: the idea. The setup agent writes the brief, creates collections with realistic test
   data, defines minimal screens for each device, sets timers, adds checks and sets the reality estimate — all through hands.
2. **Event (each action).** Input: the intent, the screen, the row item, the inputs, and for live parts the camera picture or
   sound features. The runtime agent reads only what it needs (`query`), changes the world in one `apply`, may speak, play,
   shape sound, draw or notify, and ends. Coarse hands keep this to one or two model round trips.
3. **Request ("this should …").** The setup agent changes the brief, screens or data through the same hands.
4. **Check.** For each scenario, the agent plays it as events, then an LLM judges the result against the world.
5. **Reverse.** Brief + screens + recorded turns → SPEC.md, golden examples, PLAN.md.

## Ideal vs existing technology

Unchanged: the estimate lives in the world; the face adds latency and leakage to sound, and the runtime agent is told to
behave like the shippable implementation (late, coarse, sometimes wrong) while the switch is on.

## Any LLM

- **Claude** (default): `claude -p` with the hands as an MCP server (`--mcp-config`, only `mcp__kuron__*` allowed).
  Setup uses Sonnet, events use Haiku.
- **Codex or any MCP client**: run `kuron hands` (MCP over stdio) against a running `kuron dev`.
- **APIs**: the Anthropic API (`anthropic:<model>`) and any OpenAI-compatible API (`openai:`, `gemini:`, `openrouter:`,
  `groq:`, `lmstudio:<model>`) through their own tool calling, the same hand definitions. `lib/llm.js` picks the provider
  from the model name.
- **Local**: Ollama tool calling, the same hand definitions.
