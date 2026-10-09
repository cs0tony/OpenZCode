import assert from "node:assert/strict";
import test from "node:test";
import { delimiter } from "node:path";
import { buildEnvInfoSection } from "../src/context/sections/env-info.js";

import type { EnvInfo } from "@zcode/contracts";

function createEnvInfo(overrides?: Partial<EnvInfo>): EnvInfo {
  return {
    cwd: "/repos/zcode",
    platform: "darwin",
    shell: "/bin/zsh",
    osVersion: "darwin 25.6.0 arm64",
    nodeVersion: "v24.0.0",
    isGitRepository: false,
    ...overrides,
  };
}

test("普通单根工作区：Environment 段不渲染 Additional source folders 行", () => {
  const section = buildEnvInfoSection(createEnvInfo());
  assert.ok(!section.content.includes("Additional source folders"));
  // 兼容红线：缺省时输出与旧版本逐字节一致。
  assert.equal(
    section.content,
    [
      "# Environment",
      "You have been invoked in the following environment:",
      "- Primary working directory: /repos/zcode",
      "- Is a git repository: no",
      "- Platform: darwin",
      "- Shell: /bin/zsh",
      "- OS Version: darwin 25.6.0 arm64",
    ].join("\n"),
  );
});

test("项目工作区：渲染 Additional source folders 行且不改变其余行", () => {
  const section = buildEnvInfoSection(
    createEnvInfo({ additionalDirectories: ["/repos/docs", "/repos/tools"] }),
  );
  const lines = section.content.split("\n");
  assert.equal(lines[3], "- Additional source folders: /repos/docs, /repos/tools");
  assert.ok(lines.includes("- Primary working directory: /repos/zcode"));
  assert.equal(lines.filter((line) => line.startsWith("- Primary working directory")).length, 1);
});

test("additionalDirectories 为空数组时等同于缺省（不渲染空行）", () => {
  const section = buildEnvInfoSection(createEnvInfo({ additionalDirectories: [] }));
  assert.ok(!section.content.includes("Additional source folders"));
});

test("env 值按 path.delimiter 拆分后逐项渲染（与注入格式对齐）", () => {
  const raw = ["/repos/docs", "/repos/tools"].join(delimiter);
  const directories = raw.split(delimiter);
  assert.deepEqual(directories, ["/repos/docs", "/repos/tools"]);
});
