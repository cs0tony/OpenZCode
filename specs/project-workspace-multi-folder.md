# 项目工作区（Project Workspace，多源文件夹）

## 背景与目标

此前"添加项目"只能打开单个文件夹：项目 ≡ 一个 `workspacePath`，显示名取路径尾段，无自定义
名称。本特性引入"项目工作区"：一个项目 = 用户命名（Project name）+ 多个源文件夹（Source
folders）+ 其中一个主文件夹（Primary）。产品语义对齐"项目即工作区"，同时保持与上游 ZCode
插件生态的兼容：执行锚点永远是 primary 文件夹的既有 `workspacePath`，协议、Host、CLI 运行时、
权限审批、插件/Hook/技能/MCP 发现逻辑零改动。

## 不变量（兼容红线）

1. **执行锚点不变量**：项目的 `primaryFolderPath` 就是一个普通的 `workspacePath`。对下游
   所有层而言，项目工作区会话与直接打开 primary 文件夹的会话不可区分：
   `workspaceKey = workspaceIdentity?.trim() || workspacePath`、`zcodeWorkspaceRefSchema`、
   `RuntimeConfig.workingDirectory`、bash cwd policy、权限审批流全部不变。
2. **元数据零入目录**：项目定义只存用户级全局设置（`~/.openzcode/v2/setting.json`，
   settingService 所有），不向任何项目文件夹写入文件。推论：项目定义绑定本机 + 本用户，
   不随仓库迁移。
3. **缺省零差异**：不使用项目工作区时，所有新增字段缺省，settings、MCP 注入、CLI Environment
   段输出与现版本逐字节一致。

## 数据与所有者

- `appSettings.projectWorkspaces: ProjectWorkspace[]`（默认 `[]`）：唯一持久化所有者是
  settingService；全局一份，跨窗口共享。
  `ProjectWorkspace = { id, name, folderPaths（≥1，有序去重）, primaryFolderPath（∈ folderPaths）, createdAt }`。
- tab 投影：每窗口 tabStore 持有 `projectWorkspaceId?` 可选字段；项目 tab 的
  `workspacePath = primaryFolderPath`、`label = 项目名`。单 tab = 单项目，不按文件夹开新 tab。
- 恢复：`lastWorkspaceSession` 本地条目增可选 `projectWorkspaceId`；恢复时回查
  `projectWorkspaces`，查不到则降级为普通文件夹 tab（锚点路径本身仍有效）。

## 规则

### 创建

入口：侧边栏 "+" 菜单"新建项目"（"打开文件夹"保持原语义不变）。弹窗内：name 必填；
folderPaths ≥ 1（经 `platform.selectDirectory()` / Web 端 DirectoryBrowser 追加）；primary
默认第一个、可单选切换；路径去重。提交 = settings 写入 + addTab（锚点 = primary）+
startDraftInWorkspace(primary)。

### 切换 primary

入口：项目 tab 右键菜单"编辑项目"（弹窗编辑模式）。

语义：更新 settings 中该项目的 `primaryFolderPath`，并同步更新已打开该项目 tab 的
workspacePath 锚点与 label。**只影响新会话**：既有会话的 workspacePath、历史与恢复均不感知
切换（会话锚点本就不可变，与既有语义一致）。跨窗口去重（`activateOrSetWorkspace`）按新锚点
路径走既有逻辑；main 进程窗口 pathSet 经既有 SyncWindowTabs effect（`useRootPlatformEffects`
按 tabs 订阅整体重推，`desktopMainIpcPlatform` 整体替换 pathSet）同步，零新增机制。

### 文件夹集合边界

- folders 至少保留 1 个；移除 primary 时弹窗要求显式指定新 primary，不做静默晋升。
- 项目 tab 发起的会话：filesystem MCP 的 allowed directories 追加全部 folderPaths（现状仅
  追加 workspacePath 一个）；agent 进程 env 注入 `OPEN_ZCODE_ADDITIONAL_DIRECTORIES`
  （`path.delimiter` 分隔），CLI Environment 段渲染 "Additional source folders" 一行。
  非项目工作区两处注入均保持原样。
- 文件面板：`WorkspaceFileTree` 是单根虚拟化组件，多根浏览以**面板内根切换器**实现——
  面板顶部按项目源文件夹显示根切换 chips（primary 带 "主" 标识），切换即按目标根重挂载树；
  远程（SSH/WSL/Docker）文件夹一期不参与。预览/代码查看器按当前浏览根的 workspacePath
  传作用域，不误挂 primary。
- 一期范围：仅本地路径文件夹。文件搜索索引、git 面板仍按当前浏览根单根（已知限制，
  留待深水区迭代）。

## 边界

- 权限不按目录划界（现状即如此，工具层刻意不拦截 workspaceRoot 之外路径）；"统一权限"的
  正式落点是 filesystem MCP allowed directories = 项目全部文件夹。
- `projectWorkspaceId` 是 UI/settings 层标识，不进协议 wire format，不参与 workspaceKey。
- tab 身份按路径（workspaceKey = identity || path）匹配，同一路径的普通"打开文件夹" tab 与
  项目 tab **不能共存**：在已打开普通 tab 的路径上创建项目时，该 tab 被并入项目 tab 并 toast
  提示；反之在项目 primary 路径上"打开文件夹"会激活既有项目 tab（项目优先）。这是 tab 身份
  模型的既有约束，不做双 tab 共存。
- **移除项目 tab = 删除项目定义**：项目的唯一可见形态是 tab，只关 tab 会让定义变成不可见
  孤儿并永久占用 primary。侧边栏"移除"项目 tab 时**先删除 settings 中的定义再关 tab**；
  编辑弹窗"删除项目"= 删定义 + 当前窗口项目 tab 降级为普通文件夹。两条路径共用同一
  `useDeleteProjectWorkspace` 实现，锚定本机 base services（激活远程 tab 时不受影响）。
  多窗口下另一窗口仍打开的同一项目 tab 会优雅降级为普通文件夹 tab。
- 同 primary 冲突裁决保留为防御（多窗口/写盘竞态可能残留孤儿）：冲突项目仍有打开 tab
  （当前窗口）→ 拒绝提交并提示；否则视为孤儿，提交时自动让位移除。
- 删除项目只删分组与名称，不触碰任何文件夹内容；已打开 tab 降级为普通文件夹 tab，会话继续可用。
- 切换 primary 只重锚**当前窗口**的项目 tab；其他窗口已打开的同一项目 tab 不实时重锚，
  其既有会话本就不迁移，下次会话恢复时按全局新 primary 呈现。
- UI 写入 `projectWorkspaces` 必须走 `updateAppSettings`（settingService.update + sync +
  refresh）：直写 settingService 不会刷新 UI settings 快照，弹窗回查会拿到旧数组。

## 验收场景

1. 单文件夹项目：会话环境与直接打开该文件夹逐字节一致（回归红线）。
2. 项目会话中 agent 能读/写非 primary 源文件夹（工具无沙箱 + MCP allowed directories 命中）。
3. 旧 setting.json（无 `projectWorkspaces`）加载正常；新 setting.json 被旧版本读取时字段被
   strip 且不报错。
4. 重启恢复：项目 tab 还原（label = 项目名、锚点 = primary），插件/Hook 正常加载。
5. 切换 primary：新会话 cwd = 新 primary；旧会话不受影响；跨窗口激活按新路径去重；main
   窗口 pathSet 同步更新。
6. 移除 primary 文件夹时必须显式指定新 primary；folders 不可为空。
7. 删除项目后，已打开 tab 降级为普通文件夹 tab，会话继续可用。
