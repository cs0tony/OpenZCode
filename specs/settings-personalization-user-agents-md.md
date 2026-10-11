# Spec：设置「个性化」分区管理用户级 AGENTS.md

## 背景与目标

OpenZCode 支持用户级全局指令文件 `~/.openzcode/AGENTS.md`（常量 `OPEN_ZCODE_DATA_DIR_NAME`，见 `packages/shared/src/open-zcode-dirs.ts`）：agent 在每次上下文构建时把它作为默认指令合并（`apps/zcode-cli/packages/adapters/src/context/index.ts` 的 `findDefaultUserInstructionFile`）。目前该文件只能手动用编辑器创建，桌面设置没有任何入口；首次引导只有一次性的 CLAUDE.md 迁移复制。

目标：在桌面端设置中新增「个性化」分区（对齐 ChatGPT 桌面端 Custom Instructions 的形态），提供读写 `~/.openzcode/AGENTS.md` 的编辑器：打开即加载，保存即落盘，文件不存在时保存即创建。

## 规则

### 唯一所有者

| 事项 | 所有者 |
| --- | --- |
| 文件路径解析 | host 侧 `getUserZcodeAgentsFilePath()`（`packages/services/src/settings-sync/settingsSyncService.ts`），复用 `OPEN_ZCODE_DATA_DIR_NAME`，禁止他处写字面量 |
| 磁盘文件内容 | 磁盘上的 `~/.openzcode/AGENTS.md` 本身（唯一事实）；服务无缓存 |
| UI 编辑态 | `PersonalizationSection` 组件本地 `draft` state；不引入 store |
| 读写通道 | `ISettingsSyncService.readUserAgentsFile` / `writeUserAgentsFile`（channel `settings-sync`），不新开平台 IPC，不改 zcode-protocol |

### 接口

- `readUserAgentsFile(): Promise<SettingsSyncUserAgentsFile>`，返回 `{ path, directoryPath, exists, content }`；文件不存在时 `exists: false`、`content: null`，但 `path` / `directoryPath` 始终返回（供 UI 展示与「打开所在文件夹」）。
- `writeUserAgentsFile(request: { content: string }): Promise<SettingsSyncUserAgentsFileWriteResult>`，返回 `{ path, bytesWritten, created }`。

### 安全与不变量

1. 渲染进程永远不传路径：目标路径由 host 解析，请求只携带内容（沿用 `saveCliMcpToUserDirectory` 惯例）。
2. 写入原子：先写同目录临时文件再 `rename`，保证 agent 在上下文构建时不会读到半截文件；`rename` 失败时尽力清理临时文件。
3. 大小上限 `SETTINGS_SYNC_USER_AGENTS_FILE_MAX_BYTES = 256 * 1024` 字节（UTF-8），超限拒绝写入并抛错。
4. 保存目录不存在时先 `mkdir -p`（`~/.openzcode` 可能尚未创建）。
5. 保存语义是"把编辑框内容落盘"：文件不存在时即使未编辑也允许保存（否则无法首次创建）；已存在时按"有修改才可保存"门控。
6. 最后写入者获胜：不做外部修改检测与合并；UI 用 `loadVersionRef` 防加载竞态（同 `WorkspaceFileSearchSection`）。
7. 该文件是用户级资产：CLI `/init` 与 agent 仍禁止写它（`builtin-prompt-command.ts` 既有约束不变）；设置 UI 是唯一显式写入口。
8. 保存成功后无需任何通知/刷新机制：agent 下一次上下文构建自然读到新内容；已运行会话不受影响。

### 展示范围

- 「个性化」分区仅桌面端可见（`createSettingsPageConfig` 按 `isDesktop` 过滤，Web 默认 `SETTINGS_SECTIONS` 亦排除）。手机远控场景沿用远控 host 已注册的 settings-sync（操作桌面机 home），本期不在手机端放出入口。
- 分区使用 `localHostServices`（本机全局事实源，同 memory/modelProvider 先例），避免激活远端 workspace 时误读远端 Home。

## 边界

- 不编辑工作区级 `AGENTS.md`（可后续在别处扩展）。
- 不做 Markdown 预览/语法高亮；纯等宽 textarea。
- 不提供删除文件操作；清空内容保存即等价清空指令。
- 不做外部修改轮询或文件监听。
- Web 端无此分区，不需要 server 侧实现。

## 验收场景

1. 文件不存在时打开分区 → 显示目标路径与"保存后将创建"提示，编辑框为空。
2. 文件不存在时直接点保存 → `~/.openzcode` 目录与 `AGENTS.md` 被创建，内容为编辑框当前值。
3. 文件存在时打开 → 编辑框载入全文；修改后出现"未保存"提示，`Cmd/Ctrl+S` 与保存按钮等价，保存成功有 toast，磁盘内容更新。
4. 内容超过 256KB → 保存被拒绝并提示超限，磁盘文件不被改动。
5. 读失败（如权限）→ toast 提示加载失败，编辑器不可保存（保持 loading 失败态），不影响其他设置分区。
6. 保存失败（如磁盘只读）→ toast 提示失败，编辑框内容不丢失，可重试。
7. 「打开所在文件夹」→ 打开 `~/.openzcode` 目录；文件未创建时按钮禁用。
8. 新建会话 → agent 上下文包含刚保存的指令（现有读取链路，无需代码改动）。
