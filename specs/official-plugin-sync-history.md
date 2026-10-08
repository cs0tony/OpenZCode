# Spec：官方内置插件同步历史（备份与回退）

## 背景

`specs/sync-official-plugins-from-local-zcode.md` 的同步入口把官方 ZCode 缓存里的
内置插件一次性复制进 OpenZCode 自己的缓存。复制走"只补缺失"，但官方缓存里的版本
随原版 ZCode 升级，可能出现"同步进来的版本太新、与当前 OpenZCode 运行时不兼容"。
同步只增不删，用户没有任何手段回到同步前的状态。

本 spec 在同步链路上增加历史备份：每次会改变内置插件集合的同步前自动快照，
用户可在设置页浏览历史并激活任意历史状态（整表回退），也可对单个内置插件
回退到某个历史版本（或回退到"未同步"状态）。

## 领域界定

- **历史域**：仅覆盖 seed marker `source: "local-zcode"` 的缓存目录（即经同步
  复制进来的内置插件）。本地源（SEA/filesystem）插件由启动 seed 管线维护，
  不属于历史域：快照不记录、恢复不动它们。
- **历史根**：`<pluginStorageRoot>/official-plugin-sync-history/`
  （`~/.openzcode/cli/plugins/official-plugin-sync-history/`），与 `cache/` 平级，
  避开官方缓存目录的全部扫描（bundled 分片存在时 `scanOfficialCache` 只认分片
  cachePath；目录兜底扫描只在分片缺失时发生且只扫 `cache/zcode-plugins-official/`）。
- 布局：
  - `index.json`：`{ version: 1, entries: Entry[] }`，按时间升序。
  - `objects/<plugin>/<version>/<hash>/…`：插件目录整目录副本（含 seed marker），
    按 `(plugin, version, hash)` 去重；`hash` 即该目录 seed marker 的 hash。
  - 并发控制：整个历史根一把 `withOfficialPluginSeedLock` 目录锁；对缓存目录的
    删除/物化逐目录复用既有 seed 锁。

Entry 结构：

```ts
interface OfficialSyncHistoryEntry {
  id: string; // `${epochMs}-${random}`
  createdAt: string; // ISO 8601
  kind: "initial" | "pre-sync";
  plugins: Array<{ plugin: string; version: string; hash: string }>; // 按 plugin 排序
}
```

## 产品规则

- **备份时机**：同步入口确定将要复制至少一个插件后、写任何缓存目录之前快照；
  无可复制内容（officialCacheFound=false、全部 skipped）不产生条目。快照失败时
  同步整体中止（手动操作可重试，不允许"没备份就改缓存"）。index 读取失败按空
  历史降级继续（历史是便利数据，不是事实源），并 warn。
- **初始条目**：历史为空时的第一次快照 `kind: "initial"`（即"开始同步前的初始
  状态"），此后每次 `kind: "pre-sync"`。不做去重：回退后再同步产生的同态快照
  照常记录（真实发生过）。
- **激活（整表回退）**：把历史域恢复为条目记录的状态——
  1. 当前存在而条目没有的插件：删除其全部 local-zcode 目录；
  2. 条目有目标 (version, hash) 的插件：删除该插件其它 local-zcode 版本目录，
     目标目录缺失或 hash 不符时从对象库物化，并重写 runtime manifest；
  3. 经启动 seed 管线重建 bundled 分片（复用 `collectStartupSeedSources`，
     不手写分片）。
     单插件失败（对象缺失、IO 错误）记入 `failed`，不阻断其他插件。
- **单插件回退**：同一对账原语作用于单个插件。目标 `(version, hash)` 必须在
  对象库或当前目录中可物化；`version/hash` 缺省表示"移除此插件"（回退到未同步
  状态，之后可再次同步恢复）。
- **旧版本可见性（sibling fallback）**：当前定义版本路径上无 local-zcode marker
  时，识别逻辑回退到同插件名下最新可用的 local-zcode 版本目录，分片条目写
  实际版本与实际路径（诚实标签）。因此"回退到旧版本但应用定义已升到新版本"时
  插件仍以旧版本出现在商店列表，而不是消失。该 fallback 只影响分片呈现；
  **同步 gate 不受影响**——"只补缺失"仍以定义版本路径上的 marker 判定，
  fallback 识别的旧版本不算已同步，再次同步会照常升级到定义版本。
