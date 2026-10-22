// Language names used in prompts. Nothing here interprets an idea.
const LANG_NAMES = { ja: "Japanese", en: "English", zh: "Chinese", ko: "Korean", es: "Spanish", fr: "French", de: "German", pt: "Portuguese" };
export const langName = code => LANG_NAMES[code] || code;
