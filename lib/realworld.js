// The real world, without code. A program never gets code written for it: the runtime offers a fixed set
// of general real-world components, and the LLM-CPU fills in everything else while the program runs
// (judging camera frames, deciding how sound is shaped, writing instructions, drawing pictures…).

// Exact data contracts of the components that read program data. The compiler binds a list field to a component
// and fixes that field to this shape, so the LLM-CPU can only write what the component understands.
export const CONTRACTS = {
  sounds: { type: "object", properties: {
    label: { type: "string", description: "what this sound is" },
    kind: { type: "string", enum: ["noise", "hum", "tone", "siren", "beep", "voice"] },
    lowHz: { type: "number", description: "lowest frequency, 20–16000" }, highHz: { type: "number", description: "highest frequency, above lowHz" },
    level: { type: "number", description: "loudness from 0 (silent) to 1 (very loud)" },
    startSec: { type: "number" }, durationSec: { type: "number" },
    envelope: { type: "string", enum: ["steady", "approach", "away", "pulse"] },
    words: { type: "string", description: "for kind voice: the words spoken; otherwise empty" } },
    required: ["label", "kind", "lowHz", "highHz", "level", "startSec", "durationSec", "envelope", "words"] },
  output: { type: "object", properties: {
    label: { type: "string" }, lowHz: { type: "number" }, highHz: { type: "number" },
    gainDb: { type: "number", description: "gain of this band in dB: 0 = unchanged, negative = suppress (down to -60), positive = boost (up to +24)" } },
    required: ["label", "lowHz", "highHz", "gainDb"] },
};

export const COMPONENTS = `Real-world components (they exist in every program; nothing has to be programmed for them).
Their own controls are built in — start/stop, device choice, the processing on/off switch, automatic repetition — so never add
state fields or actions for those.
- camera: live camera picture, or a picture the person drops in to test. Every "every" seconds (0 = only on a button) the frame is
  given as an image to "action", which judges it and writes the result into the state.
- mic: live microphone. Every "every" seconds the sound's features (loudness, level per band from 63 Hz to 8 kHz, whether it is
  rising) and the words heard are given to "action" as input "sound".
- sounds: plays the test sounds held in one list field ("source"). Each item is one sound: label, kind (noise, hum, tone, siren,
  beep, voice), lowHz, highHz, level 0–1, startSec, durationSec, envelope (steady, approach, away, pulse), words (for voice).
  An action writes that list, so the LLM invents the test situation.
- output: sends the sound (from mic and/or sounds) to the person's earphones or speakers. It shapes the sound with the bands held
  in one list field ("gains"): label, lowHz, highHz, gainDb. Every "every" seconds it gives the incoming sound's features to
  "action" as input "sound"; that action sets the gains.
- speak: reads a text aloud (template) whenever it changes.
- drawing: shows an SVG picture held in a text field ("field"); an action can draw it (maps, scenes, diagrams, mock photos).`;

export function supplementPrompt(L) {
  return `Task: make this program work for real when it runs, with no code written for it.
Decide what the program still needs so a person can actually try its idea by hand right now. Use the real-world components when
the idea touches the real world, and let actions (run by the LLM-CPU) do every judgement, analysis, decision and generation.
Return ONLY additions written in the program's own format and language (${L}), or "" if nothing is missing:
- "## 状態"-style section bullets for missing fields (name before the colon; list the properties of list items),
- "## 画面 <existing or new name>" bullets for missing parts (adding to an existing screen name extends that screen); name the
  component plainly, e.g. "camera picture, judged every 3 s by 「構図を見る」", "earphone output with the band gains, comparison switch,
  features to 「音を判断する」 every 2 s", "test sounds from 試す音",
- "## 動き" with "### <name>" for missing actions (steps in plain words; an action that judges a camera frame or sound features says so),
- a test situation: an action that fills test data (e.g. writes the test sounds or draws a test scene) when the real situation is not at hand.
Use the heading words the program already uses. Never repeat what is already there.

${COMPONENTS}`;
}

export function realityPrompt(L) {
  return `Task: estimate how this idea would actually behave if it were built today with existing, shippable technology
(on-device models, typical chips, typical networks), as opposed to the ideal behaviour of the running prototype.
For each important part, name the existing technology that would be used and the effect a person would feel (delay, mistakes,
coarse updates, battery, cost), in ${L}. Then give numbers the runtime uses to make the prototype feel like that:
audioLatencyMs: extra delay of processed sound (e.g. what an on-device decision model adds), 0 if no sound path;
leak: 0–1, how much of the real sound still reaches the ear directly (earphones/open devices), 0 if not relevant;
decisionDelayMs: how late judgements arrive; errorRate: 0–1, how often judgements are wrong;
minIntervalSec: the shortest realistic interval between judgements;
cpuNote: one paragraph telling the CPU how to behave like that implementation (its limits and typical mistakes).`;
}
