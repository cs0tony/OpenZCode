import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { ZCODE_OFFICIAL_PLUGIN_MARKETPLACE, type Logger } from "@zcode/contracts";
import {
  createOfficialPluginCacheRetryBudget,
  removeOfficialPluginCacheDirectory,
  renameOfficialPluginCachePath,
  writeTextFileAtomicallyWithRetry,
} from "./official-plugin-cache-fs.js";
import { isOfficialPluginSeedLockTimeoutError, withOfficialPluginSeedLock } from "./official-plugin-seed-lock.js";
import { writeOfficialPluginRuntimeManifest } from "./official-plugin-runtime.js";

// 官方内置插件同步历史（specs/official-plugin-sync-history.md）。
// 只覆盖 seed marker source=local-zcode 的缓存目录；本地源（SEA/filesystem）插件
// 由启动 seed 管线维护，不属于历史域。历史根与 cache/ 平级，避开官方缓存目录扫描。

const HISTORY_DIR_NAME = "official-plugin-sync-history";
const INDEX_FILE = "index.json";
const INDEX_VERSION = 1;
const OBJECTS_DIR_NAME = "objects";
const SEED_MARKER_FILE = ".zcode-plugin-seed.json";
const MAX_HISTORY_ENTRIES = 20;
const HISTORY_LOCK_TOTAL_BUDGET_MS = 15_000;

// 进程内单调递增序号：快速连续快照可能落在同一毫秒，拼进 id 保证唯一。
let snapshotIdSequence = 0;

function nextSnapshotId(): string {
  snapshotIdSequence += 1;
  return `${Date.now()}-${snapshotIdSequence.toString(36)}-${Math.random().toString(16).slice(2, 6)}`;
}

/**
 * plugin/version/hash 会被拼进对象库与缓存路径，且可能来自 RPC 参数或手改的 index。
 * 只接受单一路径段且不含 ".."，杜绝路径穿越（防止 existsSync 探测或 cpSync 复制
 * 任意目录进缓存）。
 */
function isSafeStateValue(value: string): boolean {
  return (
    value.length > 0 &&
    !value.includes("/") &&
    !value.includes("\\") &&
    !value.includes("..") &&
    value !== "." &&
    value !== "~"
  );
}

function isSafeHistoryState(state: OfficialSyncHistoryPluginState): boolean {
  return (
    isSafeStateValue(state.plugin) &&
    isSafeStateValue(state.version) &&
    isSafeStateValue(state.hash)
  );
}

export interface OfficialSyncHistoryPluginState {
  plugin: string;
  version: string;
  hash: string;
}

export interface OfficialSyncHistoryEntry {
  id: string;
  createdAt: string;
  kind: "initial" | "pre-sync";
  plugins: OfficialSyncHistoryPluginState[];
}

export interface OfficialSyncHistoryActivationResult {
  activated: string[];
  removed: string[];
  failed: Array<{ plugin: string; reason: string }>;
}

interface OfficialSyncHistoryIndex {
  version: number;
  entries: OfficialSyncHistoryEntry[];
}

interface LocalZcodePluginDir {
  hash: string;
  path: string;
  plugin: string;
  version: string;
}

function historyRoot(pluginStorageRoot: string): string {
  return join(pluginStorageRoot, HISTORY_DIR_NAME);
}

function objectsRoot(pluginStorageRoot: string): string {
  return join(historyRoot(pluginStorageRoot), OBJECTS_DIR_NAME);
}

function officialCacheRootPath(pluginStorageRoot: string): string {
  return join(pluginStorageRoot, "cache", ZCODE_OFFICIAL_PLUGIN_MARKETPLACE);
}

function objectPathFor(
  pluginStorageRoot: string,
  state: OfficialSyncHistoryPluginState,
): string {
  return join(objectsRoot(pluginStorageRoot), state.plugin, state.version, state.hash);
}

