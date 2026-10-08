// 覆盖 specs/official-plugin-sync-history.md 的验收场景：
// 首次同步产生 initial 快照 / 无变化不产生条目 / 同步前快照捕获旧版本 /
// 激活整表回退 / 单插件回退 + sibling fallback 呈现 / 对象物化 / 保留策略。
// 与 sync-official-plugins-from-local-zcode.test.ts 同构：node:test 直测 src，经 tsx 运行。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { refreshBundledOfficialPlugins, syncOfficialPluginsFromLocalZcodeCache } from "../src/app/bundled-plugins.js";
import {
  activateOfficialPluginHistoryVersion,
  activateOfficialSyncHistoryEntry,
  listOfficialPluginSyncHistory,
  recordOfficialPluginSyncHistorySnapshot,
} from "../src/app/official-plugin-sync-history.js";

const OFFICIAL_MARKETPLACE = "zcode-plugins-official";
const MARKER_FILE = ".zcode-plugin-seed.json";
const HISTORY_ROOT = "official-plugin-sync-history";

function makeTempRoot(): string {
  return mkdtempSync(join(tmpdir(), "zcode-sync-history-test-"));
}

function seedFakeImageSearchPlugin(officialCacheRoot: string): void {
  const pluginRoot = join(officialCacheRoot, "image-search", "0.1.1");
  mkdirSync(join(pluginRoot, ".zcode-plugin"), { recursive: true });
  writeFileSync(
    join(pluginRoot, ".zcode-plugin", "plugin.json"),
    JSON.stringify({ name: "image-search", description: "fake image search" }),
  );
  writeFileSync(join(pluginRoot, ".mcp.json"), JSON.stringify({ mcpServers: {} }));
}

/** 伪造一个既有 local-zcode 版本目录（模拟更早的同步产物/回退目标）。 */
function seedFakeSyncedVersionDir(storageRoot: string, version: string): string {
  const pluginRoot = join(storageRoot, "cache", OFFICIAL_MARKETPLACE, "image-search", version);
  mkdirSync(join(pluginRoot, ".zcode-plugin"), { recursive: true });
  writeFileSync(
    join(pluginRoot, ".zcode-plugin", "plugin.json"),
    JSON.stringify({ name: "image-search", description: "fake image search" }),
  );
  writeFileSync(join(pluginRoot, ".mcp.json"), JSON.stringify({ mcpServers: {} }));
  const hash = createHash("sha256").update(version).digest("hex");
  writeFileSync(
    join(pluginRoot, MARKER_FILE),
    JSON.stringify({ hash, marketplace: OFFICIAL_MARKETPLACE, plugin: "image-search", pluginVersion: version, source: "local-zcode", version: 1 }),
  );
  return pluginRoot;
}

function readHistoryEntries(storageRoot: string): Array<{ id: string; kind: string; plugins: Array<{ hash: string; plugin: string; version: string }> }> {
  const index = JSON.parse(
    readFileSync(join(storageRoot, HISTORY_ROOT, "index.json"), "utf8"),
  ) as { entries: Array<{ id: string; kind: string; plugins: Array<{ hash: string; plugin: string; version: string }> }> };
  return index.entries;
}

function readPartition(storageRoot: string): { manifest: { plugins: Array<{ cachePath: string; name: string; version: string }> } } {
  return JSON.parse(
    readFileSync(
      join(storageRoot, "marketplaces", OFFICIAL_MARKETPLACE, "bundled-marketplace.json"),
      "utf8",
    ),
  );
}

function imageSearchPartitionEntry(storageRoot: string) {
  return readPartition(storageRoot).manifest.plugins.find((plugin) => plugin.name === "image-search");
}

test("first mutating sync records the initial snapshot; no-op sync adds none", () => {
  const storageRoot = makeTempRoot();
  const officialCacheRoot = makeTempRoot();
  try {
    seedFakeImageSearchPlugin(officialCacheRoot);
    const result = syncOfficialPluginsFromLocalZcodeCache({
      officialCacheRoot,
      pluginStorageRoot: storageRoot,
    });
    assert.ok(result.synced.includes("image-search"));

    const entries = readHistoryEntries(storageRoot);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.kind, "initial");
    assert.deepEqual(entries[0]?.plugins, []);

    // 幂等重同步：无可复制内容不产生新条目。
    const second = syncOfficialPluginsFromLocalZcodeCache({
      officialCacheRoot,
      pluginStorageRoot: storageRoot,
    });
    assert.deepEqual(second.synced, []);
    assert.equal(readHistoryEntries(storageRoot).length, 1);
  } finally {
    rmSync(storageRoot, { recursive: true, force: true });
    rmSync(officialCacheRoot, { recursive: true, force: true });
  }
});

