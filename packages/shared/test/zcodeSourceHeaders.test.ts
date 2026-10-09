import assert from "node:assert/strict";
import test from "node:test";
import {
  buildZCodeSourceHeadersFromContext,
  ZCODE_SOURCE_HEADERS,
} from "../src/zcode-source-headers.js";

// 线上身份字段必须与官方 ZCode 客户端逐字节一致（specs/zcode-wire-identity-headers.md）：
// 官方后端按这些字段识别 ZCode 来源流量并套用活动配额口径。品牌更名不得进入这些值。
test("静态基头与官方 ZCode 客户端一致", () => {
  assert.equal(ZCODE_SOURCE_HEADERS["User-Agent"], "ZCode/unknown");
  assert.equal(ZCODE_SOURCE_HEADERS["X-Title"], "Z Code@electron");
});

test("携带版本号时 User-Agent 与 X-ZCode-App-Version 使用 ZCode 原值", () => {
  const headers = buildZCodeSourceHeadersFromContext({
    appVersion: "3.14.3",
    platform: "darwin",
    arch: "arm64",
    sourceTitle: "electron",
  });
  assert.equal(headers["User-Agent"], "ZCode/3.14.3");
  assert.equal(headers["X-ZCode-App-Version"], "3.14.3");
  assert.equal(headers["X-Title"], "Z Code@electron");
  assert.equal(headers["X-Platform"], "darwin-arm64");
});

test("缺省版本号时回退 ZCode/unknown 且不携带版本头", () => {
  const headers = buildZCodeSourceHeadersFromContext({});
  assert.equal(headers["User-Agent"], "ZCode/unknown");
  assert.equal("X-ZCode-App-Version" in headers, false);
});

test("不含 OpenZCode 品牌值泄漏到线上字段", () => {
  const headers = buildZCodeSourceHeadersFromContext({ appVersion: "9.9.9" });
  for (const [name, value] of Object.entries(headers)) {
    assert.ok(
      !value.toLowerCase().includes("openzcode"),
      `线上请求头 ${name} 不应携带 OpenZCode 品牌: ${value}`,
    );
  }
});
