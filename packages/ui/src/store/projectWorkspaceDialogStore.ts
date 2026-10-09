import { create } from "zustand";

/**
 * 项目工作区弹窗的打开请求。
 * 仿 confirmDialogStore 先例：跨层级入口（侧边栏 "+" 菜单、workspace 行 "..." 菜单）
 * 直接写 store，Host 挂载在 Root 一次，避免 props 六层钻透。
 */
export type ProjectWorkspaceDialogRequest =
  | { mode: "create" }
  | { mode: "edit"; projectId: string };

interface ProjectWorkspaceDialogStoreState {
  request: ProjectWorkspaceDialogRequest | null;
  openCreate: () => void;
  openEdit: (projectId: string) => void;
  close: () => void;
}

export const useProjectWorkspaceDialogStore = create<ProjectWorkspaceDialogStoreState>()(
  (set) => ({
    request: null,
    openCreate: () => set({ request: { mode: "create" } }),
    openEdit: (projectId: string) => set({ request: { mode: "edit", projectId } }),
    close: () => set({ request: null }),
  }),
);

export function openCreateProjectWorkspaceDialog(): void {
  useProjectWorkspaceDialogStore.getState().openCreate();
}

export function openEditProjectWorkspaceDialog(projectId: string): void {
  useProjectWorkspaceDialogStore.getState().openEdit(projectId);
}