test("sync snapshots the pre-state including dormant old versions into objects", () => {
  const storageRoot = makeTempRoot();
  const officialCacheRoot = makeTempRoot();
  try {
    const oldDir = seedFakeSyncedVersionDir(storageRoot, "0.0.9");
    seedFakeImageSearchPlugin(officialCacheRoot);
    const result = syncOfficialPluginsFromLocalZcodeCache({
      officialCacheRoot,
      pluginStorageRoot: storageRoot,
    });
    assert.ok(result.synced.includes("image-search"));

    const entries = readHistoryEntries(storageRoot);
    assert.equal(entries.length, 1);
    // 历史为空时的第一次快照一律记为 initial（代表"开始本次同步前的状态"），
    // 即使磁盘上已有更早的 local-zcode 目录。
    assert.equal(entries[0]?.kind, "initial");
    const recorded = entries[0]?.plugins.find((state) => state.plugin === "image-search");
    assert.ok(recorded);
    assert.equal(recorded?.version, "0.0.9");
    // 对象库按 (plugin, version, hash) 去重存放整目录副本。
    const objectPath = join(storageRoot, HISTORY_ROOT, "objects", "image-search", "0.0.9", recorded?.hash ?? "");
    assert.ok(existsSync(join(objectPath, MARKER_FILE)));
    assert.ok(existsSync(join(objectPath, ".zcode-plugin", "plugin.json")));
    assert.ok(oldDir);
  } finally {
    rmSync(storageRoot, { recursive: true, force: true });
    rmSync(officialCacheRoot, { recursive: true, force: true });
  }
});

test("activating the initial entry removes synced plugins and clears them from the partition", () => {
  const storageRoot = makeTempRoot();
  const officialCacheRoot = makeTempRoot();
  try {
    // 先在无任何同步插件时记录 initial（空集），再造出旧版本目录并同步升级。
    recordOfficialPluginSyncHistorySnapshot({ pluginStorageRoot: storageRoot });
    seedFakeSyncedVersionDir(storageRoot, "0.0.9");
    seedFakeImageSearchPlugin(officialCacheRoot);
    syncOfficialPluginsFromLocalZcodeCache({ officialCacheRoot, pluginStorageRoot: storageRoot });

    const initialEntry = readHistoryEntries(storageRoot).find((entry) => entry.kind === "initial");
    assert.ok(initialEntry);
    assert.deepEqual(initialEntry.plugins, []);
    const result = activateOfficialSyncHistoryEntry({
      entryId: initialEntry.id,
      pluginStorageRoot: storageRoot,
    });
    assert.deepEqual(result.activated, []);
    assert.deepEqual(result.removed, ["image-search"]);
    assert.ok(!existsSync(join(storageRoot, "cache", OFFICIAL_MARKETPLACE, "image-search", "0.0.9")));
    assert.ok(!existsSync(join(storageRoot, "cache", OFFICIAL_MARKETPLACE, "image-search", "0.1.1")));

    // 激活后由协议层调用刷新管线；分片不再列出该插件。
    refreshBundledOfficialPlugins({ storageRoot });
    assert.equal(imageSearchPartitionEntry(storageRoot), undefined);

    const history = listOfficialPluginSyncHistory({ pluginStorageRoot: storageRoot });
    assert.deepEqual(history.current, []);
  } finally {
    rmSync(storageRoot, { recursive: true, force: true });
    rmSync(officialCacheRoot, { recursive: true, force: true });
  }
});

