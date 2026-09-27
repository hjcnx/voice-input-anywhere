// test-corrections.cjs — 在 vm 沙箱里执行 background.js，测试纠错 + 数字规范化
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const code = fs.readFileSync(path.join(__dirname, "background.js"), "utf8");
const ctx = {
  chrome: { runtime: { onMessage: { addListener() {} } }, storage: { local: { get: async () => ({}) } } },
  console,
  Blob: class {}, FormData: class {}, atob: (s) => s,
  fetch: async () => ({}), AbortSignal: { timeout: () => undefined },
  Uint8Array, setTimeout, clearTimeout,
};
vm.createContext(ctx);
vm.runInContext(code + "\nglobalThis.__t = { applyCorrections };", ctx);
const { applyCorrections } = ctx.__t;

const cases = [
  // 专名纠错
  ["我在用 Hermes 和 Cloud Code 写代码", "我在用 Hermes 和 Claude Code 写代码"],
  ["Clock Coat 也很好用", "Claude Code 也很好用"],
  ["我们用 LangChain 四 j 做 rag", "我们用 LangChain4j 做 RAG"],
  ["Hermis 和 Codex 都不错", "Hermes 和 Codex 都不错"],
  ["后端是 spring boot", "后端是 Spring Boot"],
  // 中文数字
  ["今天是二零二六年八月十五日", "今天是2026年8月15日"],
  ["气温二十八度", "气温28度"],
  ["数字六百六十六", "数字666"],
  ["三千五百二十一个人", "3521个人"],
  ["十五个人", "15个人"],
  ["两个小时", "2个小时"],
  ["排第三百六十五行", "排第365行"],
  // 不应误伤
  ["一点小事", "一点小事"],
  ["十分好", "十分好"],
  ["我们一起走", "我们一起走"],
  ["一样的东西", "一样的东西"],
  ["一定可以", "一定可以"],
  ["第一时间", "第一时间"],
  ["百发百中", "百发百中"],
];

let ok = 0;
for (const [src, want] of cases) {
  const got = applyCorrections(src);
  const pass = got === want;
  if (pass) ok++;
  console.log(`${pass ? "✓" : "✗"} ${src} → ${got}${pass ? "" : `   [期望 ${want}]`}`);
}
console.log(`\n通过 ${ok}/${cases.length}`);
process.exit(ok === cases.length ? 0 : 1);