function readIndex(pluginStorageRoot: string, logger?: Logger): OfficialSyncHistoryIndex {
  // 历史是便利数据而非事实源：index 损坏时按空历史降级（warn），同步仍可继续；
  // 激活依赖 entryId 解析，损坏时自然因找不到条目而失败。
  try {
    const parsed = JSON.parse(
      readFileSync(join(historyRoot(pluginStorageRoot), INDEX_FILE), "utf8"),
    ) as OfficialSyncHistoryIndex;
    if (
      parsed?.version === INDEX_VERSION &&
      Array.isArray(parsed.entries) &&
      parsed.entries.every(isValidEntry)
    ) {
      return parsed;
    }
  } catch (error) {
    logger?.warn("Official plugin sync history index unreadable, treating as empty", {
      module: "bootstrap.official_plugin_sync_history",
      operation: "read_index",
      error: error instanceof Error ? error.message : String(error),
    });
    return { version: INDEX_VERSION, entries: [] };
  }
  logger?.warn("Official plugin sync history index malformed, treating as empty", {
    module: "bootstrap.official_plugin_sync_history",
    operation: "read_index",
  });
  return { version: INDEX_VERSION, entries: [] };
}

function isValidEntry(value: unknown): value is OfficialSyncHistoryEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<OfficialSyncHistoryEntry>;
  return (
    typeof entry.id === "string" &&
    entry.id.length > 0 &&
    typeof entry.createdAt === "string" &&
    (entry.kind === "initial" || entry.kind === "pre-sync") &&
    Array.isArray(entry.plugins) &&
    entry.plugins.every(
      (state) =>
        typeof state?.plugin === "string" &&
        typeof state?.version === "string" &&
        typeof state?.hash === "string",
    )
  );
}

function writeIndex(pluginStorageRoot: string, index: OfficialSyncHistoryIndex): void {
  const budget = createOfficialPluginCacheRetryBudget();
  const indexPath = join(historyRoot(pluginStorageRoot), INDEX_FILE);
  // 首次快照时历史根可能尚不存在（空扫描不会先写任何对象目录）。
  mkdirSync(dirname(indexPath), { recursive: true });
  writeTextFileAtomicallyWithRetry(indexPath, `${JSON.stringify(index, null, 2)}\n`, budget);
}

