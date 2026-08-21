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
    defaultModel: "TeleAI/TeleSpeechASR", // 中文实测零错误；SenseVoiceSmall 备选
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
  const text = (json.text || "").trim();
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
