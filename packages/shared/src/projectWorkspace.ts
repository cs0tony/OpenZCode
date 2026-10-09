import type { ProjectWorkspace } from "./protocol.js";

/**
 * 项目工作区跨进程传递"primary 之外源文件夹"的 env 键。
 * services 在 agent 进程 spawn 时写入（path.delimiter 分隔），CLI Environment 段读取渲染；
 * 普通工作区不注入该键，CLI 输出保持与单文件夹工作区逐字节一致
 * （specs/project-workspace-multi-folder.md）。
 */
export const OPEN_ZCODE_ADDITIONAL_DIRECTORIES_ENV = "OPEN_ZCODE_ADDITIONAL_DIRECTORIES";

/**
 * 归一化比较键：统一分隔符、去尾分隔符并小写。
 * 只用于"同源存储路径"的归属比较（tab 锚点 vs settings 存储 vs spawn cwd），
 * 不承载文件系统大小写语义。
 */
export function projectFolderPathKey(path: string): string {
  const normalized = path.trim().replace(/[\\/]+$/, "");
  return normalized.length > 0 ? normalized.toLowerCase() : "";
}

/** 返回以 workspacePath 为主文件夹（primary）的项目工作区；普通工作区返回 undefined。 */
export function findProjectWorkspaceByPrimary(
  projectWorkspaces: readonly ProjectWorkspace[] | undefined,
  workspacePath: string,
): ProjectWorkspace | undefined {
  const key = projectFolderPathKey(workspacePath);
  if (!key) {
    return undefined;
  }
  return projectWorkspaces?.find(
    (project) => projectFolderPathKey(project.primaryFolderPath) === key,
  );
}

/**
 * 返回项目的全部源文件夹（保持 folderPaths 顺序）。
 * workspacePath 不是任何项目的 primary 时返回空数组——普通工作区必须保持零注入。
 */
export function resolveProjectSourceFolders(
  projectWorkspaces: readonly ProjectWorkspace[] | undefined,
  workspacePath: string,
): string[] {
  return findProjectWorkspaceByPrimary(projectWorkspaces, workspacePath)?.folderPaths ?? [];
}
