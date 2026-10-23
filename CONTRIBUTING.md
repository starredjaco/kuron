# Contributing to kuron

The most useful thing you can bring is **an idea and what happened when you tried it**. kuron is only as good as the
range of ideas it has been tested on, and there are never enough.

## Add an idea (no code needed)

1. Fork the repository.
2. Write your idea in plain words as `examples/<short-name>.kuron` — one line is enough, a page is fine
   ([docs/IDEAS.md](docs/IDEAS.md)). Any language works.
3. Try it: `node bin/kuron.js dev examples`, or paste it into the [browser version](https://claude.ai/artifact/UMMbf2FcV3ULi6d5WaW1yp).
4. Open a pull request. In the description, say what worked and what broke (which button, what Claude replied, what you
   expected). Ideas that break kuron are especially welcome.

Good ideas to try are the ones where the value is a judgement (triage, recommendations, re-planning), where several
roles or devices share one situation, or where the technology does not exist yet.

## Report a result or a problem

Open an issue with the **Idea or result** or **Problem** template. The browser version has a Feedback button that opens
the same forms and can copy your idea and the last runs for you.

## Change the code

Read [docs/DESIGN.md](docs/DESIGN.md) first. The one rule:

| Code may contain | Code never contains |
|---|---|
| Generic hands (tools), a shape check on every hand's input that answers in words, a minimal renderer, transport | Business judgement, word lists, guessing what the LLM meant, exceptions for one idea |

When a prototype behaves wrongly, the fix is a better instruction to the LLM (a request, or a clearer hand description),
not an `if` in the platform. A pull request that patches one idea's symptom in code will be asked to move the fix to
the LLM.

Useful places to start:

- `lib/hands.js` — the hands and their shape checks
- `lib/agent.js` — one LLM turn (Claude Code + MCP, Anthropic API, OpenAI-compatible APIs, Ollama)
- `ui/`, `web/face.js` — the minimal face
- `web/` — the browser version; build it with `node tools/build-web.mjs`

There are no dependencies and no build step for the CLI. Node.js 20+.