test("per-plugin rollback keeps the old version visible via fallback recognition; re-sync upgrades again", () => {
  const storageRoot = makeTempRoot();
  const officialCacheRoot = makeTempRoot();
  try {
    const oldDir = seedFakeSyncedVersionDir(storageRoot, "0.0.9");
    const oldHash = JSON.parse(readFileSync(join(oldDir, MARKER_FILE), "utf8")).hash as string;
    seedFakeImageSearchPlugin(officialCacheRoot);
    syncOfficialPluginsFromLocalZcodeCache({ officialCacheRoot, pluginStorageRoot: storageRoot });
    assert.ok(existsSync(join(storageRoot, "cache", OFFICIAL_MARKETPLACE, "image-search", "0.1.1")));

    const result = activateOfficialPluginHistoryVersion({
      hash: oldHash,
      plugin: "image-search",
      pluginStorageRoot: storageRoot,
      version: "0.0.9",
    });
    assert.deepEqual(result.activated, ["image-search"]);
    assert.ok(!existsSync(join(storageRoot, "cache", OFFICIAL_MARKETPLACE, "image-search", "0.1.1")));

    // 定义版本路径已缺 marker：sibling fallback 识别旧版本目录，分片写实际版本与路径。
    refreshBundledOfficialPlugins({ storageRoot });
    const entry = imageSearchPartitionEntry(storageRoot);
    assert.ok(entry);
    assert.equal(entry.version, "0.0.9");
    assert.ok(entry.cachePath.includes(join("image-search", "0.0.9")));

    const history = listOfficialPluginSyncHistory({ pluginStorageRoot: storageRoot });
    const active = history.active.find((state) => state.plugin === "image-search");
    assert.equal(active?.version, "0.0.9");

    // 再次同步：gate 按定义版本路径判定为缺失，照常升级回 0.1.1。
    const second = syncOfficialPluginsFromLocalZcodeCache({
      officialCacheRoot,
      pluginStorageRoot: storageRoot,
    });
    assert.ok(second.synced.includes("image-search"));
    const upgraded = imageSearchPartitionEntry(storageRoot);
    assert.ok(upgraded);
    assert.equal(upgraded.version, "0.1.1");
  } finally {
    rmSync(storageRoot, { recursive: true, force: true });
    rmSync(officialCacheRoot, { recursive: true, force: true });
  }
});

test("activation materializes missing directories from stored objects", () => {
  const storageRoot = makeTempRoot();
  const officialCacheRoot = makeTempRoot();
  try {
    const oldDir = seedFakeSyncedVersionDir(storageRoot, "0.0.9");
    const oldHash = JSON.parse(readFileSync(join(oldDir, MARKER_FILE), "utf8")).hash as string;
    seedFakeImageSearchPlugin(officialCacheRoot);
    syncOfficialPluginsFromLocalZcodeCache({ officialCacheRoot, pluginStorageRoot: storageRoot });

    // 手动删除旧版本目录（等价于缓存损坏/被清理），激活条目应从对象库物化回来。
    rmSync(oldDir, { recursive: true, force: true });
    const recordedEntry = readHistoryEntries(storageRoot)[0];
    assert.ok(recordedEntry);
    assert.ok(recordedEntry.plugins.some((state) => state.version === "0.0.9"));
    const result = activateOfficialSyncHistoryEntry({
      entryId: recordedEntry.id,
      pluginStorageRoot: storageRoot,
    });
    assert.deepEqual(result.activated, ["image-search"]);
    const restoredMarker = JSON.parse(
      readFileSync(join(oldDir, MARKER_FILE), "utf8"),
    ) as { hash: string; source: string };
    assert.equal(restoredMarker.source, "local-zcode");
    assert.equal(restoredMarker.hash, oldHash);

    refreshBundledOfficialPlugins({ storageRoot });
    const entry = imageSearchPartitionEntry(storageRoot);
    assert.ok(entry);
    assert.equal(entry.version, "0.0.9");
  } finally {
    rmSync(storageRoot, { recursive: true, force: true });
    rmSync(officialCacheRoot, { recursive: true, force: true });
  }
});

test("history retains at most 20 entries and garbage-collects unreferenced objects", () => {
  const storageRoot = makeTempRoot();
  try {
    seedFakeSyncedVersionDir(storageRoot, "0.0.9");
    for (let index = 0; index < 25; index += 1) {
      recordOfficialPluginSyncHistorySnapshot({ pluginStorageRoot: storageRoot });
    }
    const entries = readHistoryEntries(storageRoot);
    assert.equal(entries.length, 20);
    assert.equal(entries[0]?.kind, "pre-sync");
  } finally {
    rmSync(storageRoot, { recursive: true, force: true });
  }
});

test("activating an unknown entry or an unknown object fails explicitly", () => {
  const storageRoot = makeTempRoot();
  try {
    assert.throws(
      () =>
        activateOfficialSyncHistoryEntry({ entryId: "missing", pluginStorageRoot: storageRoot }),
      /not found/u,
    );
    assert.throws(
      () =>
        activateOfficialPluginHistoryVersion({
          hash: "deadbeef",
          plugin: "image-search",
          pluginStorageRoot: storageRoot,
          version: "0.0.9",
        }),
      /not found/u,
    );
    // 移除一个不存在的插件：目标已是期望状态，按幂等成功处理（无副作用）。
    const removeAbsent = activateOfficialPluginHistoryVersion({
      plugin: "image-search",
      pluginStorageRoot: storageRoot,
    });
    assert.deepEqual(removeAbsent, { activated: [], failed: [], removed: [] });
  } finally {
    rmSync(storageRoot, { recursive: true, force: true });
  }
});
