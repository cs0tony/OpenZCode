// 覆盖 specs/default-plugin-marketplaces.md「目录图标注入」的验收场景：
// 名单解析与按名合并（纯函数）/ claude 目录物化后条目带 icon 且名单缓存落盘 /
// 名单拉取失败回退缓存 / 双双失败降级无图标 / 非 claude 市场不注入。
// 与 default-plugin-marketplaces.test.ts 同构：node:test 直测 src，经 tsx 运行。
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  addMarketplace,
  applyIconSourcesToManifestRaw,
  loadMarketplaceManifestSync,
  parseIconSourcesJson,
} from "@zcode/adapters/plugins";

const CLAUDE_ID = "claude-plugins-official";
const ICON_ASSETS_BASE = "https://cdn-zcode.z.ai/zcode/official-plugin/assets/";

function makeTempRoot(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

test("parseIconSourcesJson：合法条目入表，脏条目跳过，非数组视为无名单", () => {
  const icons = parseIconSourcesJson([
    { icon: "a/icon.png", mimeType: "image/png", name: "a" },
    { icon: "b/icon.png", name: " b " },
    { icon: "", name: "empty-icon" },
    { icon: "c/icon.png", name: "" },
    { icon: "d/icon.png" },
    { name: "no-icon" },
    "not-an-object",
  ]);
  assert.deepEqual(
    [...icons],
    [
      ["a", "a/icon.png"],
      ["b", "b/icon.png"],
    ],
  );
  assert.equal(icons.get("a"), "a/icon.png");
  assert.equal(icons.get("b"), "b/icon.png");
  assert.equal(icons.size, 2);
  assert.equal(parseIconSourcesJson({ name: "a" }).size, 0);
  assert.equal(parseIconSourcesJson("nope").size, 0);
});

test("applyIconSourcesToManifestRaw：按名合并拼基址，已有 icon 不覆盖，名单外不动", () => {
  const raw: Record<string, unknown> = {
    plugins: [
      { name: "has-icon", icon: "https://example.com/native.png" },
      { name: "listed" },
      { name: "unlisted" },
      { notName: true },
    ],
  };
  applyIconSourcesToManifestRaw(
    raw,
    new Map([
      ["has-icon", "has-icon/icon.png"],
      ["listed", "listed/icon.png"],
      ["abs", "https://cdn.example.com/x.png"],
    ]),
  );
  const plugins = raw.plugins as Array<Record<string, unknown>>;
  assert.equal(plugins[0]?.icon, "https://example.com/native.png");
  assert.equal(plugins[1]?.icon, `${ICON_ASSETS_BASE}listed/icon.png`);
  assert.equal("icon" in (plugins[2] ?? {}), false);
  assert.equal("icon" in (plugins[3] ?? {}), false);

  // 名单为空与 plugins 缺失都是合法降级：原样跳过，不抛错。
  const untouched: Record<string, unknown> = { plugins: [{ name: "listed" }] };
  applyIconSourcesToManifestRaw(untouched, new Map());
  assert.equal("icon" in ((untouched.plugins as Array<unknown>)[0] ?? {}), false);
  applyIconSourcesToManifestRaw({}, new Map([["listed", "listed/icon.png"]]));
});

function writeClaudeMarketplaceFixture(sourceDir: string): void {
  mkdirSync(join(sourceDir, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(sourceDir, ".claude-plugin", "marketplace.json"),
    JSON.stringify({
      name: CLAUDE_ID,
      plugins: [
        {
          // 目录已自带 icon：注入不得覆盖。
          icon: "https://example.com/native.png",
          name: "iconed-claude-plugin",
          source: { repo: "a/native", source: "github" },
        },
        {
          name: "plain-claude-plugin",
          source: { repo: "a/plain", source: "github" },
        },
      ],
    }),
  );
}

test("验收7：claude 市场物化后条目按名带 icon，名单缓存落盘，已有 icon 不被覆盖", async () => {
  const storageRoot = makeTempRoot("zcode-claude-icons-root-");
  const sourceDir = makeTempRoot("zcode-claude-icons-src-");
  try {
    writeClaudeMarketplaceFixture(sourceDir);
    const record = await addMarketplace({
      fetchIconSources: async () => [
        { icon: "plain-claude-plugin/icon.png", name: "plain-claude-plugin" },
      ],
      source: { path: sourceDir, source: "directory" },
      storageRoot,
      trustedId: CLAUDE_ID,
    });
    assert.equal(record.id, CLAUDE_ID);

    const manifest = loadMarketplaceManifestSync(storageRoot, CLAUDE_ID);
    assert.ok(manifest);
    const plain = manifest.plugins.find((plugin) => plugin.name === "plain-claude-plugin");
    assert.equal(plain?.listing?.icon, `${ICON_ASSETS_BASE}plain-claude-plugin/icon.png`);
    const native = manifest.plugins.find((plugin) => plugin.name === "iconed-claude-plugin");
    assert.equal(native?.listing?.icon, "https://example.com/native.png");

    // 名单缓存与官方 ZCode 同布局：pluginStorageRoot/icon-sources.json。
    const cached = JSON.parse(
      readFileSync(join(storageRoot, "icon-sources.json"), "utf8"),
    ) as Array<{ icon: string; name: string }>;
    assert.deepEqual(cached, [{ icon: "plain-claude-plugin/icon.png", name: "plain-claude-plugin" }]);

    // 持久化的目录文件本身也带 icon（官方桌面端同款 bake-in 行为）。
    const persisted = JSON.parse(
      readFileSync(
        join(storageRoot, "marketplaces", CLAUDE_ID, "marketplace.json"),
        "utf8",
      ),
    ) as { plugins: Array<{ icon?: string; name: string }> };
    assert.equal(
      persisted.plugins.find((plugin) => plugin.name === "plain-claude-plugin")?.icon,
      `${ICON_ASSETS_BASE}plain-claude-plugin/icon.png`,
    );
  } finally {
    rmSync(storageRoot, { recursive: true, force: true });
    rmSync(sourceDir, { recursive: true, force: true });
  }
});

test("验收8a：名单拉取失败但存在历史缓存，图标来自缓存且不阻塞物化", async () => {
  const storageRoot = makeTempRoot("zcode-claude-icons-cache-");
  const sourceDir = makeTempRoot("zcode-claude-icons-src2-");
  try {
    writeClaudeMarketplaceFixture(sourceDir);
    writeFileSync(
      join(storageRoot, "icon-sources.json"),
      JSON.stringify([{ icon: "plain-claude-plugin/icon.png", name: "plain-claude-plugin" }]),
    );
    await addMarketplace({
      fetchIconSources: async () => {
        throw new Error("cdn unreachable");
      },
      source: { path: sourceDir, source: "directory" },
      storageRoot,
      trustedId: CLAUDE_ID,
    });
    const manifest = loadMarketplaceManifestSync(storageRoot, CLAUDE_ID);
    assert.ok(manifest);
    assert.equal(
      manifest.plugins.find((plugin) => plugin.name === "plain-claude-plugin")?.listing?.icon,
      `${ICON_ASSETS_BASE}plain-claude-plugin/icon.png`,
    );
  } finally {
    rmSync(storageRoot, { recursive: true, force: true });
    rmSync(sourceDir, { recursive: true, force: true });
  }
});

test("验收8b：名单与缓存皆无，市场照常物化且无图标", async () => {
  const storageRoot = makeTempRoot("zcode-claude-icons-none-");
  const sourceDir = makeTempRoot("zcode-claude-icons-src3-");
  try {
    writeClaudeMarketplaceFixture(sourceDir);
    await addMarketplace({
      fetchIconSources: async () => {
        throw new Error("cdn unreachable");
      },
      source: { path: sourceDir, source: "directory" },
      storageRoot,
      trustedId: CLAUDE_ID,
    });
    const manifest = loadMarketplaceManifestSync(storageRoot, CLAUDE_ID);
    assert.ok(manifest);
    assert.equal(manifest.plugins.length, 2);
    // 注入没有发生：名单外的 plain 条目无 icon；iconed 条目的原生 icon 保持原样。
    assert.equal(
      manifest.plugins.find((plugin) => plugin.name === "plain-claude-plugin")?.listing?.icon,
      undefined,
    );
    assert.equal(existsSync(join(storageRoot, "icon-sources.json")), false);
  } finally {
    rmSync(storageRoot, { recursive: true, force: true });
    rmSync(sourceDir, { recursive: true, force: true });
  }
});

test("验收9：非 claude 市场不触发名单拉取", async () => {
  const storageRoot = makeTempRoot("zcode-claude-icons-other-");
  const sourceDir = makeTempRoot("zcode-claude-icons-src4-");
  let fetchCalls = 0;
  try {
    mkdirSync(join(sourceDir, ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(sourceDir, ".claude-plugin", "marketplace.json"),
      JSON.stringify({
        name: "my-own-marketplace",
        plugins: [{ name: "some-plugin", source: { repo: "a/b", source: "github" } }],
      }),
    );
    await addMarketplace({
      fetchIconSources: async () => {
        fetchCalls += 1;
        return [];
      },
      source: { path: sourceDir, source: "directory" },
      storageRoot,
    });
    const manifest = loadMarketplaceManifestSync(storageRoot, "my-own-marketplace");
    assert.ok(manifest);
    assert.equal(fetchCalls, 0);
    assert.equal(existsSync(join(storageRoot, "icon-sources.json")), false);
  } finally {
    rmSync(storageRoot, { recursive: true, force: true });
    rmSync(sourceDir, { recursive: true, force: true });
  }
});
