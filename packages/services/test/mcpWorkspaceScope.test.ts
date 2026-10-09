import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { appendWorkspaceFoldersToFilesystemMcpServers } from "../src/session/mcpWorkspaceScope.js";

import type { ZCodeAgentMcpServer } from "@zcode/shared";

function createFilesystemServer(args: string[]): ZCodeAgentMcpServer {
  return {
    name: "filesystem",
    command: "npx",
    env: [],
    args: ["-y", "@modelcontextprotocol/server-filesystem", ...args],
  };
}

async function withTempDirs(
  count: number,
  run: (dirs: string[]) => Promise<void>,
): Promise<void> {
  const prefix = "zcode-mcp-scope-";
  const dirs = await Promise.all(
    Array.from({ length: count }, () => mkdtemp(join(tmpdir(), prefix))),
  );
  try {
    await run(dirs);
  } finally {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  }
}

test("项目工作区：filesystem MCP 追加 primary 与其余源文件夹", async () => {
  await withTempDirs(2, async ([primary, docs]) => {
    const servers = [createFilesystemServer([primary])];
    const next = appendWorkspaceFoldersToFilesystemMcpServers(servers, primary, [docs]);
    assert.ok(next);
    assert.notEqual(next, servers);
    assert.ok(next[0]?.args.includes(docs));
    assert.ok(next[0]?.args.includes(primary));
    // 原数组不被修改（非持久化注入语义）。
    assert.ok(!servers[0]?.args.includes(docs));
  });
});

test("目录已全部在 allowed directories 时返回原引用", async () => {
  await withTempDirs(2, async ([primary, docs]) => {
    const servers = [createFilesystemServer([primary, docs])];
    const next = appendWorkspaceFoldersToFilesystemMcpServers(servers, primary, [docs]);
    assert.equal(next, servers);
  });
});

test("不存在的 additional 路径被跳过，不阻塞 primary 注入", async () => {
  await withTempDirs(1, async ([primary]) => {
    const servers = [createFilesystemServer([])];
    const next = appendWorkspaceFoldersToFilesystemMcpServers(servers, primary, [
      "/nonexistent/project-folder",
    ]);
    assert.ok(next);
    assert.ok(next[0]?.args.includes(primary));
    assert.ok(!next[0]?.args.includes("/nonexistent/project-folder"));
  });
});

test("非 filesystem server 与空列表保持原样", async () => {
  await withTempDirs(2, async ([primary, docs]) => {
    const other = {
      name: "search",
      command: "npx",
      env: [],
      args: ["-y", "@modelcontextprotocol/server--other"],
    } as ZCodeAgentMcpServer;
    assert.equal(appendWorkspaceFoldersToFilesystemMcpServers(undefined, primary, [docs]), undefined);
    assert.equal(appendWorkspaceFoldersToFilesystemMcpServers([], primary, [docs])?.length, 0);
    // 没有 filesystem server 时无可注入目标，按约定返回原数组引用。
    const servers = [other];
    const next = appendWorkspaceFoldersToFilesystemMcpServers(servers, primary, [docs]);
    assert.equal(next, servers);
  });
});

test("additional 中与 primary 重复的路径只注入一次", async () => {
  await withTempDirs(1, async ([primary]) => {
    const servers = [createFilesystemServer([])];
    const next = appendWorkspaceFoldersToFilesystemMcpServers(servers, primary, [primary]);
    assert.ok(next);
    const hits = next[0]?.args.filter((arg) => arg === primary).length ?? 0;
    assert.equal(hits, 1);
  });
});
