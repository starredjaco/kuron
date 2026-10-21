// Splits a Kuron source (a design document made of headings and bullets) into sections.
// Structural keywords are accepted in Japanese, English, Chinese and Korean; the meaning of
// the bullets themselves is left to the compiler (the local LLM).

const K = {
  system: ["システム", "System", "系统", "系統", "시스템", "App", "アプリ"],
  desc: ["説明", "Description", "About", "描述", "说明", "說明", "설명"],
  form: ["形", "Form", "Platform", "形态", "形式", "형태", "플랫폼"],
  lang: ["言語", "Language", "Lang", "语言", "語言", "언어"],
  state: ["状態", "State", "Data", "状态", "狀態", "数据", "상태", "데이터"],
  screen: ["画面", "Screen", "Page", "页面", "頁面", "界面", "화면", "페이지"],
  event: ["動き", "Action", "Actions", "Event", "Events", "On", "动作", "動作", "事件", "동작", "이벤트"],
  start: ["起動", "始め", "初め", "Start", "On start", "Startup", "启动", "啟動", "시작"],
  device: ["実機", "入出力", "ハードウェア", "Device", "Devices", "Hardware", "Real world", "I/O", "实机", "设备", "硬件", "실기", "장치", "하드웨어"],
  check: ["確かめる", "Check", "Checks", "Test", "Tests", "Verify", "验证", "驗證", "测试", "확인", "검증", "테스트"],
  every: ["毎", "Every", "每", "매"],
  sec: ["秒", "s", "sec", "secs", "second", "seconds", "초"],
  min: ["分", "m", "min", "mins", "minute", "minutes", "分钟", "分鐘", "분"],
};
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const alt = ks => "(?:" + ks.map(esc).sort((a, b) => b.length - a.length).join("|") + ")";
const SEP = "[:：\\s]";

const FORMS = {
  web: ["サイト", "ウェブ", "web", "website", "site", "browser", "网站", "網站", "网页", "웹", "사이트"],
  phone: ["スマホ", "アプリ", "タブレット", "phone", "mobile", "app", "smartphone", "tablet", "手机", "手機", "移动", "모바일", "폰", "앱"],
  desktop: ["PC", "パソコン", "デスクトップ", "desktop", "pc", "computer", "桌面", "电脑", "電腦", "데스크톱", "컴퓨터"],
  iot: ["IoT", "機器", "家電", "device", "hardware", "sensor", "物联网", "物聯網", "设备", "設備", "기기", "센서"],
  term: ["ターミナル", "CLI", "コマンド", "terminal", "cli", "console", "终端", "終端", "터미널"],
  watch: ["ウォッチ", "時計", "watch", "smartwatch", "手表", "手錶", "워치", "시계"],
};
export function formOf(s) {
  const v = (s || "").trim().toLowerCase();
  if (!v) return "web";
  for (const [f, ws] of Object.entries(FORMS)) if (ws.some(w => w.toLowerCase() === v)) return f;
  return "panel";
}

// Guess the human language of the source when it is not declared.
export function guessLang(text) {
  const t = text.replace(/[#\-*:：\s\d]/g, "");
  if (/[぀-ヿ]/.test(t)) return "ja";
  if (/[가-힯]/.test(t)) return "ko";
  if (/[一-鿿]/.test(t)) return "zh";
  return "en";
}
const LANG_NAMES = { ja: "Japanese", en: "English", zh: "Chinese", ko: "Korean", es: "Spanish", fr: "French", de: "German", pt: "Portuguese" };
export const langName = code => LANG_NAMES[code] || code;
function normLang(s) {
  const v = (s || "").trim().toLowerCase();
  const map = { "日本語": "ja", japanese: "ja", ja: "ja", english: "en", en: "en", "英語": "en", "中文": "zh", chinese: "zh", zh: "zh", "中国語": "zh", "한국어": "ko", korean: "ko", ko: "ko", "韓国語": "ko",
    "español": "es", spanish: "es", es: "es", "français": "fr", french: "fr", fr: "fr", deutsch: "de", german: "de", de: "de", "português": "pt", portuguese: "pt", pt: "pt" };
  return map[v] || v || null;
}

const isBullet = l => /^\s*(?:[-・*•]|\d+[.)．])\s+/.test(l);
const unbullet = l => l.replace(/^\s*(?:[-・*•]|\d+[.)．])\s+/, "").trim();
function items(lines) {
  const out = [];
  for (const l of lines) {
    if (!l.trim()) continue;
    if (isBullet(l) && !/^\s{2,}/.test(l)) out.push(unbullet(l));
    else if (out.length) out[out.length - 1] += " " + unbullet(l);
    else out.push(l.trim());
  }
  return out;
}

