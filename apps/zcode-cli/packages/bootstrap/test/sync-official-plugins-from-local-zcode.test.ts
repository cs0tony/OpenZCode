// 与 packages/services/test 惯例一致：node:test 直测 src，经根目录 tsx 运行
// （`node ../../../../node_modules/.bin/tsx --test test/...`）。
// 覆盖 specs/sync-official-plugins-from-local-zcode.md 的验收场景：
// 无官方缓存 / 复制缺失插件 / 重复同步幂等 / 删除来源后缓存仍可用。
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { syncOfficialPluginsFromLocalZcodeCache } from "../src/app/bundled-plugins.js";

const OFFICIAL_MARKETPLACE = "zcode-plugins-official";
const MARKER_FILE = ".zcode-plugin-seed.json";

function makeTempRoot(): string {
  return mkdtempSync(join(tmpdir(), "zcode-sync-official-test-"));
}

/** 造一个最小可 seed 的 image-search@0.1.1 官方缓存（requiredSeedPaths 仅 .mcp.json）。 */
function seedFakeImageSearchPlugin(officialCacheRoot: string): void {
  const pluginRoot = join(officialCacheRoot, "image-search", "0.1.1");
  mkdirSync(join(pluginRoot, ".zcode-plugin"), { recursive: true });
  writeFileSync(
    join(pluginRoot, ".zcode-plugin", "plugin.json"),
    JSON.stringify({ name: "image-search", description: "fake image search" }),
  );
  writeFileSync(join(pluginRoot, ".mcp.json"), JSON.stringify({ mcpServers: {} }));
}

test("sync reports officialCacheFound=false when local ZCode cache is absent", () => {
  const storageRoot = makeTempRoot();
  try {
    const result = syncOfficialPluginsFromLocalZcodeCache({
      officialCacheRoot: join(storageRoot, "not-exist"),
      pluginStorageRoot: storageRoot,
    });
    assert.equal(result.officialCacheFound, false);
    assert.deepEqual(result.synced, []);
  } finally {
    rmSync(storageRoot, { recursive: true, force: true });
  }
});

test("sync copies missing plugins from official cache and writes bundled partition", () => {
  const storageRoot = makeTempRoot();
  const officialCacheRoot = makeTempRoot();
  try {
    seedFakeImageSearchPlugin(officialCacheRoot);
    const result = syncOfficialPluginsFromLocalZcodeCache({
      officialCacheRoot,
      pluginStorageRoot: storageRoot,
    });
    assert.equal(result.officialCacheFound, true);
    assert.ok(result.synced.includes("image-search"));

    const targetRoot = join(storageRoot, "cache", OFFICIAL_MARKETPLACE, "image-search", "0.1.1");
    assert.ok(existsSync(join(targetRoot, ".zcode-plugin", "plugin.json")));
    assert.ok(existsSync(join(targetRoot, ".mcp.json")));
    const marker = JSON.parse(readFileSync(join(targetRoot, MARKER_FILE), "utf8"));
    assert.equal(marker.source, "local-zcode");
    assert.equal(marker.pluginVersion, "0.1.1");

    const partition = JSON.parse(
      readFileSync(
        join(storageRoot, "marketplaces", OFFICIAL_MARKETPLACE, "bundled-marketplace.json"),
        "utf8",
      ),
    ) as { manifest: { plugins: Array<{ name: string; source: string; cachePath: string }> } };
    const entry = partition.manifest.plugins.find((plugin) => plugin.name === "image-search");
    assert.ok(entry, "synced plugin must appear in bundled marketplace partition");
    assert.equal(entry.source, "filesystem");
    assert.ok(entry.cachePath.startsWith(storageRoot));
  } finally {
    rmSync(storageRoot, { recursive: true, force: true });
    rmSync(officialCacheRoot, { recursive: true, force: true });
  }
});

test("sync is idempotent and reports version-missing skips", () => {
  const storageRoot = makeTempRoot();
  const officialCacheRoot = makeTempRoot();
  try {
    seedFakeImageSearchPlugin(officialCacheRoot);
    const first = syncOfficialPluginsFromLocalZcodeCache({
      officialCacheRoot,
      pluginStorageRoot: storageRoot,
    });
    assert.ok(first.synced.includes("image-search"));

    const second = syncOfficialPluginsFromLocalZcodeCache({
      officialCacheRoot,
      pluginStorageRoot: storageRoot,
    });
    assert.deepEqual(second.synced, []);
    const imageSearchSkip = second.skipped.find((entry) => entry.plugin === "image-search");
    assert.equal(imageSearchSkip?.reason, "already-seeded");
    // 官方缓存里只有一个插件；其余定义报版本缺失而非静默消失。
    const documentsSkip = second.skipped.find((entry) => entry.plugin === "documents");
    assert.equal(documentsSkip?.reason, "official-version-missing");
  } finally {
    rmSync(storageRoot, { recursive: true, force: true });
    rmSync(officialCacheRoot, { recursive: true, force: true });
  }
});

test("synced plugin keeps working after the official source directory is removed", () => {
  const storageRoot = makeTempRoot();
  const officialCacheRoot = makeTempRoot();
  try {
    seedFakeImageSearchPlugin(officialCacheRoot);
    const first = syncOfficialPluginsFromLocalZcodeCache({
      officialCacheRoot,
      pluginStorageRoot: storageRoot,
    });
    assert.ok(first.synced.includes("image-search"));

    rmSync(officialCacheRoot, { recursive: true, force: true });

    // 复制产物在 OpenZCode 自身缓存内，来源删除不影响文件与 marker。
    const targetRoot = join(storageRoot, "cache", OFFICIAL_MARKETPLACE, "image-search", "0.1.1");
    assert.ok(existsSync(join(targetRoot, ".mcp.json")));

    // 再次同步：来源消失只影响新复制，不破坏既有缓存（documents 报 found=false 无副作用）。
    const afterRemoval = syncOfficialPluginsFromLocalZcodeCache({
      officialCacheRoot: join(officialCacheRoot, "rebuilt"),
      pluginStorageRoot: storageRoot,
    });
    assert.equal(afterRemoval.officialCacheFound, false);
    assert.ok(existsSync(join(targetRoot, ".mcp.json")));
  } finally {
    rmSync(storageRoot, { recursive: true, force: true });
    rmSync(officialCacheRoot, { recursive: true, force: true });
  }
});

test("sync leaves the official source directory untouched", () => {
  const storageRoot = makeTempRoot();
  const officialCacheRoot = makeTempRoot();
  try {
    seedFakeImageSearchPlugin(officialCacheRoot);
    syncOfficialPluginsFromLocalZcodeCache({
      officialCacheRoot,
      pluginStorageRoot: storageRoot,
    });
    // 一次性复制语义：来源目录只读，seed marker 只写到目标缓存，不回写来源。
    const sourcePluginRoot = join(officialCacheRoot, "image-search", "0.1.1");
    assert.ok(existsSync(join(sourcePluginRoot, ".zcode-plugin", "plugin.json")));
    assert.ok(!existsSync(join(sourcePluginRoot, MARKER_FILE)));
  } finally {
    rmSync(storageRoot, { recursive: true, force: true });
    rmSync(officialCacheRoot, { recursive: true, force: true });
  }
});
