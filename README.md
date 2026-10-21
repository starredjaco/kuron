# kuron

**A programming language whose CPU is an LLM.**

*Kūron* (空論) is Japanese for "armchair theory": an idea that only exists on paper. kuron turns such an idea into something
you can actually **use by hand within a few minutes**, not a mock-up or a video. You write (or ask Claude to write) a short design
document; an LLM compiles it, and another LLM runs it as the CPU. Things that would take hours to build, or that ordinary code
cannot do at all (judging, predicting, generating, simulating things that do not exist yet), work immediately because **the LLM
does the work that code would normally do.** Once you have tried the idea, kuron reverse-engineers it into a specification,
golden examples and an implementation plan with ready-to-use prompts.

```
your words ──▶ upstream (Claude Code): writes and revises the program, plans the real build
                 │
                 ▼
             app.kuron      a design document: headings and bullets, in Japanese, English, Chinese or Korean
                 │  compiler LLM: fills in what is missing, then lowers it to typed state, screens,
                 │                instruction lists and checks
                 ▼
             .kuron/<name>/ir.json
                 │  CPU LLM: runs the instructions on every action; output is constrained to the state's types
                 ▼
             a working system (website, phone, IoT device, terminal… several devices can share one state)
                 │  try it → note what should change → Claude revises → only the changed parts recompile
                 ▼
             kuron reverse: SPEC.md + examples.jsonl (recorded executions = golden examples) + PLAN.md
```

## Principles

- **No per-idea code, ever.** The minimal UI is generated; everything difficult is done by the LLM while the program runs.
- **The real world through general components.** Camera, microphone, synthesized test sounds, earphone/speaker output with
  per-band gains, speech, and drawings are built in once. They have strict data contracts, so the CPU can only write data they
  understand. The judgement (what a camera frame means, which band to suppress, what to tell a person) is the LLM's job.
- **Fix behaviour by instructing the LLM, not by patching code.** When a prototype does something wrong, say how it should behave
  (the request bar or presentation mode); Claude revises the program and only the affected parts recompile.
- **Ideal vs existing technology.** The compiler estimates how the idea would behave if it were built today with shippable
  technology (delay, sound leaking past earphones, late or wrong decisions, coarse intervals). One switch makes the running
  prototype behave that way, so you can feel both, e.g. how uncomfortable a noise-cancelling decision model with 150 ms of delay is.

## Requirements

- Node.js 20+
- [Claude Code](https://claude.com/claude-code) (the `claude` command, logged in)
- Only for the local preset: [Ollama](https://ollama.com) and its models

## Roles

| Role | `--preset claude` (default) | `--preset local` |
|---|---|---|
| Upstream: understand requests, write/revise programs, plan | Claude Code (writing new programs uses Sonnet 5.5) | Claude Code |
| Compiler: program → state types, screens, instructions, checks | `claude-sonnet-5-5` | `qwen3.8:27b-mlx` |
| CPU: runs instructions on every action | `claude-haiku-5-5` | `qwen3.5:4b` |

Models whose name starts with `claude-` run through Claude Code (`claude -p --json-schema`); any other name runs on Ollama.
Override per role with `--compile-model` / `--cpu-model`, or in `kuron.json` (`{"preset": "local", "cpuModel": "…"}`).
Use the local preset when data must not leave the machine or when you are offline.

## Usage

```bash
kuron new "a reception desk that notifies the host and warns about guests who have waited too long" -o desk.kuron
kuron dev .                 # dev UI at http://127.0.0.1:4870/ — switch between every .kuron in the folder
kuron check desk.kuron      # run the program's checks on the CPU; an LLM judges the expectations
kuron reverse desk.kuron    # reverse/desk/: SPEC.md, examples.jsonl, PLAN.md
```

Run `node bin/kuron.js …` if the package is not linked.

### Dev UI

- **+ New**: type one line; Claude writes the program, it compiles and opens ready to use, with the time it took.
- The running system on the left; on the right **State**, **Executions** (instructions the CPU ran, the state patch, cost),
  **Checks**, **Requests**, **Reverse** and **Source**.
- **Ideal / Existing tech** switch with the estimate shown above the system.
- The request bar sends "this should …" to Claude, which revises the program.
- **Presentation mode** (`/present`): only the system, plus a button to note requests together with where they were made.
- State is saved to `.kuron/<name>/state.json` and restored after a restart; timer actions (`## Every 30 seconds`) really run.

## The language

See [docs/LANGUAGE.md](docs/LANGUAGE.md). Section keywords work in Japanese, English, Chinese and Korean; everything else is
free text in any language, and the system answers in the program's language. A minimal program:

```
# System: Deadline Keeper
Description: Add tasks; it orders them by what you should do today and warns about the ones you are likely to forget
Form: Website

## State
- tasks: list of tasks with name, deadline, priority (high/medium/low), reason, done

## Screen List
- Task name and deadline inputs with an "Add" button
- Unfinished tasks, highest priority first; each row shows name, deadline, priority badge, reason and a "Done" button

## Actions
### Add
- Create a task from the name and deadline
- Decide its priority from what it is and when it is due, and write the reason in one sentence
### Done
- Mark the selected task as done

## Checks
- Adding "Send the invoice (today)" and "Read a novel (next month)" gives the invoice the higher priority
```

The compiler adds what a program needs to really work (missing fields, screen parts, actions, a test situation) in the
program's own words before compiling, so a one-paragraph idea is enough.

## Timing (measured on an M1 Max, 64 GB)

**From one line to a usable system: about 1–2 minutes** with the Claude preset (target: under 5 minutes).

| Step | claude | local |
|---|---|---|
| Upstream writes the program | ~20–30 s | same |
| First compile | ~30–100 s | ~2.5 min |
| Recompile after changing a screen or an action | a few s – 30 s | 4–30 s |
| One CPU step | 3–20 s depending on how much it generates | 3–8 s |

With the Claude preset, usage counts against your Claude Code plan; the Executions tab shows the cost estimate per step.

## Examples

`examples/` contains a task manager, a fridge (IoT) with a shopping-list phone app, an English sales pipeline, earphones that
suppress approaching noise while letting announcements and your name through, and a camera app that directs a remote person
to take a better photo. `examples/reverse/shimekiri/` shows what `kuron reverse` produces.

## License

MIT