const RX = {
  title: new RegExp("^#\\s+(?:" + alt(K.system) + "\\s*[:：]\\s*)?(.+)$", "i"),
  desc: new RegExp("^\\s*" + alt(K.desc) + "\\s*[:：]\\s*(.+)$", "i"),
  form: new RegExp("^\\s*" + alt(K.form) + "\\s*[:：]\\s*(.+)$", "i"),
  lang: new RegExp("^\\s*" + alt(K.lang) + "\\s*[:：]\\s*(.+)$", "i"),
  state: new RegExp("^" + alt(K.state) + "(?:$|[\\s:：(（])", "i"),
  screen: new RegExp("^" + alt(K.screen) + SEP + "\\s*([^（(]+?)\\s*(?:[（(]\\s*(.+?)\\s*[)）])?\\s*$", "i"),
  event: new RegExp("^" + alt(K.event) + "(?:" + SEP + "\\s*(.+))?$", "i"),
  every: new RegExp("^" + alt(K.every) + "\\s*(\\d+(?:\\.\\d+)?)\\s*(" + alt(K.sec) + "|" + alt(K.min) + ")\\s*(.*)$", "i"),
  start: new RegExp("^" + alt(K.start) + "\\s*$", "i"),
  check: new RegExp("^" + alt(K.check) + "(?:$|[\\s:：(（])", "i"),
  device: new RegExp("^" + alt(K.device) + "(?:$|[\\s:：(（])", "i"),
};
const isMin = u => K.min.some(w => w.toLowerCase() === u.toLowerCase());

export function parseSource(text) {
  const src = { name: "Untitled", desc: "", formLabel: "", lang: null, state: [], screens: [], events: [], timers: [], checks: [], device: [], errors: [] };
  const lines = text.replace(/\r/g, "").split("\n");
  let sec = null, sub = null, buf = [];
  const flush = () => {
    if (!sec) return;
    const body = buf; buf = [];
    if (sec.kind === "state") src.state.push(...items(body));
    else if (sec.kind === "screen") {
      // a screen named again (e.g. by the compiler's additions) extends the first one
      const same = src.screens.find(x => x.name === sec.name);
      if (same) same.items.push(...items(body));
      else { const fl = sec.form || src.formLabel; src.screens.push({ name: sec.name, formLabel: fl, form: formOf(fl), items: items(body), ln: sec.ln }) }
    }
    else if (sec.kind === "event") {
      const it = sub || sec; if (!it.name) return;
      const same = src.events.find(x => x.name === it.name);
      if (same) same.items.push(...items(body)); else src.events.push({ name: it.name, items: items(body), ln: it.ln });
    }
    else if (sec.kind === "timer") src.timers.push({ every: sec.every, name: sec.name, items: items(body), ln: sec.ln });
    else if (sec.kind === "start") src.events.push({ name: "__start", items: items(body), ln: sec.ln, start: true });
    else if (sec.kind === "device") src.device.push(...items(body));
    else if (sec.kind === "check") {
      if (sub) src.checks.push({ name: sub.name, text: items(body).join(" / "), ln: sub.ln });
      else items(body).forEach(t => src.checks.push({ name: t.length > 48 ? t.slice(0, 48) + "…" : t, text: t, ln: sec.ln }));
    }
  };
  lines.forEach((l, i) => {
    const ln = i + 1;
    let m;
    if (/^#\s/.test(l) && (m = RX.title.exec(l))) { flush(); sec = null; src.name = m[1].trim(); return }
    if (!sec) {
      if ((m = RX.desc.exec(l))) { src.desc = m[1].trim(); return }
      if ((m = RX.form.exec(l))) { src.formLabel = m[1].trim(); return }
      if ((m = RX.lang.exec(l))) { src.lang = normLang(m[1]); return }
    }
    if ((m = /^##\s+(.+)$/.exec(l))) {
      flush(); sub = null;
      const h = m[1].trim();
      let mm;
      if ((mm = RX.every.exec(h))) sec = { kind: "timer", every: +mm[1] * (isMin(mm[2]) ? 60 : 1), name: mm[3].trim() || h, ln };
      else if (RX.start.test(h)) sec = { kind: "start", ln };
      else if ((mm = RX.screen.exec(h))) sec = { kind: "screen", name: mm[1].trim(), form: mm[2], ln };
      else if (RX.check.test(h)) sec = { kind: "check", ln };
      else if (RX.device.test(h)) sec = { kind: "device", ln };
      else if ((mm = RX.event.exec(h))) sec = { kind: "event", name: mm[1] && mm[1].trim(), ln };
      else if (RX.state.test(h)) sec = { kind: "state", ln };
      else sec = { kind: "note", ln };
      return;
    }
    if ((m = /^###\s+(.+)$/.exec(l)) && sec && (sec.kind === "event" || sec.kind === "check")) { flush(); sub = { name: m[1].trim(), ln }; return }
    if (sec) buf.push(l);
  });
  flush();
  src.lang = src.lang || guessLang(text);
  if (!src.screens.length) src.errors.push({ code: "no_screen" });
  const names = new Set();
  [...src.events, ...src.timers].forEach(e => { if (names.has(e.name)) src.errors.push({ code: "dup_event", name: e.name, ln: e.ln }); names.add(e.name) });
  return src;
}
