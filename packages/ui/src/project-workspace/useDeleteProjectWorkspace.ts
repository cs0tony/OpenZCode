import { useCallback } from "react";
import { logger } from "@/logger.js";
import { updateAppSettingsVia } from "@/hooks/useSettingService.js";
import { useBaseWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { useTabStoreApi } from "@/store/TabStoreProvider.js";

/**
 * 删除项目工作区定义 —— 唯一删除实现（specs/project-workspace-multi-folder.md 边界）。
 * 两个入口共用：编辑弹窗"删除项目"（删定义 + 当前窗口项目 tab 降级为普通文件夹）、
 * 侧边栏项目 tab 的"移除"（先删定义再关 tab，用户心智上"移除 = 删除"）。
 *
 * 必须锚定 base（本机）services：激活远程 tab 时 `useServices()` 会解析到远程 host，
 * 那里没有 settingService，用它会静默漏删、把项目定义重新变成孤儿。
 * 写入走 `updateAppSettingsVia`（update + 快照刷新），保证弹窗/侧边栏投影立即收敛。
 */
export function useDeleteProjectWorkspace() {
  const services = useBaseWorkspaceServices();
  const tabStoreApi = useTabStoreApi();

  return useCallback(
    async (projectId: string): Promise<void> => {
      const settingService = services.settingService;
      if (!settingService) {
        logger.warn("[project-workspace] settingService 不可用，跳过项目定义删除", {
          projectId,
        });
        return;
      }
      const settings = await settingService.get();
      await updateAppSettingsVia(
        settingService,
        {
          projectWorkspaces: settings.projectWorkspaces.filter(
            (project) => project.id !== projectId,
          ),
        },
      );
      tabStoreApi.getState().degradeProjectWorkspaceTabs(projectId);
    },
    [services.settingService, tabStoreApi],
  );
}
