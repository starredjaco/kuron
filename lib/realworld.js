// Exact data shapes of the sound components. The hands play_sounds and shape_sound only accept these.

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
