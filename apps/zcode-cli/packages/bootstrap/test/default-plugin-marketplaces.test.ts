// 覆盖 specs/default-plugin-marketplaces.md 的验收场景：
// 全新 storage root 双市场登记（顺序/source 形态/幂等）/ 旧 storage root 自愈补种
// 不触碰已有记录 / 默认市场 id 保留身份判定 / shared 与 contracts 的 id 字面量机械对照。
// 与 sync-official-plugins-from-local-zcode.test.ts 同构：node:test 直测 src，经 tsx 运行。
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ensureDefaultPluginMarketplaces,
  loadKnownMarketplacesSync,
} from "@zcode/adapters/plugins";
import {
  CLAUDE_OFFICIAL_PLUGIN_MARKETPLACE,
  isOfficialMarketplaceId,
  ZCODE_OFFICIAL_PLUGIN_MARKETPLACE,
} from "@zcode/contracts";
import {
  CLAUDE_OFFICIAL_PLUGIN_MARKETPLACE_ID,
  DEFAULT_PLUGIN_MARKETPLACE_IDS,
  DEFAULT_PLUGIN_MARKETPLACES,
  ZCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID,
} from "@zcode/shared";

const ZCODE_CDN_URL = "https://cdn-zcode.z.ai/zcode/official-plugin/marketplace.json";

function makeTempRoot(): string {
  return mkdtempSync(join(tmpdir(), "zcode-default-marketplaces-test-"));
}

test("默认市场清单：派生 id 列表与清单顺序一致，且与 contracts 保留 id 机械对照", () => {
  assert.deepEqual(
    DEFAULT_PLUGIN_MARKETPLACES.map((marketplace) => marketplace.id),
    DEFAULT_PLUGIN_MARKETPLACE_IDS,
  );
  // contracts 刻意不依赖 shared，两个包各持一份字面量；这里防止其中一侧悄悄改名。
  assert.equal(ZCODE_OFFICIAL_PLUGIN_MARKETPLACE, ZCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID);
  assert.equal(CLAUDE_OFFICIAL_PLUGIN_MARKETPLACE, CLAUDE_OFFICIAL_PLUGIN_MARKETPLACE_ID);
  assert.equal(isOfficialMarketplaceId(ZCODE_OFFICIAL_PLUGIN_MARKETPLACE), true);
  assert.equal(isOfficialMarketplaceId(CLAUDE_OFFICIAL_PLUGIN_MARKETPLACE), true);
  assert.equal(isOfficialMarketplaceId("my-own-marketplace"), false);
});

test("验收1：全新 storage root 登记两个默认市场，source 形态正确，重复调用幂等", () => {
  const storageRoot = makeTempRoot();
  try {
    const first = ensureDefaultPluginMarketplaces(storageRoot);
    assert.deepEqual(
      first.map((record) => record.id),
      DEFAULT_PLUGIN_MARKETPLACE_IDS,
    );
    const zcode = first.find((record) => record.id === ZCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID);
    assert.deepEqual(zcode?.source, { source: "url", url: ZCODE_CDN_URL });
    const claude = first.find(
      (record) => record.id === CLAUDE_OFFICIAL_PLUGIN_MARKETPLACE_ID,
    );
    // org/repo 缩写经 defaultMarketplaceSourceFromString 解析为 github source。
    assert.deepEqual(claude?.source, {
      source: "github",
      repo: "anthropics/claude-plugins-official",
    });

    // 幂等：补种只补缺失，不重写已存在记录（addedAt 等字段保持首次登记值）。
    const second = ensureDefaultPluginMarketplaces(storageRoot);
    assert.deepEqual(second, first);
    // 重启路径（重新从磁盘加载）读到同样两条。
    assert.deepEqual(loadKnownMarketplacesSync(storageRoot), first);
  } finally {
    rmSync(storageRoot, { recursive: true, force: true });
  }
});

test("验收2：旧 storage root 只补缺失的 claude 市场，已有记录与自定义市场原样保留", () => {
  const storageRoot = makeTempRoot();
  try {
    // 模拟旧版本遗留数据：只有 zcode 一条默认市场 + 一条用户自建市场。
    writeFileSync(
      join(storageRoot, "known_marketplaces.json"),
      JSON.stringify({
        version: 1,
        marketplaces: [
          {
            id: ZCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID,
            source: { source: "url", url: ZCODE_CDN_URL },
            name: ZCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID,
            description: "old description",
            addedAt: "2026-01-01T00:00:00.000Z",
            lastUpdated: "2026-02-02T00:00:00.000Z",
            pluginCount: 39,
          },
          {
            id: "my-own-marketplace",
            source: { source: "github", repo: "me/my-marketplace" },
            name: "my-own-marketplace",
            addedAt: "2026-01-01T00:00:00.000Z",
            pluginCount: 3,
          },
        ],
      }),
    );

    const next = ensureDefaultPluginMarketplaces(storageRoot);
    assert.deepEqual(
      next.map((record) => record.id),
      [
        ZCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID,
        "my-own-marketplace",
        CLAUDE_OFFICIAL_PLUGIN_MARKETPLACE_ID,
      ],
    );
    // 已有记录字段不被改写。
    assert.deepEqual(next[0], {
      id: ZCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID,
      source: { source: "url", url: ZCODE_CDN_URL },
      name: ZCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID,
      description: "old description",
      addedAt: "2026-01-01T00:00:00.000Z",
      lastUpdated: "2026-02-02T00:00:00.000Z",
      pluginCount: 39,
    });
    assert.equal(next[1]?.pluginCount, 3);
    assert.deepEqual(next[2]?.source, {
      source: "github",
      repo: "anthropics/claude-plugins-official",
    });
  } finally {
    rmSync(storageRoot, { recursive: true, force: true });
  }
});
