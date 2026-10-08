// 同步历史（specs/official-plugin-sync-history.md）的 store 切片：
// 缓存、懒加载与激活动作。独立成文件与 pluginManagementStoreLoading/Enabled 同理，
// 避免主 store 超出 max-lines 且保持领域内聚。
import type {
  ZCodeOfficialSyncHistoryEntry,
  ZCodeOfficialSyncHistoryPluginState,
} from "@zcode/shared";
import type { IPluginManagementService } from "@zcode/services";
import { logger } from "@/logger.js";
import { runWorkspaceOperation } from "@/store/pluginManagementStoreLoading.js";
import type { PluginManagementState } from "@/store/pluginManagementStore.js";

export interface OfficialSyncHistoryCache {
  /** bundled 分片当前实际列出的 local-zcode 状态（"当前"徽标以此为准）。 */
  active: ZCodeOfficialSyncHistoryPluginState[];
  /** 磁盘上全部 local-zcode 目录（含未列入分片的旧版本目录）。 */
  current: ZCodeOfficialSyncHistoryPluginState[];
  entries: ZCodeOfficialSyncHistoryEntry[];
  /** false 表示尚未加载或最近一次加载失败，UI 不能把空 entries 当成"暂无历史"。 */
  loaded: boolean;
  /** 最近一次加载失败的原因；非空时 UI 展示失败提示 + 重试，不得渲染成无限 loading。 */
  loadError: string | null;
}

export function createInitialOfficialSyncHistoryCache(): OfficialSyncHistoryCache {
  return { active: [], current: [], entries: [], loaded: false, loadError: null };
}

type SetState = (partial: Partial<PluginManagementState>) => void;
type GetState = () => PluginManagementState;

export async function loadOfficialSyncHistory(
  set: SetState,
  get: GetState,
  pluginService: IPluginManagementService,
): Promise<void> {
  const { workspacePath, workspaceIdentity } = get();
  if (!workspacePath) return;
  // 发起新请求时清掉上一次失败的残留，重试期间 UI 回到 loading 态。
  if (get().officialSyncHistory.loadError) {
    set({ officialSyncHistory: { ...get().officialSyncHistory, loadError: null } });
  }
  try {
    const result = await pluginService.listOfficialSyncHistory({
      workspacePath,
      ...(workspaceIdentity ? { workspaceIdentity } : {}),
    });
    // 懒加载期间目标可能已切换；过期响应不能覆盖新目标的缓存。
    if (
      get().workspacePath !== workspacePath ||
      get().workspaceIdentity !== (workspaceIdentity ?? null)
    ) {
      return;
    }
    set({
      officialSyncHistory: {
        active: result.active,
        current: result.current,
        entries: result.entries,
        loaded: true,
        loadError: null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("[plugins] list official sync history failed", { error: message });
    if (
      get().workspacePath === workspacePath &&
      get().workspaceIdentity === (workspaceIdentity ?? null)
    ) {
      // 保留旧数据但标记未加载成功，UI 提示加载失败而不是误显示"暂无历史"。
      set({
        officialSyncHistory: { ...get().officialSyncHistory, loaded: false, loadError: message },
      });
    }
  }
}

export async function activateOfficialSyncHistoryEntry(
  set: SetState,
  get: GetState,
  entryId: string,
  pluginService: IPluginManagementService,
): Promise<boolean> {
  const succeeded = await runWorkspaceOperation(
    set,
    get,
    pluginService,
    `plugin:activateSyncHistory:${entryId}`,
    async (workspace) => {
      await pluginService.activateOfficialSyncHistoryEntry({ ...workspace, entryId });
    },
  );
  if (succeeded) await loadOfficialSyncHistory(set, get, pluginService);
  return succeeded;
}

export async function activateOfficialPluginHistoryVersion(
  set: SetState,
  get: GetState,
  plugin: string,
  version: string | undefined,
  hash: string | undefined,
  pluginService: IPluginManagementService,
): Promise<boolean> {
  const succeeded = await runWorkspaceOperation(
    set,
    get,
    pluginService,
    `plugin:activatePluginHistory:${plugin}@${version ?? "absent"}`,
    async (workspace) => {
      await pluginService.activateOfficialPluginHistoryVersion({
        ...workspace,
        plugin,
        ...(version !== undefined && hash !== undefined ? { version, hash } : {}),
      });
    },
  );
  if (succeeded) await loadOfficialSyncHistory(set, get, pluginService);
  return succeeded;
}
