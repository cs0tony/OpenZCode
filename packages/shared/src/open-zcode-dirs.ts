/**
 * OpenZCode 与官方 ZCode 的用户级环境隔离常量（唯一所有者）。
 *
 * 两个产品在同一台机器上必须各自持有独立的数据根：官方 ZCode 写 `~/.zcode`
 * （及 `~/.zcode-beta`、`~/ZCodeProject`），OpenZCode 写 `~/.openzcode`
 * （及 `~/.openzcode-beta`、`~/OpenZCodeProject`）。登录凭据、v2 设置、会话、
 * 遥测、日志、全局 CLI 配置等互不可见，避免"官方 ZCode 登录了，OpenZCode
 * 启动即已登录"的隐式共享。
 *
 * 边界（保持共享，不要改成隔离目录）：
 * - `<workspace>/.zcode/`：项目级目录是工作区工件，语义同 `.vscode`，两个产品
 *   打开同一仓库时共享同一份（hooks、项目级 skills/commands/workflows）；
 * - `~/.agents/`、`~/.claude/`：跨工具生态标准目录，属显式互操作而非隐式共享；
 * - `zcode://` deep link：OAuth relay 页的服务端白名单契约，不随本地身份改变。
 *
 * 裁决记录见 specs/environment-isolation-from-zcode.md。
 */
export const OPEN_ZCODE_DATA_DIR_NAME = ".openzcode";

/** OpenZCode beta 形态的存储根（官方 ZCode 为 `.zcode-beta`）。 */
export const OPEN_ZCODE_BETA_DATA_DIR_NAME = ".openzcode-beta";

/** OpenZCode 主目录 scratch 工作区目录名（官方 ZCode 为 `ZCodeProject`）。 */
export const OPEN_ZCODE_SCRATCH_WORKSPACE_DIR_NAME = "OpenZCodeProject";
