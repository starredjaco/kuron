# kuron — notes for Claude Code (the upstream)

In this repository Claude Code is the **upstream**: it turns a person's words into Kuron programs
(`*.kuron`), revises them when a request comes in, and writes implementation plans from a verified
prototype. The compiler and the CPU are separate models chosen per role (`--preset claude`: Sonnet 5.5 compiles,
Haiku 5.5 runs, both via `claude -p --json-schema`; `--preset local`: Ollama models). The upstream
session that writes programs never executes Kuron itself.

- Language definition: `docs/LANGUAGE.md` — read it before writing or revising a program.
- Write programs in the language the person uses. Keywords may be Japanese, English, Chinese or Korean.
- After writing or changing a program, run `node bin/kuron.js check <file>` and fix the program until
  the checks pass. Prefer making State fields, input names and action names explicit; the local
  compiler is small and follows explicit text far better than implied structure.
- `node bin/kuron.js dev <file>` serves the dev UI on http://127.0.0.1:4870/ (presentation: `/present`).
- `node bin/kuron.js reverse <file>` writes `reverse/<name>/SPEC.md`, `examples.jsonl` and `PLAN.md`.
- Code layout: `lib/source.js` (multilingual section parser), `lib/compile.js` (LLM compiler → IR),
  `lib/vm.js` (LLM-CPU, checks), `lib/server.js` (dev server), `lib/upstream.js` (`claude -p` calls),
  `lib/reverse.js` (spec + golden examples), `ui/` (dev UI, no build step, no dependencies).