/** 扫描官方缓存下全部 local-zcode 目录（含 dormant 旧版本目录），按插件名分组。 */
function scanLocalZcodePluginDirs(
  pluginStorageRoot: string,
): Map<string, LocalZcodePluginDir[]> {
  const grouped = new Map<string, LocalZcodePluginDir[]>();
  const cacheRoot = officialCacheRootPath(pluginStorageRoot);
  let pluginEntries;
  try {
    pluginEntries = readdirSync(cacheRoot, { withFileTypes: true });
  } catch {
    return grouped;
  }
  for (const pluginEntry of pluginEntries) {
    if (!pluginEntry.isDirectory()) continue;
    let versionEntries;
    try {
      versionEntries = readdirSync(join(cacheRoot, pluginEntry.name), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const versionEntry of versionEntries) {
      if (!versionEntry.isDirectory()) continue;
      const dirPath = join(cacheRoot, pluginEntry.name, versionEntry.name);
      const marker = readSeedMarker(dirPath);
      if (marker?.source !== "local-zcode" || marker.hash === undefined) continue;
      // 记录前做最小可用性校验：manifest 存在且 name 与目录一致，避免把残缺目录
      // 备份成"看起来可恢复"的历史。
      if (!isLocalZcodeDirSelfConsistent(dirPath, pluginEntry.name)) continue;
      const dirs = grouped.get(pluginEntry.name) ?? [];
      dirs.push({
        hash: marker.hash,
        path: dirPath,
        plugin: pluginEntry.name,
        version: versionEntry.name,
      });
      grouped.set(pluginEntry.name, dirs);
    }
  }
  return grouped;
}

function readSeedMarker(dirPath: string): { hash?: string; source?: string } | undefined {
  try {
    const marker = JSON.parse(readFileSync(join(dirPath, SEED_MARKER_FILE), "utf8")) as {
      hash?: unknown;
      source?: unknown;
    };
    return {
      ...(typeof marker.hash === "string" ? { hash: marker.hash } : {}),
      ...(typeof marker.source === "string" ? { source: marker.source } : {}),
    };
  } catch {
    return undefined;
  }
}

function isLocalZcodeDirSelfConsistent(dirPath: string, expectedName: string): boolean {
  try {
    const manifest = JSON.parse(
      readFileSync(join(dirPath, ".zcode-plugin", "plugin.json"), "utf8"),
    ) as { name?: unknown };
    return manifest.name === expectedName;
  } catch {
    return false;
  }
}

function toDirStateMap(
  scan: Map<string, LocalZcodePluginDir[]>,
): OfficialSyncHistoryPluginState[] {
  return [...scan.values()]
    .flat()
    .map((dir) => ({ hash: dir.hash, plugin: dir.plugin, version: dir.version }))
    .sort((left, right) => left.plugin.localeCompare(right.plugin));
}

/**
 * 同步前快照：把当前全部 local-zcode 目录的内容按 (plugin, version, hash) 去重存入
 * 对象库，并追加一条历史条目（含保留策略裁剪与对象 GC）。
 * 任何对象复制/索引写入失败都向上抛错，由调用方决定中止同步（不允许没备份就改缓存）。
 */
export function recordOfficialPluginSyncHistorySnapshot(input: {
  logger?: Logger;
  pluginStorageRoot: string;
}): OfficialSyncHistoryEntry {
  const { pluginStorageRoot, logger } = input;
  return withOfficialPluginSeedLock(historyRoot(pluginStorageRoot), () => {
    const scan = scanLocalZcodePluginDirs(pluginStorageRoot);
    for (const dir of [...scan.values()].flat()) {
      const objectPath = objectPathFor(pluginStorageRoot, dir);
      if (existsSync(objectPath)) continue;
      // 先拷贝到同父目录的临时目录再改名，避免进程中断留下被 existsSync 误判
      // 为完整的残缺对象。
      const temporaryPath = `${objectPath}.tmp-${process.pid}-${Date.now()}`;
      try {
        mkdirSync(dirname(objectPath), { recursive: true });
        cpSync(dir.path, temporaryPath, { force: true, recursive: true });
        renameOfficialPluginCachePath(temporaryPath, objectPath, createOfficialPluginCacheRetryBudget());
      } catch (error) {
        try {
          rmSync(temporaryPath, { force: true, recursive: true });
        } catch {
          // 临时目录清理失败不覆盖真正的复制错误；目录名唯一不会污染后续对象。
        }
        throw error;
      }
    }

    const index = readIndex(pluginStorageRoot, logger);
    const entry: OfficialSyncHistoryEntry = {
      createdAt: new Date().toISOString(),
      id: nextSnapshotId(),
      kind: index.entries.length === 0 ? "initial" : "pre-sync",
      plugins: toDirStateMap(scan),
    };
    index.entries.push(entry);
    // 保留策略：裁掉最旧条目，GC 不再被任何条目引用的对象。
    index.entries = index.entries.slice(-MAX_HISTORY_ENTRIES);
    writeIndex(pluginStorageRoot, index);
    garbageCollectUnreferencedObjects(pluginStorageRoot, index, logger);
    logger?.info("Recorded official plugin sync history snapshot", {
      entryId: entry.id,
      kind: entry.kind,
      module: "bootstrap.official_plugin_sync_history",
      pluginCount: entry.plugins.length,
    });
    return entry;
  });
}

function garbageCollectUnreferencedObjects(
  pluginStorageRoot: string,
  index: OfficialSyncHistoryIndex,
  logger?: Logger,
): void {
  const referenced = new Set(
    index.entries.flatMap((entry) =>
      entry.plugins.map((state) => objectKey(pluginStorageRoot, state)),
    ),
  );
  let objectsEntries;
  try {
    objectsEntries = readdirSync(objectsRoot(pluginStorageRoot), { withFileTypes: true });
  } catch {
    return;
  }
  for (const pluginEntry of objectsEntries) {
    if (!pluginEntry.isDirectory()) continue;
    const pluginDir = join(objectsRoot(pluginStorageRoot), pluginEntry.name);
    for (const versionEntry of readdirSync(pluginDir, { withFileTypes: true })) {
      if (!versionEntry.isDirectory()) continue;
      const versionDir = join(pluginDir, versionEntry.name);
      for (const hashEntry of readdirSync(versionDir, { withFileTypes: true })) {
        if (!hashEntry.isDirectory()) continue;
        const hashDir = join(versionDir, hashEntry.name);
        if (referenced.has(hashDir)) continue;
        try {
          removeOfficialPluginCacheDirectory(hashDir);
          removeEmptyAncestors(hashDir, objectsRoot(pluginStorageRoot));
        } catch (error) {
          logger?.warn("Failed to garbage-collect unreferenced sync history object", {
            module: "bootstrap.official_plugin_sync_history",
            objectPath: hashDir,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }
}

function objectKey(pluginStorageRoot: string, state: OfficialSyncHistoryPluginState): string {
  return objectPathFor(pluginStorageRoot, state);
}

function removeEmptyAncestors(startPath: string, stopAtPath: string): void {
  let current = dirname(startPath);
  const stop = dirname(stopAtPath);
  while (current.startsWith(stop) && current !== stop) {
    let entries;
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }
    if (entries.length > 0) return;
    try {
      rmSync(current, { force: true, recursive: true });
    } catch {
      return;
    }
    current = dirname(current);
  }
}

export function listOfficialPluginSyncHistory(input: {
  pluginStorageRoot: string;
}): {
  active: OfficialSyncHistoryPluginState[];
  current: OfficialSyncHistoryPluginState[];
  entries: OfficialSyncHistoryEntry[];
} {
  const index = readIndex(input.pluginStorageRoot);
  const scan = scanLocalZcodePluginDirs(input.pluginStorageRoot);
  return {
    active: readActiveStatesFromPartition(input.pluginStorageRoot, scan),
    current: toDirStateMap(scan),
    entries: index.entries,
  };
}

/**
 * bundled 分片是插件加载的权威清单（scanOfficialCache 语义）。"当前状态"以分片里
 * 实际列出、且缓存目录带 local-zcode marker 的条目为准；分片缺失/损坏时降级为空
 * （UI 只是少了"当前"徽标，不影响激活操作）。
 */
function readActiveStatesFromPartition(
  pluginStorageRoot: string,
  scan: Map<string, LocalZcodePluginDir[]>,
): OfficialSyncHistoryPluginState[] {
  let raw: unknown;
  try {
    raw = JSON.parse(
      readFileSync(
        join(
          pluginStorageRoot,
          "marketplaces",
          ZCODE_OFFICIAL_PLUGIN_MARKETPLACE,
          "bundled-marketplace.json",
        ),
        "utf8",
      ),
    );
  } catch {
    return [];
  }
  const manifest = (raw as { manifest?: { plugins?: unknown } } | null)?.manifest;
  if (!Array.isArray(manifest?.plugins)) return [];
  // cachePath 必须落在该插件自己的缓存目录树内（与 adapter 的 strict-descendant
  // 校验同型），防止被篡改的分片把 marker 读取引到任意路径。
  const officialCacheRoot = officialCacheRootPath(pluginStorageRoot);
  const active: OfficialSyncHistoryPluginState[] = [];
  for (const entry of manifest.plugins) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as { cachePath?: unknown; name?: unknown; version?: unknown };
    if (
      typeof record.name !== "string" ||
      typeof record.version !== "string" ||
      typeof record.cachePath !== "string" ||
      !isSafeStateValue(record.name) ||
      !isSafeStateValue(record.version)
    ) {
      continue;
    }
    const expectedDir = join(officialCacheRoot, record.name, record.version);
    if (record.cachePath !== expectedDir) continue;
    const marker = readSeedMarker(record.cachePath);
    if (marker?.source !== "local-zcode" || marker.hash === undefined) continue;
    // cachePath 还要与磁盘扫描结果一致才算当前。
    const onDisk = scan.get(record.name)?.find(
      (dir) => dir.version === record.version && dir.hash === marker.hash,
    );
    if (!onDisk) continue;
    active.push({ hash: marker.hash, plugin: record.name, version: record.version });
  }
  return active.sort((left, right) => left.plugin.localeCompare(right.plugin));
}

/** 按 entryId 激活历史状态；entryId 不存在时抛错（RPC reject，由 UI 提示）。 */
export function activateOfficialSyncHistoryEntry(input: {
  entryId: string;
  logger?: Logger;
  pluginStorageRoot: string;
}): OfficialSyncHistoryActivationResult {
  const index = readIndex(input.pluginStorageRoot);
  const entry = index.entries.find((candidate) => candidate.id === input.entryId);
  if (!entry) {
    throw Object.assign(new Error(`Sync history entry not found: ${input.entryId}`), {
      code: "ZCODE_PLUGIN_SYNC_HISTORY_ENTRY_NOT_FOUND",
    });
  }
  return activateOfficialSyncHistoryStates({
    desired: entry.plugins,
    logger: input.logger,
    pluginStorageRoot: input.pluginStorageRoot,
  });
}

/**
 * 单插件回退：version/hash 同缺表示"移除此插件"（desired 对该插件为空）。
 * 目标 (version, hash) 必须可从对象库物化，或当前目录已经一致。
 */
export function activateOfficialPluginHistoryVersion(input: {
  hash?: string;
  logger?: Logger;
  plugin: string;
  pluginStorageRoot: string;
  version?: string;
}): OfficialSyncHistoryActivationResult {
  const explicit = input.version !== undefined || input.hash !== undefined;
  if (explicit !== (input.version !== undefined && input.hash !== undefined)) {
    throw Object.assign(
      new Error("version and hash must be provided together for plugin history activation"),
      { code: "ZCODE_PLUGIN_SYNC_HISTORY_INVALID_TARGET" },
    );
  }
  const desired: OfficialSyncHistoryPluginState[] =
    input.version !== undefined && input.hash !== undefined
      ? [{ hash: input.hash, plugin: input.plugin, version: input.version }]
      : [];
  if (desired.length === 1 && !isSafeHistoryState(desired[0]!)) {
    throw Object.assign(new Error("Invalid plugin history target"), {
      code: "ZCODE_PLUGIN_SYNC_HISTORY_INVALID_TARGET",
    });
  }
  if (!isSafeStateValue(input.plugin)) {
    throw Object.assign(new Error("Invalid plugin history target"), {
      code: "ZCODE_PLUGIN_SYNC_HISTORY_INVALID_TARGET",
    });
  }
  const objectExists =
    desired.length === 0 ||
    existsSync(objectPathFor(input.pluginStorageRoot, desired[0]!));
  const currentMatches = scanLocalZcodePluginDirs(input.pluginStorageRoot).get(input.plugin);
  if (!objectExists && !currentMatches?.some((dir) => desired[0] && dir.hash === desired[0].hash && dir.version === desired[0].version)) {
    throw Object.assign(
      new Error(`Sync history object not found for ${input.plugin}@${input.version}`),
      { code: "ZCODE_PLUGIN_SYNC_HISTORY_OBJECT_MISSING" },
    );
  }
  return activateOfficialSyncHistoryStates({
    desired,
    logger: input.logger,
    pluginStorageRoot: input.pluginStorageRoot,
  });
}

/**
 * 目录对账核心：把 local-zcode 缓存目录集合恢复为 desired 的状态。
 * 只增删 local-zcode 目录（按 marker 识别），不触碰本地源目录与 installed_plugins；
 * 分片重建由调用方经 bundled-plugins 的启动管线完成。
 */
function activateOfficialSyncHistoryStates(input: {
  desired: ReadonlyArray<OfficialSyncHistoryPluginState>;
  logger?: Logger;
  pluginStorageRoot: string;
}): OfficialSyncHistoryActivationResult {
  const { pluginStorageRoot, logger } = input;
  const result: OfficialSyncHistoryActivationResult = { activated: [], failed: [], removed: [] };
  return withOfficialPluginSeedLock(historyRoot(pluginStorageRoot), () => {
    const scan = scanLocalZcodePluginDirs(pluginStorageRoot);
    const deadlineAt = Date.now() + HISTORY_LOCK_TOTAL_BUDGET_MS;
    const desiredByPlugin = new Map(
      input.desired
        .filter((state) => {
          if (isSafeHistoryState(state)) return true;
          result.failed.push({ plugin: state.plugin, reason: "invalid-target" });
          return false;
        })
        .map((state) => [state.plugin, state] as const),
    );

    for (const state of desiredByPlugin.values()) {
      try {
        const dirs = scan.get(state.plugin) ?? [];
        for (const dir of dirs) {
          if (dir.version === state.version && dir.hash === state.hash) continue;
          removeSyncedPluginDirWithSeedLock(dir, deadlineAt);
        }
        const targetRoot = join(officialCacheRootPath(pluginStorageRoot), state.plugin, state.version);
        const current = dirs.find(
          (dir) => dir.version === state.version && dir.hash === state.hash,
        );
        if (current && isLocalZcodeDirSelfConsistent(current.path, state.plugin)) {
          ensureRuntimeManifest(state, current.path, logger);
        } else {
          materializeFromObject({ logger, pluginStorageRoot, state, targetRoot, deadlineAt });
        }
        result.activated.push(state.plugin);
      } catch (error) {
        result.failed.push({
          plugin: state.plugin,
          reason: describeActivationFailure(error),
        });
      }
    }

    for (const [plugin, dirs] of scan) {
      if (desiredByPlugin.has(plugin)) continue;
      let removedAll = true;
      for (const dir of dirs) {
        try {
          removeSyncedPluginDirWithSeedLock(dir, deadlineAt);
        } catch (error) {
          removedAll = false;
          result.failed.push({
            plugin,
            reason: describeActivationFailure(error),
          });
        }
      }
      if (removedAll) result.removed.push(plugin);
    }
    logger?.info("Activated official plugin sync history state", {
      activated: result.activated,
      failed: result.failed,
      module: "bootstrap.official_plugin_sync_history",
      removed: result.removed,
    });
    return result;
  });
}

function removeSyncedPluginDirWithSeedLock(
  dir: LocalZcodePluginDir,
  deadlineAt: number,
): void {
  withOfficialPluginSeedLock(
    dir.path,
    () => removeOfficialPluginCacheDirectory(dir.path),
    { timeoutMs: Math.max(0, deadlineAt - Date.now()) },
  );
}

function materializeFromObject(input: {
  deadlineAt: number;
  logger?: Logger;
  pluginStorageRoot: string;
  state: OfficialSyncHistoryPluginState;
  targetRoot: string;
}): void {
  const objectPath = objectPathFor(input.pluginStorageRoot, input.state);
  if (!existsSync(objectPath)) {
    throw Object.assign(
      new Error(`Sync history object not found for ${input.state.plugin}@${input.state.version}`),
      { code: "ZCODE_PLUGIN_SYNC_HISTORY_OBJECT_MISSING" },
    );
  }
  withOfficialPluginSeedLock(
    input.targetRoot,
    () => {
      // 拿锁后二次检查：并发进程可能刚好物化了同一目录。
      const marker = readSeedMarker(input.targetRoot);
      if (marker?.hash === input.state.hash && marker.source === "local-zcode") {
        ensureRuntimeManifest(input.state, input.targetRoot, input.logger);
        return;
      }
      const temporaryRoot = `${input.targetRoot}.tmp-${process.pid}-${Date.now()}`;
      removeOfficialPluginCacheDirectory(temporaryRoot);
      try {
        mkdirSync(dirname(input.targetRoot), { recursive: true });
        cpSync(objectPath, temporaryRoot, { force: true, recursive: true });
        renameOfficialPluginCachePath(temporaryRoot, input.targetRoot, createOfficialPluginCacheRetryBudget());
        ensureRuntimeManifest(input.state, input.targetRoot, input.logger);
      } catch (error) {
        try {
          removeOfficialPluginCacheDirectory(temporaryRoot);
        } catch {
          // 临时目录清理失败不覆盖真正的物化错误；目录名唯一不会污染后续加载。
        }
        throw error;
      }
    },
    { timeoutMs: Math.max(0, input.deadlineAt - Date.now()) },
  );
}

/** 对象库副本里的 plugin.json 可能带旧运行时的 MCP command，物化后必须重写。 */
function ensureRuntimeManifest(
  state: OfficialSyncHistoryPluginState,
  rootPath: string,
  logger?: Logger,
): void {
  try {
    writeOfficialPluginRuntimeManifest({
      pluginName: state.plugin,
      retryBudget: createOfficialPluginCacheRetryBudget(),
      rootPath,
    });
  } catch (error) {
    // manifest 重写是尽力而为：对象内容本身完整，重写失败只影响 MCP server 的
    // 运行时路径指向，不应让整个回退失败。
    logger?.warn("Failed to rewrite runtime manifest for restored plugin", {
      module: "bootstrap.official_plugin_sync_history",
      pluginId: state.plugin,
      rootPath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function describeActivationFailure(error: unknown): string {
  if (isOfficialPluginSeedLockTimeoutError(error)) return "lock-timeout";
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (typeof code === "string" && code.startsWith("ZCODE_PLUGIN_SYNC_HISTORY")) return code;
  return error instanceof Error ? error.message : String(error);
}
