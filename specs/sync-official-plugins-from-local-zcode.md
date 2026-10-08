# Spec：从本地原版 ZCode 复制内置官方插件

## 背景

开源仓库的打包链只包含 `node-repl-host` 与 `browser-use` 两个官方插件包源；
`OFFICIAL_PLUGIN_DEFINITIONS` 声明的其余官方插件（documents/pdf/presentations/spreadsheets、
image-search、plugin-creator、skill-creator、zcode-guide、computer-use、android-emulator、
ios-simulator、restore-legacy-sessions）的包在私有 producer 仓库，seed 时被静默跳过，
导致开发/开源构建下商店与内置插件列表残缺（"实用工具"等分类消失）。

本机安装的原版 ZCode 在 `~/.zcode/cli/plugins/cache/zcode-plugins-official/<name>/<version>/`
缓存了全部官方插件，目录内部结构与 OpenZCode 的 seed 产物完全一致
（`.zcode-plugin/plugin.json` + `.zcode-plugin-seed.json` marker），且版本与定义一致。

## 产品规则

- **手动触发**：用户在 设置 → 插件 点击"从本地 ZCode 同步"；不做启动时自动同步。
- **同步前快照**：将复制至少一个插件时，先按 specs/official-plugin-sync-history.md
  对当前 local-zcode 缓存做快照，再写缓存；快照失败则同步中止。
- **一次性复制**：原版 ZCode 目录仅作为复制的来源读取一次；同步产物落入 OpenZCode
  自己的插件缓存（`~/.openzcode/cli/plugins/cache/zcode-plugins-official/...`），
  之后与 `~/.zcode` 无任何运行时依赖（官方目录删除/升级/卸载均不影响 OpenZCode）。
- **只补缺失**：本地源（SEA/仓库包）已能解析、或定义版本路径上 seed 已 current 的
  插件不覆盖；版本不匹配（官方缓存无定义版本的目录）只报告跳过，不做降级安装。
  同步历史 sibling fallback 识别的旧版本目录不算"已同步"，不阻止升级。
- **幂等**：重复点击同步，已同步且内容未变的插件直接跳过（复用 seed marker hash）。
- **卸载/恢复语义不变**：同步进来的插件与"真内置"插件地位相同——卸载写
  `suppressedBuiltins`（缓存保留），商店出现"恢复"入口，离线恢复。
- **环境隔离边界不变**：只读 `~/.zcode` 下的官方插件缓存目录，不读/写其配置、
  凭据、会话；`computer-use` 仍受 `isZCodeCuaInternalFeatureEnabled` 门控，
  flag 关闭时不同步。

## 状态所有者

- 复制产物与 seed marker：仍由 `bundled-plugins.ts` 的 seed 管线独有（lock、
  sha256 校验、临时目录 + 原子替换）。
- bundled marketplace 分片：`bundled-plugins.ts` 每次启动重写；同步过的插件通过
  缓存 marker（`source: "local-zcode"`）在后续启动被重新纳入分片，避免被
  只含本地源的分区写覆盖。
- 同步动作的 loading/结果：UI `pluginManagementStore` 局部状态，Host 侧无任务队列。

## 接口

- 新 RPC：`plugins/syncOfficialFromLocalZcode`
  - Params：`{ workspace }`
  - Result：`{ officialCacheFound, officialCacheRoot?, synced: string[],
skipped: { plugin, reason }[] }`
  - Host handler 调用 `syncOfficialPluginsFromLocalZcodeCache({ pluginStorageRoot })`。
- 官方缓存根路径解析：`resolveOfficialZcodePluginCacheRoot()` 在
  `apps/zcode-cli/packages/bootstrap/src/app/paths.ts`（唯一所有者），目录名常量
  `OFFICIAL_ZCODE_DATA_DIR_NAME`（`~/.zcode`）在 `packages/shared/src/open-zcode-dirs.ts`。
  路径函数不能进 shared：shared index 在渲染层可达，node:os/node:path 会被 Vite
  外置并在模块求值时抛错，导致窗口白屏（2026-10-08 修复记录）。

## 验收场景

1. 本机无 `~/.zcode` 缓存：点击同步 → `officialCacheFound: false`，UI 提示
   "未检测到本地安装的 ZCode"，无其他副作用。
2. 本机有完整官方缓存：点击同步 → 缺失的 12 个插件被复制进 OpenZCode 缓存并写入
   bundled 分片；商店出现对应条目（"实用工具"等分类恢复），可启用。
3. 重复同步：返回 synced 为空，skipped 给出 already-seeded 原因；无缓存重写抖动。
4. 同步后删除/改名 `~/.zcode`：插件继续可用（含重启后，marker 重建分片）。
5. 卸载同步进来的内置插件：缓存保留、出现"恢复"入口，恢复离线完成。
6. `computer-use`：flag 关闭时不被同步（skipped: feature-disabled）；flag 开启时
   正常同步并受既有 discovery 门控。
