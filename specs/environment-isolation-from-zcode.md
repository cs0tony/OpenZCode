# Spec：OpenZCode 与官方 ZCode 的运行环境隔离

## 背景与目标

本仓库（OpenZCode）与官方 ZCode 共用同一套源码与后端，但在用户机器上此前完全共享运行环境：
官方 ZCode 登录后，运行 OpenZCode 也"已登录"。根因是两侧读写同一批用户级目录：

- 凭据：`~/.zcode/v2/credentials.json`（desktop `credentialService` 与 CLI `shared-credentials.ts`
  读写同一文件、同一加密格式与回退密钥）；
- v2 数据：`~/.zcode/v2/`（setting.json、任务索引、会话快照、onboarding、日志、memory、CA 证书等）；
- Agent CLI 数据：`~/.zcode/cli/`（config.json、db.sqlite、log、exec、debug、rollout、workflows）；
- 同步目录：`~/.zcode/{skills,commands,plugins}`、`~/.zcode/AGENTS.md`；
- 远程 server：`~/.zcode/server/`（部署根、运行根、Windows named pipe）；
- Electron 身份：app name 同为 `ZCode` → userData、单实例锁互斥；
- 其他：`~/.zcode/computer-use`（macOS Helper）、`~/.zcode/mailbox`、`~/.zcode-beta`、`~/ZCodeProject`、
  telemetry/deviceMid 状态文件。

## 决策

### 隔离边界（唯一裁决）

| 命名空间 | 归属 | 处理 |
| --- | --- | --- |
| `~/.zcode`、`~/.zcode-beta`、`~/ZCodeProject` | ZCode 产品私有 | OpenZCode 全部改写为 `~/.openzcode`、`~/.openzcode-beta`、`~/OpenZCodeProject` |
| `<workspace>/.zcode/` | 工作区工件 | **保持共享**。语义同 `.vscode`：hooks、项目级 skills/commands/workflows 属于仓库本身，两个产品打开同一仓库时应读到同一份 |
| `~/.agents/`、`~/.claude/` | 跨工具生态标准目录 | **保持共享**。是显式互操作目标，不是 ZCode 隐式私有状态 |
| `zcode://` deep link | 服务端契约 | **保持不变**。OAuth relay 页的 `redirect` 白名单在官网侧；登录凭据由 Host 轮询 `/oauth/cli/poll/{flowId}` 权威下发，深链仅是 UX 中转，state 校验防止误消费 |
| Electron appId / productName | 安装包身份 | 改为 `dev.openzcode.app` / `OpenZCode`（Preview：`dev.openzcode.app.preview` / `OpenZCode Preview`），运行时 app name 默认 `OpenZCode`（dev：`OpenZCode Dev`）→ userData、sessionData、单实例锁随 app name 自动隔离 |

### 唯一所有者

- 用户级数据根目录名常量唯一所有者：`packages/shared/src/open-zcode-dirs.ts`
  （`OPEN_ZCODE_DATA_DIR_NAME = ".openzcode"`、`OPEN_ZCODE_BETA_DATA_DIR_NAME = ".openzcode-beta"`、
  `OPEN_ZCODE_SCRATCH_WORKSPACE_DIR_NAME = "OpenZCodeProject"`）。所有层（shared / services /
  desktop / server / zcode-server-cli / apps/zcode-cli 的 adapters、core、contracts、bootstrap、cli）
  一律 import 该常量，禁止再写 `".zcode"` 字面量（workspace 级字面量除外）。
- 两个例外包（无 `@zcode/shared` 依赖）允许本地字面量 + 指回常量的注释：
  `apps/zcode-cli/packages/telemetry`、`apps/zcode-cli/packages/debug`。
- Electron 身份唯一所有者：`packages/desktop/scripts/desktop-product-identity.mjs`
  （appId/productName/linux 名）；运行时 app name 唯一所有者：
  `packages/desktop/src/main/desktop-runtime-env.ts`。
- 凭据加密回退密钥前缀改为 `openzcode-credential-fallback:`（两侧实现同步改），
  保证即使有人手工拷贝凭据文件也无法跨产品解密。

### 不变量

1. 所有用户级路径解析必须满足：`<home-root> = <userHome>/.openzcode`（`userHome` 解析逻辑不变：
   优先 `ZCODE_DATA_BASE_DIR`/`ZCODE_DESKTOP_HOME_DIR` 等既有 env，再 `HOME || USERPROFILE || homedir()`）。
2. `<workspace>/.zcode/` 前缀的解析行为与本 spec 改动前完全一致（含 hooks 项目配置、
   saved workflow 项目档、workflow-drafts、workflow-runs、子代理、计划文件）。
3. `ZCODE_DATA_BASE_DIR`（base 覆盖）语义不变：仍只改 base，dot 目录名恒为 `.openzcode`。
4. data dir 迁移功能（setting.json `dataBaseDir` + `copyDataDirectory`）继续可用，
   bootstrap 读取位置变为 `<userHome>/.openzcode/v2/setting.json`。

### 失败语义与迁移边界

- **不做数据迁移、不复制凭据**：升级到隔离版后 OpenZCode 首启为全新状态（未登录、空设置），
  这正是需求（"ZCode 登录了，OpenZCode 不应已登录"）。旧 `~/.zcode` 保持原样不动，
  官方 ZCode 不受任何影响。
- 若用户显式把 `dataBaseDir` 指回 `~/.zcode`，属用户主动选择，应用不做拦截（Windows 安装目录
  guard 继续生效，并把 `Program Files/OpenZCode` 等加入禁止列表）。
- 深链回调在双装场景下由 OS 路由到最后注册者；state 不匹配的一侧丢弃回调，
  凭据经轮询通道到达正确应用。

## 验收场景

1. 同机已登录官方 ZCode（`~/.zcode/v2/credentials.json` 存在）→ 启动 OpenZCode：
   读不到任何凭据，进入未登录态。
2. OpenZCode 登录后凭据仅落 `~/.openzcode/v2/credentials.json`；官方 ZCode 会话不受影响。
3. OpenZCode 的 userData/单实例锁/会话 DB/日志全部位于 `~/.openzcode`（及 Electron `%APPDATA%/OpenZCode`），
   与官方 ZCode 互不可见、可并行运行。
4. Agent CLI（OpenZCode 构建）的 config.json、db.sqlite、log、exec、debug、rollout、workflows
   全部落在 `~/.openzcode/cli/`。
5. 远程 server 部署根/运行根变为 `~/.openzcode/server/`，Windows pipe 名随之改变。
6. 项目级 `<ws>/.zcode/`、`~/.agents/`、`~/.claude/` 行为与改动前一致。
