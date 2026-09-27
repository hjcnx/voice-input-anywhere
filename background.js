/**
 * Voice Input Anywhere — background service worker
 *
 * 接收 content script 的录音（base64），调用外部 ASR API 转写。
 * 放这里发请求可绕过页面 CSP/CORS（service worker 拥有 host_permissions）。
 *
 * 消息协议（content → background）：
 *   { type: "STT", audioBase64, lang }
 * 返回：
 *   { ok: true, text } | { needConfig: true } | { ok: false, error }
 *
 * 配置存 chrome.storage.local：providerConfig = { provider, apiKey, model, language }
 */

const PROVIDERS = {
  siliconflow: {
    url: "https://api.siliconflow.cn/v1/audio/transcriptions",
    // Qwen3-ASR：英文专名更准（Hermes/Codex 正确）；XingChenASR-V3.2-Ultra 纯中文标点略优但专名易错
    defaultModel: "Qwen/Qwen3-ASR-1.7B",
  },
  groq: {
    url: "https://api.groq.com/openai/v1/audio/transcriptions",
    defaultModel: "whisper-large-v3-turbo",
  },
  openai: {
    url: "https://api.openai.com/v1/audio/transcriptions",
    defaultModel: "whisper-1",
  },
};

/**
 * ASR 常见专名误识别 → 正确写法（同音/近音纠错）。
 * SiliconFlow 的 /audio/transcriptions 不支持热词/prompt 引导，只能本地纠错。
 */
const CORRECTIONS = [
  [/\b(?:Cloud|Clock|Claud|Clyde)\s*Code\b/gi, "Claude Code"],
  [/\b(?:clock\s*coat|cloud\s*coat)\b/gi, "Claude Code"],
  [/\bHermis\b/g, "Hermes"],
  [/\bHermers\b/g, "Hermes"],
  [/\bLangChain\s*(?:4|四|for|four)\s*j?\b/gi, "LangChain4j"],
  [/\bLunchain\s*(?:4|四|for)?\s*j?\b/gi, "LangChain4j"],
  [/\bLang\s*Chain\b/gi, "LangChain"],
  [/\brag\b/g, "RAG"],
  [/\bdeep\s*seek\b/gi, "DeepSeek"],
  [/\bspring\s*boot\b/gi, "Spring Boot"],
  [/\bgithub\s*copilot\b/gi, "GitHub Copilot"],
  [/\bcodex\b/gi, "Codex"],
  [/\bvs\s*code\b|\bvscode\b/gi, "VS Code"],
];

function applyCorrections(text) {
  for (const [pattern, repl] of CORRECTIONS) text = text.replace(pattern, repl);
  return normalizeCnNumbers(text);
}

/* ---------- 中文数字 → 阿拉伯数字（保守：只处理明确数字语境） ---------- */
const CN_DIGITS = { "零": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9 };
const CN_UNITS = { "十": 10, "百": 100, "千": 1000, "万": 10000, "亿": 100000000 };
const CN_CHAR_CLASS = "[零一二三四五六七八九十百千万两亿]";
// 单个中文数字后紧跟这些量词时才转换（白名单，避免"一起/一样/一定/十分"被误转）
const CN_MEASURES = ["个", "人", "次", "天", "秒", "元", "块", "岁", "层", "楼", "号",
  "条", "只", "份", "页", "行", "张", "台", "部", "本", "篇", "小时", "分钟", "公里", "米", "斤", "克", "吨"];

/** 中文数字串 → 数字。全为数字字符（二零二六）按逐位读法；含单位（二十八）按数值算法。 */
function cn2num(s) {
  if (!s) return null;
  const chars = [...s];
  if (chars.every((ch) => ch in CN_DIGITS)) {
    return parseInt(chars.map((ch) => CN_DIGITS[ch]).join(""), 10);
  }
  let total = 0, section = 0, number = 0;
  for (const ch of chars) {
    if (ch in CN_DIGITS) {
      number = CN_DIGITS[ch];
    } else if (ch in CN_UNITS) {
      const unit = CN_UNITS[ch];
      if (unit >= 10000) {
        section = (section + number) * unit;
        total += section;
        section = 0;
      } else {
        if (number === 0) number = 1; // "十五" 的十 → 10
        section += number * unit;
      }
      number = 0;
    } else {
      return null;
    }
  }
  return total + section + number;
}

function normalizeCnNumbers(text) {
  const yearRe = new RegExp(`(${CN_CHAR_CLASS}{2,4})年`, "g");
  const monthRe = new RegExp(`(${CN_CHAR_CLASS}{1,3})月`, "g");
  const dayRe = new RegExp(`(${CN_CHAR_CLASS}{1,3})([日号])`, "g");
  const runRe = new RegExp(`${CN_CHAR_CLASS}{2,}`, "g");
  const measureRe = new RegExp(`(${CN_CHAR_CLASS})(?=(?:${CN_MEASURES.join("|")}))`, "g");

  text = text.replace(yearRe, (m, p1) => { const v = cn2num(p1); return v === null ? m : `${v}年`; });
  text = text.replace(monthRe, (m, p1) => { const v = cn2num(p1); return v === null ? m : `${v}月`; });
  text = text.replace(dayRe, (m, p1, p2) => { const v = cn2num(p1); return v === null ? m : `${v}${p2}`; });
  // 两位以上数字串优先（否则"十五个人"会被切成"十5个人"）
  text = text.replace(runRe, (m) => { const v = cn2num(m); return v === null ? m : String(v); });
  text = text.replace(measureRe, (m, p1) => { const v = cn2num(p1); return v === null ? m : String(v); });
  return text;
}

async function transcribe(audioBase64, lang) {
  const { providerConfig } = await chrome.storage.local.get("providerConfig");
  const cfg = providerConfig || {};
  const provider = PROVIDERS[cfg.provider] || PROVIDERS.siliconflow;
  const apiKey = (cfg.apiKey || "").trim();
  if (!apiKey) return { needConfig: true };

  const model = (cfg.model || "").trim() || provider.defaultModel;

  // base64 → Blob（webm/opus）
  const bin = atob(audioBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: "audio/webm" });

  const form = new FormData();
  form.append("model", model);
  if (lang) form.append("language", lang);
  form.append("file", blob, "voice.webm");

  const resp = await fetch(provider.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`ASR API ${resp.status}: ${body.slice(0, 300)}`);
  }
  const json = await resp.json();
  const text = applyCorrections((json.text || "").trim());
  if (!text) throw new Error("未识别到内容");
  return { ok: true, text };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "STT") return;
  transcribe(msg.audioBase64, msg.lang)
    .then((r) => sendResponse(r))
    .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
  return true; // 异步响应
});
