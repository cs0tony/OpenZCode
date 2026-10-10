// 覆盖 specs/zcode-wire-identity-headers.md 的模型网关通道验收场景：
// 身份字段与官方 ZCode 逐字节一致 / 缺省版本回退 / 任何线上头不得携带 OpenZCode 品牌。
// 与 shared 的 zcodeSourceHeaders.test.ts 同构：node:test 直测 src，经 tsx 运行。
import type { AiSdkModelExecutionConfig } from "@zcode/adapters/model";
import assert from "node:assert/strict";
import test from "node:test";
import { ZCODE_APP_VERSION_ENV } from "@zcode/shared";
import { createRuntimeAiSdkModelExecutionConfig } from "../src/model-config.js";

// defaultHeaders 在配置类型上是可选（供其他构造方），但 createRuntimeAiSdkModelExecutionConfig
// 始终提供；用断言收窄而不是 `!`，缺头时给出可读失败信息。
function requireDefaultHeaders(config: AiSdkModelExecutionConfig): Readonly<Record<string, string>> {
  assert.ok(
    config.defaultHeaders,
    "defaultHeaders 应始终由 createRuntimeAiSdkModelExecutionConfig 提供",
  );
  return config.defaultHeaders;
}

test("模型通道身份头与官方 ZCode 模板一致", () => {
  const headers = requireDefaultHeaders(
    createRuntimeAiSdkModelExecutionConfig(
      { [ZCODE_APP_VERSION_ENV]: "3.14.4" },
      { sourceTitle: "cli" },
    ),
  );
  assert.equal(headers["User-Agent"], "ZCode/3.14.4");
  assert.equal(headers["X-ZCode-App-Version"], "3.14.4");
  assert.equal(headers["X-Title"], "Z Code@cli");
  assert.equal(headers["X-ZCode-Agent"], "glm");
});

test("缺省版本号时 User-Agent 回退 ZCode/unknown 且不携带版本头", () => {
  const headers = requireDefaultHeaders(
    createRuntimeAiSdkModelExecutionConfig({}, { sourceTitle: "electron" }),
  );
  assert.equal(headers["User-Agent"], "ZCode/unknown");
  assert.equal("X-ZCode-App-Version" in headers, false);
});

test("模型通道线上头不含 OpenZCode 品牌值", () => {
  const headers = requireDefaultHeaders(
    createRuntimeAiSdkModelExecutionConfig(
      { [ZCODE_APP_VERSION_ENV]: "3.14.4" },
      { sourceTitle: "cli" },
    ),
  );
  for (const [name, value] of Object.entries(headers)) {
    assert.ok(
      !name.toLowerCase().includes("openzcode"),
      `线上请求头 ${name} 不应携带 OpenZCode 品牌`,
    );
    assert.ok(
      !value.toLowerCase().includes("openzcode"),
      `线上请求头 ${name} 不应携带 OpenZCode 品牌: ${value}`,
    );
  }
});
