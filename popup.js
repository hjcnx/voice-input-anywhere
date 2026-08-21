// popup.js — 读取 / 保存 providerConfig
const $ = (id) => document.getElementById(id);

chrome.storage.local.get("providerConfig").then(({ providerConfig }) => {
  const cfg = providerConfig || {};
  $("provider").value = cfg.provider || "siliconflow";
  $("apiKey").value = cfg.apiKey || "";
  $("model").value = cfg.model || "";
  $("language").value = cfg.language || "";
});

$("save").addEventListener("click", async () => {
  const btn = $("save");
  btn.disabled = true;
  const status = $("status");
  status.className = "";
  status.textContent = "保存中…";

  const cfg = {
    provider: $("provider").value,
    apiKey: $("apiKey").value.trim(),
    model: $("model").value.trim(),
    language: $("language").value.trim(),
  };
  await chrome.storage.local.set({ providerConfig: cfg });

  // 保存时验证 Key 有效性（发一个 0 字节占位请求不现实，这里只提示）
  status.className = "ok";
  status.textContent = "✅ 已保存，现在去网页点麦克风即可说话";
  setTimeout(() => window.close(), 1200);
});
