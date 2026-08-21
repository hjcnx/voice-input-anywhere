/**
 * Voice Input Anywhere — content script
 *
 * 在任意网页注入一个可拖动悬浮麦克风按钮：
 *   点击 = 开始录音（变红），再点 = 停止并转写；
 *   转写文字插入"录音开始时聚焦的输入框"的光标处。
 * 也支持浏览器级快捷键（manifest 里 chrome.commands，默认 Alt+Shift+V）。
 * 录音走 MediaRecorder，转写请求发给 background（绕过页面 CORS）。
 */

(() => {
  "use strict";

  const MAX_SECONDS = 60;
  const STORAGE_KEY = "providerConfig";

  /* ---------- 悬浮按钮 ---------- */
  let btn = null;
  let recording = false;
  let recorder = null;
  let chunks = [];
  let timer = null;
  let targetEl = null; // 录音开始时聚焦的输入框

  function ensureButton() {
    if (btn && btn.isConnected) return;
    btn = document.createElement("div");
    btn.id = "via-mic-btn";
    btn.title = "语音输入：点击开始/停止（快捷键 Alt+Shift+V）";
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><path d="M12 18v3"/></svg>';
    btn.style.cssText =
      "position:fixed;z-index:2147483647;right:24px;bottom:24px;width:48px;height:48px;" +
      "border-radius:50%;background:#fff;color:#333;display:flex;align-items:center;justify-content:center;" +
      "box-shadow:0 4px 16px rgba(0,0,0,.25);cursor:pointer;user-select:none;opacity:.9;" +
      "transition:background .15s, transform .15s;font-family:system-ui,sans-serif;";
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragStart(e);
    });
    btn.addEventListener("click", toggleRecording);
    // 避免按钮抢走页面输入框的焦点
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    document.documentElement.appendChild(btn);
  }

  /* 拖动（不触发录音） */
  let dragging = false, moved = 0;
  function dragStart(e) {
    dragging = false; moved = 0;
    const startX = e.clientX, startY = e.clientY;
    const rect = btn.getBoundingClientRect();
    const onMove = (ev) => {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (Math.abs(dx) + Math.abs(dy) > 4) dragging = true;
      moved = Math.abs(dx) + Math.abs(dy);
      btn.style.left = Math.min(window.innerWidth - 20, Math.max(0, rect.left + dx)) + "px";
      btn.style.top = Math.min(window.innerHeight - 20, Math.max(0, rect.top + dy)) + "px";
      btn.style.right = "auto";
      btn.style.bottom = "auto";
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (dragging) { e.stopPropagation(); e.preventDefault(); }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function setRecordingStyle(on) {
    if (!btn) return;
    if (on) {
      btn.style.background = "#ef4444";
      btn.style.color = "#fff";
      btn.style.animation = "via-pulse 1s infinite";
    } else {
      btn.style.background = "#fff";
      btn.style.color = "#333";
      btn.style.animation = "";
    }
  }

  /* ---------- 提示条 ---------- */
  let toastEl = null;
  function toast(msg, ms = 3000) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.id = "via-toast";
      toastEl.style.cssText =
        "position:fixed;left:50%;bottom:90px;transform:translateX(-50%);z-index:2147483647;" +
        "background:rgba(20,20,25,.92);color:#fff;padding:10px 18px;border-radius:10px;" +
        "font:13px/1.5 system-ui,sans-serif;box-shadow:0 4px 20px rgba(0,0,0,.35);" +
        "max-width:80vw;pointer-events:none;transition:opacity .25s;";
      document.documentElement.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.style.opacity = "1";
    clearTimeout(toastEl._h);
    toastEl._h = setTimeout(() => (toastEl.style.opacity = "0"), ms);
  }

  /* ---------- 文本插入（支持 textarea/input/contenteditable/富文本） ---------- */
  function isEditable(el) {
    if (!el) return false;
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const t = (el.type || "text").toLowerCase();
      return !["checkbox", "radio", "submit", "button", "file", "range", "color"].includes(t);
    }
    return el.isContentEditable;
  }

  function insertAtCaret(el, text) {
    el.focus();
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, el.value.slice(0, start) + text + el.value.slice(end));
      const pos = start + text.length;
      el.setSelectionRange(pos, pos);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (el.isContentEditable) {
      const sel = window.getSelection();
      let range;
      if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
        range = sel.getRangeAt(0);
      } else {
        range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
      }
      range.deleteContents();
      const node = document.createTextNode(text);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      // 部分富文本编辑器（Quill/ProseMirror 等）额外兼容
      try { el.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, inputType: "insertText", data: text })); } catch (_) {}
    } else {
      // 未知元素：尽力而为
      document.execCommand("insertText", false, text);
    }
  }

  /* ---------- 录音 + 转写 ---------- */
  function sendToTranscribe(base64, lang) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "STT", audioBase64: base64, lang }, (resp) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        resolve(resp);
      });
    });
  }

  async function stopAndTranscribe() {
    if (!recording) return;
    recording = false;
    clearTimeout(timer);
    setRecordingStyle(false);

    const rec = recorder;
    const stream = rec.stream;
    rec.stop();
    await new Promise((r) => (rec.onstop = r));
    stream.getTracks().forEach((t) => t.stop());

    const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
    if (blob.size < 1000) { toast("⚠️ 录音太短"); return; }

    toast("🔄 转写中…");
    try {
      const buf = await blob.arrayBuffer();
      let bin = "";
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      }
      const base64 = btoa(bin);

      let resp = await sendToTranscribe(base64, "");
      if (resp && resp.needConfig) {
        toast("⚠️ 未配置 API Key，请点击扩展图标设置");
        return;
      }
      if (!resp || resp.ok !== true) {
        throw new Error(resp && resp.error ? resp.error : "转写失败");
      }
      const text = resp.text;
      // 插入到录音开始时聚焦的输入框（若仍存在且可编辑）
      const el = (targetEl && targetEl.isConnected && isEditable(targetEl)) ? targetEl : null;
      if (el) {
        insertAtCaret(el, text);
        toast("✅ " + text.slice(0, 30) + (text.length > 30 ? "…" : ""));
      } else {
        toast("✅ " + text + "（未找到输入框，已复制到剪贴板）");
        try { await navigator.clipboard.writeText(text); } catch (_) {}
      }
    } catch (err) {
      toast("❌ " + err.message);
    }
  }

  async function startRecording() {
    const active = document.activeElement;
    if (isEditable(active)) {
      targetEl = active;
    } else {
      // 焦点不在输入框：找页面里聚焦过的 / 可见的 textarea 或 contenteditable
      targetEl = null;
      const candidates = document.querySelectorAll("textarea, [contenteditable='true'], [role='textbox']");
      for (const el of candidates) {
        if (el.offsetParent !== null) { targetEl = el; break; }
      }
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      toast("❌ 麦克风不可用：" + e.message);
      return;
    }
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus" : "audio/webm";
    chunks = [];
    recorder = new MediaRecorder(stream, { mimeType: mime });
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.start();
    recording = true;
    setRecordingStyle(true);
    toast("🔴 录音中… 再点一次结束");
    timer = setTimeout(stopAndTranscribe, MAX_SECONDS * 1000);
  }

  function toggleRecording() {
    if (dragging) { dragging = false; return; }
    if (recording) stopAndTranscribe();
    else startRecording();
  }

  /* ---------- 注入 ---------- */
  const style = document.createElement("style");
  style.textContent = "@keyframes via-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}";
  document.documentElement.appendChild(style);
  ensureButton();

  // 浏览器级快捷键（Alt+Shift+V）
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "TOGGLE_RECORDING") toggleRecording();
  });
})();
