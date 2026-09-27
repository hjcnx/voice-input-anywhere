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