- **保留策略**：条目上限 20，追加后裁剪最旧；未被剩余条目引用的对象 GC。
- **激活后生效**：分片重建后无需重启——商店/插件列表按请求读取分片
  （`scanOfficialCache` 以 bundled 分片为权威清单）；运行中的会话按既有插件
  生命周期在下次加载时生效，与卸载/恢复语义一致。
- **环境隔离边界不变**：历史功能只读写 `~/.openzcode` 自身插件目录，不触碰
  `~/.zcode`；CUA feature flag 关闭时其缓存目录不进分片（既有 gating 不变），
  但快照/恢复按磁盘事实记录，不受 flag 影响。

## 状态所有者

- 历史存储（index/objects/锁/GC）：`apps/zcode-cli/packages/bootstrap/src/app/official-plugin-sync-history.ts` 独有。
- local-zcode 缓存目录与 bundled 分片：`bundled-plugins.ts` seed 管线独有；
  恢复流程只做"目录对账"，分片一律经 `refreshBundledOfficialPlugins`（启动管线
  复用入口）重建。
- 同步 loading/结果与历史面板数据：UI `pluginManagementStore` 局部状态，Host 无任务队列。
  历史面板加载失败时必须展示失败提示与重试入口，不得把失败渲染成无限 loading
  或"暂无历史"（RPC 方法缺失、超时等故障在旧 CLI/新 UI 混跑时真实发生过）。

## 接口

- 新 RPC（方法名入 `zcodeProtocolMethods`）：
  - `plugins/listOfficialSyncHistory`
    - Params：`{ workspace }`
    - Result：`{ entries: Entry[], current: PluginState[], active: PluginState[] }`；
      `current` 为当前全部 local-zcode 目录（含 dormant 旧版本目录），`active` 为
      bundled 分片实际列出的 local-zcode 状态；"当前状态"徽标由 UI 用
      `active` 对条目求差得出。
  - `plugins/activateOfficialSyncHistoryEntry`
    - Params：`{ workspace, entryId }`；entryId 不存在时 RPC 报错。
    - Result：`{ activated: string[], removed: string[], failed: { plugin, reason }[] }`
  - `plugins/activateOfficialPluginHistoryVersion`
    - Params：`{ workspace, plugin, version?, hash? }`（二者同有同无，refine 校验）
    - Result：同上。
  - 两个 activate handler 在目录对账后调用 `refreshBundledOfficialPlugins`
    重建分片，再返回结果。
- 服务层：`IPluginManagementService` 增加 `listOfficialSyncHistory` /
  `activateOfficialSyncHistoryEntry` / `activateOfficialPluginHistoryVersion`，
  经 `IZCodeAgentService` 透传到 CLI（与 syncOfficialFromLocalZcode 同型）。

## 验收场景

1. 首次同步：历史为空 → 产生 `initial` 条目（快照为同步前状态，通常为空集），
   同步行为与产物不变。
2. 已有同步插件后再次同步（应用升级带来新定义版本）：产生 `pre-sync` 条目，
   记录同步前各插件的 (version, hash)；对象库含对应整目录副本。
3. 无可复制内容时重复同步：不产生新条目。
4. 整表激活 initial 条目：全部 local-zcode 目录被删除，商店内置列表回到初始；
   `current` 为空、条目 matchesCurrent（UI 判定）。再次同步可恢复（产生新条目）。
5. 单插件回退到历史版本：其它版本目录被移除、目标版本物化；bundled 分片条目
   指向旧版本目录且 version 写实际值；商店显示旧版本。
6. 单插件回退后再次同步：按"定义版本路径缺失"重新复制定义版本（升级语义不变）。
7. 定义版本高于回退版本时启动应用：sibling fallback 识别旧版本目录，分片保持
   旧版本条目，插件不消失。
8. 条目超过 20：最旧条目被裁剪，其独占对象被 GC，仍被引用的对象保留。
9. 恢复的目录 runtime manifest 被重写为当前运行时（MCP command 指向当前进程）。
10. 并发：两个窗口同时激活/同步——历史锁串行化历史读写，目录级 seed 锁防互删，
    分片由 seed 管线幂等重建。
