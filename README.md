# 🎤 Voice Input Anywhere

> 浏览器全局语音输入扩展：在**任意网页**的输入框里说话，转写文字自动插入光标处。
> A browser-wide voice input extension: speak on any webpage, transcribed text is inserted at the caret.

写邮件、填表单、聊微信网页版、记笔记、搜东西……不用打字，点一下悬浮麦克风（或按快捷键）说就行。
默认使用**硅基流动**免费模型（中文识别准确、国内直连、免费不限量），开箱即用。

> ⚠️ **项目定位：实验性 / 学习用途**
>
> 作者自用的"够用就行"小工具，不是生产级产品。已知局限见下，**欢迎提 issue / PR 指出不足**。

## ✨ 特性

- 🌐 **任意网页可用**：`<all_urls>` 注入，支持 textarea / input / contenteditable / 常见富文本编辑器（Quill 等）
- 🎯 **光标处插入**：文字插到"录音开始时聚焦的输入框"的光标位置，不打断写作思路
- 🖱️ **悬浮麦克风**：右下角圆钮，可拖动；单击开始录音（变红），再点停止转写
- ⌨️ **浏览器级快捷键**：`Alt+Shift+V` 开始/停止 —— 网页脚本无法拦截
- ⚙️ **设置弹窗**：服务商（SiliconFlow / Groq / OpenAI）+ API Key + 模型 + 语言，点扩展图标即配
- 🇨🇳 **国内友好**：默认硅基流动（免费、中文强、无需代理）；Groq 走代理也行
- 🔒 **隐私**：录音只在停止后发往你配置的 ASR 服务商；不采集页面内容、不存储音频

## 🚀 安装

1. 下载本仓库代码，解压
2. 打开 `chrome://extensions`（Edge 为 `edge://extensions`），右上角开启**开发者模式**
3. 点击 **加载已解压的扩展程序** → 选择 `voice-input-anywhere/` 文件夹
4. 点工具栏上的扩展图标 → 选服务商 → **粘贴 API Key** → 保存

首次使用推荐 [cloud.siliconflow.cn](https://cloud.siliconflow.cn)（免费注册，`TeleAI/TeleSpeechASR` 与 `FunAudioLLM/SenseVoiceSmall` 模型免费，中文效果好，国内直连）。

## 🎙️ 使用

| 操作 | 效果 |
|---|---|
| 点击悬浮 🎤 或按 `Alt+Shift+V` | 开始录音（按钮变红脉动） |
| 再点一下 / 再按一次快捷键 | 停止并转写，文字插入光标处 |
| 按住按钮拖动 | 移动悬浮按钮位置 |
| 点击扩展图标 | 打开设置（换服务商 / 换模型） |

## ⚙️ 配置

| 项 | 默认 | 说明 |
|---|---|---|
| 服务商 | `siliconflow` | `siliconflow` / `groq` / `openai`，均 OpenAI 兼容 `/audio/transcriptions` |
| 模型 | `TeleAI/TeleSpeechASR` | 硅基流动也可用 `FunAudioLLM/SenseVoiceSmall` |
| 语言 | 留空自动检测 | 可固定 `zh` / `en` |

配置存 `chrome.storage.local`，只在你的浏览器里。

## 🔧 已知局限（欢迎改进）

- ❌ **个别网站麦克风受限**：若网站设置了 `Permissions-Policy` 禁止 microphone（如部分自带语音功能的站点），浏览器会报 `Permission denied`，扩展无法绕过 —— 可在地址栏"网站设置"里允许麦克风试试
- ❌ 重度自定义编辑器（Google Docs 等 canvas 渲染层）可能插不进文字
- ❌ 无流式转写（录完才出字）、无音量可视化
- ❌ 无自动化测试、无图标精细化设计
- ❌ `chrome://` 页面、扩展商店页面无法注入（浏览器安全限制）

## 🛡️ 隐私

- 音频**仅在录音结束后**发送到你配置的 ASR 服务商，用于转写
- API Key 只存 `chrome.storage.local`，不进代码、不上传
- 扩展不读取、不存储你的页面内容；录音中断时音频直接丢弃

## 🤝 贡献 / Contributing

这个项目水平有限，但改进空间很大。欢迎：

- 发现 bug、体验不顺 → 开 issue
- 哪里代码难看、设计不合理 → 直接提 PR，不用先问
- 想要的功能（流式转写、音量可视化、多语言快捷键、更多编辑器适配…）→ 开 issue 讨论

## 📄 License

MIT
