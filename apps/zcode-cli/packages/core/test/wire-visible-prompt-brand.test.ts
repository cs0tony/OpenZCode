// 覆盖 specs/zcode-wire-identity-headers.md 的模型可见文案验收场景：
// 系统提示词 / 子代理提示词 / 工具描述 / system-reminder 与官方 ZCode 线上文案逐字一致
// （品牌词为 ZCode），出站 WebFetch UA 不得品牌化；core/src 非注释行不得再出现
// OpenZCode 品牌值（`.openzcode` 真实文件系统路径豁免）。
// 与 bootstrap 的 model-config-source-headers.test.ts 同构：node:test 直测 src，经 tsx 运行。
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildDesktopContextSection } from "../src/context/sections/desktop.js";
import { buildCliPrefixSection } from "../src/context/sections/cli-prefix.js";
import { buildIdentitySection } from "../src/context/sections/identity.js";
import {
  buildExploreAgentPrompt,
} from "../src/subagent/explore.js";
import { buildGeneralPurposeSystemPrompt } from "../src/subagent/general-purpose.js";
import { WEBFETCH_USER_AGENT } from "../src/tool/handlers/webfetch-constants.js";
import { EXIT_PLAN_MODE_MODEL_INSTRUCTIONS } from "../src/tool/handlers/plan-mode-prompts.js";
import {
  buildReferencedSessionContextReminderBody,
} from "../src/session-context/references.js";
import { formatIncomingMessage } from "../src/system-reminder/incoming-message.js";

test("CLI prefix 与官方 ZCode 文案一致", () => {
  assert.equal(
    buildCliPrefixSection().content,
    "You are ZCode, an interactive coding agent",
  );
});

test("Agent Identity 开场句与官方 ZCode 文案一致", () => {
  const content = buildIdentitySection().content;
  assert.ok(
    content.includes(
      "You are an interactive ZCode agent that helps users with software engineering tasks.",
    ),
  );
  assert.ok(!/openzcode/i.test(content));
});

test("Desktop Context 段名与标题不含品牌值", () => {
  const section = buildDesktopContextSection();
  assert.equal(section.name, "ZCode Desktop Context");
  assert.ok(section.content.startsWith("# ZCode Desktop Context"));
  assert.ok(!/openzcode/i.test(section.content));
});

test("Explore / GeneralPurpose 子代理开场句品牌词为 ZCode", () => {
  const explore = buildExploreAgentPrompt({});
  assert.ok(
    explore.startsWith(
      "You are ZCode Explore, a file search and codebase research specialist for ZCode CLI.",
    ),
  );
  const generalPurpose = buildGeneralPurposeSystemPrompt();
  assert.ok(generalPurpose.startsWith("You are an agent for ZCode CLI."));
  assert.ok(!/openzcode/i.test(explore));
  assert.ok(!/openzcode/i.test(generalPurpose));
});

test("WebFetch 出站 UA 与官方一致", () => {
  assert.equal(WEBFETCH_USER_AGENT, "ZCode-WebFetch/0.1 (+https://zcode.ai; coding-agent-cli)");
});

test("ExitPlanMode 说明品牌词为 ZCode", () => {
  const instructions = EXIT_PLAN_MODE_MODEL_INSTRUCTIONS.join("\n");
  assert.ok(instructions.includes("required plan parameter in ZCode"));
  assert.ok(!/openzcode/i.test(instructions));
});

test("system-reminder 文案品牌词为 ZCode", () => {
  assert.ok(
    formatIncomingMessage("body", "user_steer").includes(
      "This is how ZCode surfaces messages the user sends mid-turn",
    ),
  );
  assert.ok(
    formatIncomingMessage("body", "subagent_reply_steer").includes(
      "Another ZCode session sent a message while you were working:",
    ),
  );
  assert.ok(
    formatIncomingMessage("body", "subagent_reply").includes(
      "Another ZCode session sent a message:",
    ),
  );
});

test("会话引用提醒品牌词为 ZCode", () => {
  const reminder = buildReferencedSessionContextReminderBody("#sess_abc");
  assert.ok(reminder !== null);
  assert.ok(
    (reminder ?? "").includes("The user referenced prior ZCode session(s) in this prompt:"),
  );
});

// ---- core/src 非注释行品牌扫描 ----
// 注释（整行 // 与 /* */ 块）不是模型可见文案，不受约束；行尾 // 注释同样放行。
// 已知局限：字符串内含未跟在 `:` 后的 `//` 时，其后的品牌词会被误判为注释（偏宽松），
// 出现时按失败上报人工复核。

const SRC_ROOT = fileURLToPath(new URL("../src/", import.meta.url));

function listTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTsFiles(fullPath));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(fullPath);
    }
  }
  return files;
}

function stripBlockComments(text: string): string {
  // 块注释按字符置换为空格，保留换行以便按行继续处理。
  return text.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "));
}

function stripLineCommentSuffix(line: string): string {
  // `://`（如 https://）不是注释起点；其余首个 `//` 之后视为注释。
  let index = line.indexOf("//");
  while (index > 0 && line[index - 1] === ":") {
    index = line.indexOf("//", index + 1);
  }
  return index >= 0 ? line.slice(0, index) : line;
}

test("core/src 非注释行不含 OpenZCode 品牌值", () => {
  const violations: string[] = [];
  for (const file of listTsFiles(SRC_ROOT)) {
    const text = stripBlockComments(readFileSync(file, "utf8"));
    for (const [lineIndex, rawLine] of text.split("\n").entries()) {
      const codePart = stripLineCommentSuffix(rawLine).replaceAll(".openzcode", "");
      if (/openzcode/i.test(codePart)) {
        violations.push(`${file}:${lineIndex + 1}: ${rawLine.trim()}`);
      }
    }
  }
  assert.deepEqual(
    violations,
    [],
    `模型可见文案不得携带 OpenZCode 品牌值（specs/zcode-wire-identity-headers.md）:\n${violations.join("\n")}`,
  );
});
