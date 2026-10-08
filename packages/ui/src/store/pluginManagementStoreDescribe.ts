// 插件详情组件清单（describe）按需拉取切片：按 pluginId 记 loading/data/error。
// 独立成文件与 pluginManagementStoreLoading/Enabled/SyncHistory 同理，避免主 store 超出 max-lines。
import type { IPluginManagementService } from "@zcode/services";
import { logger } from "@/logger.js";
import type { PluginManagementState } from "@/store/pluginManagementStore.js";

type SetState = (partial: Partial<PluginManagementState>) => void;
type GetState = () => PluginManagementState;

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function describePlugin(
  set: SetState,
  get: GetState,
  pluginId: string,
  pluginName: string,
  marketplace: string,
  pluginService: IPluginManagementService,
  force = false,
): Promise<void> {
  const { workspacePath, workspaceIdentity, describeCache } = get();
  if (!workspacePath) return;
  const cached = describeCache[pluginId];
  // 已加载或正在加载时命中缓存，不重复请求；force 时强制重试。
  if (!force && cached && cached.status !== "error") return;
  set({
    describeCache: { ...get().describeCache, [pluginId]: { status: "loading" } },
  });
  try {
    const data = await pluginService.describePlugin({
      workspacePath,
      ...(workspaceIdentity ? { workspaceIdentity } : {}),
      marketplace,
      pluginName,
    });
    const blockingDiagnostic = data.diagnostics?.find(
      (diagnostic) => diagnostic.severity === "error",
    );
    if (data.components.length === 0 && blockingDiagnostic) {
      // CLI 的 describe 对不可解析来源采用 diagnostics 回包而非 RPC reject。
      // 旧 UI 把该回包缓存为 loaded，详情只显示空白且永远没有重试入口；这里将无组件的
      // error diagnostic 映射成可恢复错误态，同时保留正常的部分成功回包。
      set({
        describeCache: {
          ...get().describeCache,
          [pluginId]: { status: "error", error: blockingDiagnostic.message },
        },
      });
      return;
    }
    set({
      describeCache: {
        ...get().describeCache,
        [pluginId]: { status: "loaded", data },
      },
    });
  } catch (error) {
    logger.error("[plugins] describe failed", {
      pluginId,
      marketplace,
      error: toMessage(error),
    });
    set({
      describeCache: {
        ...get().describeCache,
        [pluginId]: { status: "error", error: toMessage(error) },
      },
    });
  }
}
