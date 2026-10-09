import assert from "node:assert/strict";
import test from "node:test";
import {
  appSettingsPatchSchema,
  appSettingsSchema,
  projectWorkspaceSchema,
} from "../src/validationAppSettings.js";

const validProject = {
  id: "proj-1",
  name: "Monorepo",
  folderPaths: ["/repos/zcode", "/repos/docs"],
  primaryFolderPath: "/repos/zcode",
  createdAt: 1_700_000_000_000,
};

test("projectWorkspaceSchema 接受 primary 属于 folderPaths 的合法项目", () => {
  const parsed = projectWorkspaceSchema.parse(validProject);
  assert.equal(parsed.primaryFolderPath, "/repos/zcode");
  assert.deepEqual(parsed.folderPaths, ["/repos/zcode", "/repos/docs"]);
});

test("projectWorkspaceSchema 拒绝 primary 不在 folderPaths 中", () => {
  const result = projectWorkspaceSchema.safeParse({
    ...validProject,
    primaryFolderPath: "/repos/other",
  });
  assert.equal(result.success, false);
});

test("projectWorkspaceSchema 拒绝重复 folderPaths", () => {
  const result = projectWorkspaceSchema.safeParse({
    ...validProject,
    folderPaths: ["/repos/zcode", "/repos/zcode"],
  });
  assert.equal(result.success, false);
});

test("projectWorkspaceSchema 拒绝空 folderPaths", () => {
  const result = projectWorkspaceSchema.safeParse({ ...validProject, folderPaths: [] });
  assert.equal(result.success, false);
});

test("旧 setting.json（无 projectWorkspaces 字段）解析后得到默认空数组", () => {
  const parsed = appSettingsSchema.parse({ recentProjects: ["/a"] });
  assert.deepEqual(parsed.projectWorkspaces, []);
});

test("appSettingsSchema 保留 lastWorkspaceSession 本地条目上的 projectWorkspaceId", () => {
  const parsed = appSettingsSchema.parse({
    lastWorkspaceSession: [
      { kind: "local", workspacePath: "/repos/zcode", projectWorkspaceId: "proj-1" },
    ],
  });
  const entry = parsed.lastWorkspaceSession[0];
  assert.equal(entry?.kind === "local" ? entry.projectWorkspaceId : undefined, "proj-1");
});

test("appSettingsPatchSchema 接受 projectWorkspaces 增量更新", () => {
  const parsed = appSettingsPatchSchema.parse({ projectWorkspaces: [validProject] });
  assert.deepEqual(parsed.projectWorkspaces, [validProject]);
});
