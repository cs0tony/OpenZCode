import { projectFolderPathKey } from "@zcode/shared";
import type { ProjectWorkspace } from "@zcode/shared";

/**
 * 项目工作区弹窗的纯 draft 逻辑（specs/project-workspace-multi-folder.md）：
 * - 路径按归一化键去重；
 * - 第一个文件夹自动成为 primary；
 * - 移除 primary 不做静默晋升，primaryFolderPath 置空并要求显式重选。
 */
export interface ProjectWorkspaceDraft {
  id?: string;
  name: string;
  folderPaths: string[];
  primaryFolderPath: string;
}

export type ProjectWorkspaceDraftErrorKind =
  | "nameRequired"
  | "foldersRequired"
  | "primaryRequired";

/** 提交结果：duplication / 吸收普通 tab 的语义见 specs/project-workspace-multi-folder.md 边界。 */
export type ProjectWorkspaceCommitOutcome =
  | "created"
  | "updated"
  | "absorbedPlainFolder"
  | "duplicatePrimary";

export interface ProjectWorkspaceCommitResult {
  ok: boolean;
  outcome: ProjectWorkspaceCommitOutcome;
}

/**
 * 同 primary 冲突裁决：项目定义比 tab 活得久，而项目在 UI 上的唯一可见形态是 tab，
 * tab 全部关闭后的项目定义会成为不可见孤儿，却仍占用 primary 触发 duplicatePrimary。
 * 规则：冲突项目仍有打开的 tab（在当前窗口）→ 拒绝提交；否则视为孤儿，让其让位
 * （调用方把返回的 orphanId 从 projectWorkspaces 移除后继续提交）。
 */
export function resolveConflictingProjectForCommit(params: {
  projectWorkspaces: readonly ProjectWorkspace[];
  /** 正在提交的项目 id（编辑时排除自身）。 */
  draftId?: string;
  primaryFolderPath: string;
  /** 当前窗口已打开的项目工作区 tab 的 projectWorkspaceId 集合。 */
  openProjectTabIds: ReadonlySet<string>;
}): { blocked: boolean; orphanId?: string } {
  const primaryKey = projectFolderPathKey(params.primaryFolderPath);
  const conflicting = params.projectWorkspaces.find(
    (project) =>
      project.id !== params.draftId &&
      projectFolderPathKey(project.primaryFolderPath) === primaryKey,
  );
  if (!conflicting) {
    return { blocked: false };
  }
  if (params.openProjectTabIds.has(conflicting.id)) {
    return { blocked: true };
  }
  return { blocked: false, orphanId: conflicting.id };
}

export function getProjectWorkspaceDraftErrorKind(
  draft: ProjectWorkspaceDraft,
): ProjectWorkspaceDraftErrorKind | null {
  if (draft.name.trim().length === 0) {
    return "nameRequired";
  }
  if (draft.folderPaths.length === 0) {
    return "foldersRequired";
  }
  if (
    draft.primaryFolderPath.length === 0 ||
    !draft.folderPaths.some(
      (folderPath) => projectFolderPathKey(folderPath) === projectFolderPathKey(draft.primaryFolderPath),
    )
  ) {
    return "primaryRequired";
  }
  return null;
}

export function appendProjectWorkspaceDraftFolder(
  draft: ProjectWorkspaceDraft,
  folderPath: string,
): ProjectWorkspaceDraft {
  const trimmed = folderPath.trim();
  if (!trimmed) {
    return draft;
  }
  const key = projectFolderPathKey(trimmed);
  if (draft.folderPaths.some((existing) => projectFolderPathKey(existing) === key)) {
    return draft;
  }
  return {
    ...draft,
    folderPaths: [...draft.folderPaths, trimmed],
    // 第一个文件夹默认成为 primary；已有 primary 时不抢占。
    primaryFolderPath: draft.primaryFolderPath.length > 0 ? draft.primaryFolderPath : trimmed,
  };
}

export function removeProjectWorkspaceDraftFolder(
  draft: ProjectWorkspaceDraft,
  folderPath: string,
): ProjectWorkspaceDraft {
  const key = projectFolderPathKey(folderPath);
  const folderPaths = draft.folderPaths.filter(
    (existing) => projectFolderPathKey(existing) !== key,
  );
  const primaryRemoved =
    projectFolderPathKey(draft.primaryFolderPath) === key;
  return {
    ...draft,
    folderPaths,
    // 移除 primary 时显式清空选择，由用户在弹窗里重新指定，不做静默晋升。
    primaryFolderPath: primaryRemoved ? "" : draft.primaryFolderPath,
  };
}
