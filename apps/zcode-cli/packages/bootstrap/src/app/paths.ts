import { homedir } from "node:os";
import { basename, join } from "node:path";
import { createProjectId, type ProjectId } from "@zcode/contracts";
import { OFFICIAL_ZCODE_DATA_DIR_NAME } from "@zcode/shared";
import { resolveProjectMemoryRoot } from "@zcode/core";

export function getCliStorageRoot(storageRoot: string): string {
  return basename(storageRoot) === "cli" ? storageRoot : join(storageRoot, "cli");
}

export function getPluginStorageRoot(cliStorageRoot: string): string {
  return join(cliStorageRoot, "plugins");
}

/**
 * 官方 ZCode 的官方插件缓存根（~/.zcode/cli/plugins/cache/zcode-plugins-official）。
 * 仅服务于"从本地 ZCode 复制内置插件"的一次性只读场景
 * （specs/sync-official-plugins-from-local-zcode.md）。目录名常量以 shared 的
 * OFFICIAL_ZCODE_DATA_DIR_NAME 为唯一所有者；市场目录名与
 * @zcode/contracts 的 ZCODE_OFFICIAL_PLUGIN_MARKETPLACE 一致。
 * 必须留在 bootstrap（node:os 导入不可进渲染层可达的 shared 包）。
 */
export function resolveOfficialZcodePluginCacheRoot(): string {
  return join(
    homedir(),
    OFFICIAL_ZCODE_DATA_DIR_NAME,
    "cli",
    "plugins",
    "cache",
    "zcode-plugins-official",
  );
}

export function getModelIoDir(cliStorageRoot: string, isDevelopment: boolean): string {
  return join(cliStorageRoot, isDevelopment ? "debug" : "rollout");
}

export function getProjectMemoryRoot(
  cliStorageRoot: string,
  workingDirectory: string,
  workspaceIdentity?: string,
): string {
  return resolveProjectMemoryRoot({
    cliStorageRoot,
    workspaceIdentity,
    workspacePath: workingDirectory,
  });
}

export function projectIdFromDirectory(directory: string): ProjectId {
  return createProjectId(
    directory
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "default",
  );
}
