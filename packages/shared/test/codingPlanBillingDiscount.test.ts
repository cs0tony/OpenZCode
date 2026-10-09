import assert from "node:assert/strict";
import test from "node:test";
import {
  parseCodingPlanBillingDiscount,
  resolveCodingPlanBillingDiscountCopy,
} from "../src/codingPlanBillingDiscount.js";

const VALID_CONFIG = {
  "zh-CN": {
    badgeBody: "150% 配额",
    infoTitle: "150% 配额活动",
    infoBody: "使用 ZCode 期间按 150% 配额计算。",
  },
  "en-US": {
    badgeBody: "150% quota",
    infoTitle: "150% quota campaign",
    infoBody: "Usage via ZCode is settled at 150% quota.",
  },
};

test("解析合法配置并保留全部 locale", () => {
  const config = parseCodingPlanBillingDiscount(VALID_CONFIG);
  assert.ok(config);
  assert.equal(config["zh-CN"]?.badgeBody, "150% 配额");
  assert.equal(config["en-US"]?.badgeBody, "150% quota");
});

test("缺失或非法结构返回 null（fail-closed）", () => {
  assert.equal(parseCodingPlanBillingDiscount(undefined), null);
  assert.equal(parseCodingPlanBillingDiscount(null), null);
  assert.equal(parseCodingPlanBillingDiscount([]), null);
  assert.equal(parseCodingPlanBillingDiscount("campaign"), null);
  assert.equal(parseCodingPlanBillingDiscount({}), null);
  assert.equal(parseCodingPlanBillingDiscount({ "zh-CN": { badgeBody: 123 } }), null);
});

test("按当前 locale 取文案", () => {
  const copy = resolveCodingPlanBillingDiscountCopy(
    parseCodingPlanBillingDiscount(VALID_CONFIG),
    "zh-CN",
  );
  assert.equal(copy?.badgeBody, "150% 配额");
  assert.equal(copy?.hasBadge, true);
  assert.equal(copy?.hasInfo, true);
});

test("locale 回退链：当前 → zh-CN → en-US → 第一个有内容项", () => {
  const config = parseCodingPlanBillingDiscount(VALID_CONFIG);
  assert.equal(resolveCodingPlanBillingDiscountCopy(config, "ja-JP")?.badgeBody, "150% 配额");

  const enOnly = parseCodingPlanBillingDiscount({
    "en-US": { badgeBody: "150% quota" },
  });
  assert.equal(resolveCodingPlanBillingDiscountCopy(enOnly, "zh-CN")?.badgeBody, "150% quota");

  const frOnly = parseCodingPlanBillingDiscount({ "fr-FR": { badgeBody: "quota" } });
  assert.equal(resolveCodingPlanBillingDiscountCopy(frOnly, "zh-CN")?.badgeBody, "quota");
});

test("hasInfo 要求标题与正文同时非空；空文案 locale 被跳过", () => {
  const partial = parseCodingPlanBillingDiscount({
    "zh-CN": { badgeBody: "徽标", infoTitle: "只有标题" },
  });
  const copy = resolveCodingPlanBillingDiscountCopy(partial, "zh-CN");
  assert.equal(copy?.hasBadge, true);
  assert.equal(copy?.hasInfo, false);

  assert.equal(
    resolveCodingPlanBillingDiscountCopy(
      parseCodingPlanBillingDiscount({ "zh-CN": { badgeBody: "  " } }),
      "zh-CN",
    ),
    null,
  );
});

test("null/undefined config 直接返回 null", () => {
  assert.equal(resolveCodingPlanBillingDiscountCopy(null, "zh-CN"), null);
  assert.equal(resolveCodingPlanBillingDiscountCopy(undefined, "zh-CN"), null);
});
