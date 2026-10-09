import { existsSync } from "node:fs";
import { normalize } from "node:path";
import type { ZCodeAgentMcpServer } from "@zcode/shared";

function normalizePathForCompare(value: string): string {
  const normalized = normalize(value.trim()).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isFilesystemServer(
  server: ZCodeAgentMcpServer,
): server is Extract<ZCodeAgentMcpServer, { command: string }> {
  return (
    "command" in server &&
    server.name === "filesystem" &&
    server.args.some((arg) => arg.includes("@modelcontextprotocol/server-filesystem"))
  );
}

export function appendWorkspaceFoldersToFilesystemMcpServers(
  mcpServers: ZCodeAgentMcpServer[] | undefined,
  primaryWorkspacePath: string,
  additionalFolderPaths: readonly string[] = [],
): ZCodeAgentMcpServer[] | undefined {
  if (!mcpServers || mcpServers.length === 0) {
    return mcpServers;
  }

  // primary 在前，additional 按传入顺序；按归一化键去重，只注入本机存在的路径，
  // 避免远程 workspace 或已删除目录被误注入本机 MCP。
  const seen = new Set<string>();
  const folderPaths: string[] = [];
  for (const candidate of [primaryWorkspacePath, ...additionalFolderPaths]) {
    const trimmed = candidate.trim();
    if (!trimmed || !existsSync(trimmed)) {
      continue;
    }
    const key = normalizePathForCompare(trimmed);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    folderPaths.push(trimmed);
  }
  if (folderPaths.length === 0) {
    return mcpServers;
  }

  let changed = false;
  const nextServers = mcpServers.map((server) => {
    if (!isFilesystemServer(server)) {
      return server;
    }

    const existingKeys = new Set(server.args.map(normalizePathForCompare));
    const missing = folderPaths.filter((path) => !existingKeys.has(normalizePathForCompare(path)));
    if (missing.length === 0) {
      return server;
    }

    changed = true;
    // 用户目录里的 filesystem MCP 可能只包含固定目录，
    // 不会自动允许当前 workspace，导致 agent 写当前项目文件时报
    // "Access denied - path outside allowed directories"。这里仅在本机路径存在时
    // 非持久化追加当前 workspace，避免远程 workspace 被误注入本机 MCP。
    // 项目工作区（多源文件夹）在此追加全部源文件夹，即"统一权限"的正式落点
    // （specs/project-workspace-multi-folder.md）。
    return {
      ...server,
      args: [...server.args, ...missing],
    };
  });

  return changed ? nextServers : mcpServers;
}

export function appendWorkspaceToFilesystemMcpServers(
  mcpServers: ZCodeAgentMcpServer[] | undefined,
  workspacePath: string,
): ZCodeAgentMcpServer[] | undefined {
  return appendWorkspaceFoldersToFilesystemMcpServers(mcpServers, workspacePath);
}
