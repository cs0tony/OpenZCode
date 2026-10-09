import assert from "node:assert/strict";
import test from "node:test";
import {
  appendProjectWorkspaceDraftFolder,
  getProjectWorkspaceDraftErrorKind,
  removeProjectWorkspaceDraftFolder,
  resolveConflictingProjectForCommit,
} from "../src/project-workspace/projectWorkspaceDraft.js";

test("draft 校验：名称/文件夹/primary 缺失分别报对应错误", () => {
  assert.equal(
    getProjectWorkspaceDraftErrorKind({ name: "", folderPaths: [], primaryFolderPath: "" }),
    "nameRequired",
  );
  assert.equal(
    getProjectWorkspaceDraftErrorKind({ name: "P", folderPaths: [], primaryFolderPath: "" }),
    "foldersRequired",
  );
  assert.equal(
    getProjectWorkspaceDraftErrorKind({ name: "P", folderPaths: ["/a"], primaryFolderPath: "" }),
    "primaryRequired",
  );
  assert.equal(
    getProjectWorkspaceDraftErrorKind({
      name: "P",
      folderPaths: ["/a"],
      primaryFolderPath: "/a",
    }),
    null,
  );
});

test("追加文件夹：去重；第一个文件夹自动成为 primary", () => {
  let draft = { name: "P", folderPaths: [] as string[], primaryFolderPath: "" };
  draft = appendProjectWorkspaceDraftFolder(draft, "/repos/a");
  assert.deepEqual(draft.folderPaths, ["/repos/a"]);
  assert.equal(draft.primaryFolderPath, "/repos/a");
  draft = appendProjectWorkspaceDraftFolder(draft, "/repos/b");
  assert.equal(draft.primaryFolderPath, "/repos/a");
  // 重复追加（含尾分隔符差异）不产生第二个条目，也不抢占 primary。
  draft = appendProjectWorkspaceDraftFolder(draft, "/repos/a/");
  assert.deepEqual(draft.folderPaths, ["/repos/a", "/repos/b"]);
  assert.equal(draft.primaryFolderPath, "/repos/a");
});

test("移除 primary：primaryFolderPath 清空待显式重选，不静默晋升", () => {
  const draft = {
    name: "P",
    folderPaths: ["/repos/a", "/repos/b"],
    primaryFolderPath: "/repos/a",
  };
  const next = removeProjectWorkspaceDraftFolder(draft, "/repos/a");
  assert.deepEqual(next.folderPaths, ["/repos/b"]);
  assert.equal(next.primaryFolderPath, "");
  assert.equal(getProjectWorkspaceDraftErrorKind(next), "primaryRequired");
});

test("移除非 primary：primary 保持不变", () => {
  const draft = {
    name: "P",
    folderPaths: ["/repos/a", "/repos/b"],
    primaryFolderPath: "/repos/a",
  };
  const next = removeProjectWorkspaceDraftFolder(draft, "/repos/b");
  assert.deepEqual(next.folderPaths, ["/repos/a"]);
  assert.equal(next.primaryFolderPath, "/repos/a");
});

const existingProjects = [
  { id: "live", name: "live", folderPaths: ["/repos/a"], primaryFolderPath: "/repos/a", createdAt: 1 },
  { id: "orphan", name: "orphan", folderPaths: ["/repos/b"], primaryFolderPath: "/repos/b", createdAt: 2 },
];

test("同 primary 冲突：冲突项目仍有打开 tab 时拒绝提交", () => {
  const result = resolveConflictingProjectForCommit({
    projectWorkspaces: existingProjects,
    primaryFolderPath: "/repos/a",
    openProjectTabIds: new Set(["live"]),
  });
  assert.equal(result.blocked, true);
  assert.equal(result.orphanId, undefined);
});

test("同 primary 冲突：孤儿项目（无打开 tab）让位", () => {
  const result = resolveConflictingProjectForCommit({
    projectWorkspaces: existingProjects,
    primaryFolderPath: "/repos/b",
    openProjectTabIds: new Set(["live"]),
  });
  assert.equal(result.blocked, false);
  assert.equal(result.orphanId, "orphan");
});

test("同 primary 冲突：编辑自身时排除自己，不构成冲突", () => {
  const result = resolveConflictingProjectForCommit({
    projectWorkspaces: existingProjects,
    draftId: "live",
    primaryFolderPath: "/repos/a",
    openProjectTabIds: new Set(["live"]),
  });
  assert.equal(result.blocked, false);
  assert.equal(result.orphanId, undefined);
});

test("同 primary 冲突：无冲突项目时直接放行", () => {
  const result = resolveConflictingProjectForCommit({
    projectWorkspaces: existingProjects,
    primaryFolderPath: "/repos/c",
    openProjectTabIds: new Set(),
  });
  assert.equal(result.blocked, false);
  assert.equal(result.orphanId, undefined);
});
