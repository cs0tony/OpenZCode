import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SETTINGS_SYNC_USER_AGENTS_FILE_MAX_BYTES } from "@zcode/shared";
import { createSettingsSyncService } from "../src/settings-sync/settingsSyncService.js";
import type { ISettingService } from "../src/setting/setting.js";

// node:test 直测 src，经根目录 tsx 运行（node_modules/.bin/tsx --test test/...）。
// 用户级 AGENTS.md 的路径由 resolveUserHomeDir() 在每次调用时读取 HOME/USERPROFILE，
// 用例内切换 HOME 即可隔离到临时目录，无需 mock fs。

function createService() {
  return createSettingsSyncService({
    settingService: {} as ISettingService,
  });
}

async function withTempHome(run: (home: string) => Promise<void>): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), "zcode-user-agents-"));
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  try {
    await run(home);
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    await rm(home, { recursive: true, force: true });
  }
}

test("readUserAgentsFile 在文件不存在时返回路径与 exists=false", async () => {
  await withTempHome(async (home) => {
    const service = createService();
    const result = await service.readUserAgentsFile();
    assert.equal(result.exists, false);
    assert.equal(result.content, null);
    assert.equal(result.path, join(home, ".openzcode", "AGENTS.md"));
    assert.equal(result.directoryPath, join(home, ".openzcode"));
  });
});

test("writeUserAgentsFile 首次保存创建目录与文件并可回环读取", async () => {
  await withTempHome(async (home) => {
    const service = createService();
    const content = "# 全局指令\n- 使用中文回复\n";
    const writeResult = await service.writeUserAgentsFile({ content });
    assert.equal(writeResult.created, true);
    assert.equal(writeResult.bytesWritten, Buffer.byteLength(content, "utf8"));
    assert.equal(writeResult.path, join(home, ".openzcode", "AGENTS.md"));

    const readResult = await service.readUserAgentsFile();
    assert.equal(readResult.exists, true);
    assert.equal(readResult.content, content);
    // 原子写边界：保存后目录里不残留 .tmp 临时文件。
    const entries = await readdir(join(home, ".openzcode"));
    assert.deepEqual(entries, ["AGENTS.md"]);
  });
});

test("writeUserAgentsFile 覆盖保存返回 created=false 并替换内容", async () => {
  await withTempHome(async () => {
    const service = createService();
    await service.writeUserAgentsFile({ content: "第一版" });
    const writeResult = await service.writeUserAgentsFile({ content: "第二版" });
    assert.equal(writeResult.created, false);

    const readResult = await service.readUserAgentsFile();
    assert.equal(readResult.content, "第二版");
  });
});

test("writeUserAgentsFile 超限拒绝且不改动磁盘文件", async () => {
  await withTempHome(async (home) => {
    const service = createService();
    await service.writeUserAgentsFile({ content: "原始内容" });

    const oversized = "a".repeat(SETTINGS_SYNC_USER_AGENTS_FILE_MAX_BYTES + 1);
    await assert.rejects(() => service.writeUserAgentsFile({ content: oversized }));

    const onDisk = await readFile(join(home, ".openzcode", "AGENTS.md"), "utf8");
    assert.equal(onDisk, "原始内容");
  });
});
