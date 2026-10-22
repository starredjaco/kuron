# kuron

**An LLM behaves as the whole system. Code only gives it hands and a minimal face.**

*Kūron* (空論) is Japanese for "armchair theory": an idea that only exists on paper. kuron makes such an idea — even one that
would take ~50 hours to build — **appear built within minutes and usable by hand**, so you can judge whether it is worth
building. Nothing is generated per idea: no application code, no grammar to satisfy. An LLM with hands sets the system up
and then *is* the system on every action. Once you have tried it, kuron turns what the system actually did into a
specification and an implementation plan.

```
one line ─▶ setup agent (LLM with hands) ─▶ brief · data · screens · timers · checks · reality estimate
                                                   │
button / timer / camera / sound ─▶ event agent (LLM with hands) ─▶ reads what it needs, changes the world,
                                                   │                speaks, plays, shapes sound, draws
"this should…" ─▶ request agent ─▶ changes its own brief, screens, data, checks
                                                   │
                                   world.json ◀────┘ ─▶ minimal face (website, phone, desktop, IoT, terminal, watch…)
```

See [docs/DESIGN.md](docs/DESIGN.md) for the design and the line the code never crosses.

## The line

| Code contains | Code never contains |
|---|---|
| Generic hands: store and read data, define screens, notify, look (camera), listen (mic), play test sounds, shape sound by bands, speak, draw, timers, checks, reality estimate | Business judgement, word lists, guessing what the LLM meant, exceptions for one idea |
| A shape check on every hand's input, answering in words | Rules that patch a prototype's behaviour |
| A minimal generic renderer and the real-world components | |

When something does not fit, the hand tells the LLM and the LLM corrects itself. When a prototype behaves wrongly, you tell
the LLM how it should behave (the request bar), and it changes itself.

## Any LLM

| Turn | `--preset claude` (default) | `--preset local` |
|---|---|---|
| Setup and requests | `claude-sonnet-5-5` via Claude Code, hands as an MCP server | `qwen3.8:27b-mlx` via Ollama tool calling |
| Events | `claude-haiku-5-5` | `qwen3.5:4b` |

Any MCP client can use the same hands: `kuron hands --url http://127.0.0.1:4870` (e.g. from Codex).

## Requirements

Node.js 20+, [Claude Code](https://claude.com/claude-code) (logged in), and [Ollama](https://ollama.com) only for the local preset.

## Usage

```bash
kuron dev .                       # dev UI at http://127.0.0.1:4870/ — every .kuron idea in the folder; "+ New" from one line
kuron new "a clinic that …"       # write the idea and let the setup agent build it
kuron check idea.kuron            # play the system's checks and judge them
kuron hands --url <host>          # the hands as an MCP server
```

A `.kuron` file is just the idea in words ([docs/IDEAS.md](docs/IDEAS.md)). The dev UI shows the running system, the world
(state), every turn with the hands it used and its cost, checks, requests, the reverse plan, and the brief the LLM wrote for
itself. **Ideal / Existing tech** switches the system to behave like a shippable implementation would (delay, sound leaking
past earphones, late or wrong decisions). Presentation mode (`/present`) is for showing it to others and noting requests.

## Measured (M1 Max, Claude preset)

A clinic system — reception tablet, doctor's PC, stock screen, patient phone, waiting-room display; patients, bookings,
reception, interviews, records, prescriptions, stock, billing; two timers:

| | |
|---|---|
| Setup from the idea | 40 s, 14 hands, about $0.39 |
| One event | 7.7–15.4 s, 1–2 hands, $0.04–0.10 |
| A request ("rewrite your checks") | 16 s |

The world given to the LLM on each turn is an overview (counts, properties, latest items), so turns stay about the same size
as the system grows; the LLM reads more only when it needs to.

## Examples

`examples/` holds ideas from small (a task list) to multi-device (an IoT fridge with a phone app, a reception system),
including real-world ones (earphones that let important sounds through, a camera that directs a remote photographer).

## License

MIT
