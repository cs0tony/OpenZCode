export type SettingsSyncAgent =
  | "zcode"
  | "claudeCode"
  | "codexCli"
  | "openCode"
  | "openClaw"
  | "augment"
  | "continue"
  | "goose"
  | "qwenCode"
  | "qode"
  | "qodeCn"
  | "windsurf"
  | "trae"
  | "traeCn"
  | "kiroCli"
  | "roo"
  | "codeBuddy"
  | "agents";

export type SettingsSyncCategory = "providers" | "skills" | "commands" | "plugins" | "mcpServers";

export type SettingsSyncSourceScope = "global" | "project";

export type SettingsSyncImportMode = "copy" | "symlink";

export interface SettingsSyncClaudeAgentsFileMigrationStatus {
  sourcePath: string;
  targetPath: string;
  sourceExists: boolean;
  targetExists: boolean;
  supported: boolean;
  unavailableReason?: "missingSource";
}

export interface SettingsSyncClaudeAgentsFileCopyResult {
  sourcePath: string;
  targetPath: string;
  status: "copied" | "skipped";
  overwritten: boolean;
  skippedReason?: "missingSource" | "targetExists";
}

export type SettingsSyncSkillSkipReason = "targetExists" | "sameNameExists";

export interface SettingsSyncSourceSkillSummary {
  name: string;
  path: string;
  importable: boolean;
  skipReason?: SettingsSyncSkillSkipReason;
  version?: string;
}

export type SettingsSyncCommandSkipReason = "targetExists" | "sameNameExists";

export interface SettingsSyncSourceCommandSummary {
  name: string;
  path: string;
  importable: boolean;
  skipReason?: SettingsSyncCommandSkipReason;
  description?: string;
  argumentHint?: string;
}

export type SettingsSyncPluginSkipReason = "targetExists" | "sameNameExists";

export interface SettingsSyncSourcePluginSummary {
  name: string;
  path: string;
  importable: boolean;
  skipReason?: SettingsSyncPluginSkipReason;
  version?: string;
}

export type SettingsSyncMcpServerSkipReason = "sameNameExists";

export interface SettingsSyncSourceMcpServerSummary {
  name: string;
  path: string;
  importable: boolean;
  skipReason?: SettingsSyncMcpServerSkipReason;
}

export interface SettingsSyncSourceRootSummary {
  scope: SettingsSyncSourceScope;
  path: string;
  discoveredCount: number;
  importableCount: number;
  skippedCount?: number;
  skills?: SettingsSyncSourceSkillSummary[];
  commands?: SettingsSyncSourceCommandSummary[];
  plugins?: SettingsSyncSourcePluginSummary[];
  mcpServers?: SettingsSyncSourceMcpServerSummary[];
}

export interface SettingsSyncCategorySummary {
  category: SettingsSyncCategory;
  discoveredCount: number;
  importableCount: number;
  skippedCount?: number;
  sourcePaths?: string[];
  sourceRoots?: SettingsSyncSourceRootSummary[];
  selectedByDefault: boolean;
}

export type SettingsSyncSkillImportStatus = "imported" | "skipped" | "failed";

export interface SettingsSyncSkillImportResult {
  name: string;
  path: string;
  sourceScope: SettingsSyncSourceScope;
  status: SettingsSyncSkillImportStatus;
  skipReason?: SettingsSyncSkillSkipReason;
  version?: string;
}

export type SettingsSyncCommandImportStatus = "imported" | "skipped" | "failed";

export interface SettingsSyncCommandImportResult {
  name: string;
  path: string;
  sourceScope: SettingsSyncSourceScope;
  status: SettingsSyncCommandImportStatus;
  skipReason?: SettingsSyncCommandSkipReason;
}

export type SettingsSyncPluginImportStatus = "imported" | "skipped" | "failed";

export interface SettingsSyncPluginImportResult {
  name: string;
  path: string;
  sourceScope: SettingsSyncSourceScope;
  status: SettingsSyncPluginImportStatus;
  skipReason?: SettingsSyncPluginSkipReason;
  version?: string;
}

export type SettingsSyncMcpServerImportStatus = "imported" | "skipped" | "failed";

export interface SettingsSyncMcpServerImportResult {
  name: string;
  path: string;
  sourceScope: SettingsSyncSourceScope;
  status: SettingsSyncMcpServerImportStatus;
  skipReason?: SettingsSyncMcpServerSkipReason;
}

export interface SettingsSyncAgentSummary {
  agent: SettingsSyncAgent;
  discovered: boolean;
  categories: SettingsSyncCategorySummary[];
}

export interface SettingsSyncDiscoveryResult {
  agents: SettingsSyncAgentSummary[];
}

export interface SettingsSyncSelection {
  agent: SettingsSyncAgent;
  category: SettingsSyncCategory;
  sourceScope?: SettingsSyncSourceScope;
  targetScope?: SettingsSyncSourceScope;
  importMode?: SettingsSyncImportMode;
  skillPaths?: string[];
  commandPaths?: string[];
  pluginPaths?: string[];
  mcpServerPaths?: string[];
}

export interface SettingsSyncProgressEvent {
  total: number;
  completed: number;
  currentAgent?: SettingsSyncAgent;
  currentCategory?: SettingsSyncCategory;
  successCount: number;
  skippedCount: number;
  failedCount: number;
}

export interface SettingsSyncTaskImportResult {
  agent: SettingsSyncAgent;
  category: SettingsSyncCategory;
  status: "success" | "skipped" | "failed";
  importedCount: number;
  skippedCount: number;
  failedCount: number;
  skillResults?: SettingsSyncSkillImportResult[];
  commandResults?: SettingsSyncCommandImportResult[];
  pluginResults?: SettingsSyncPluginImportResult[];
  mcpServerResults?: SettingsSyncMcpServerImportResult[];
}

export interface SettingsSyncImportResult {
  successCount: number;
  skippedCount: number;
  failedCount: number;
  taskResults: SettingsSyncTaskImportResult[];
}

export interface SettingsSyncFirstRunPromptState {
  handled: boolean;
}

/** 用户级 AGENTS.md 的写入上限（UTF-8 字节），防止把超大文本灌进模型上下文。 */
export const SETTINGS_SYNC_USER_AGENTS_FILE_MAX_BYTES = 256 * 1024;

export interface SettingsSyncUserAgentsFile {
  path: string;
  /** 文件所在目录（~/.openzcode），供"打开所在文件夹"使用，渲染进程无需自行拼接路径。 */
  directoryPath: string;
  exists: boolean;
  /** 文件不存在时为 null；存在时为 UTF-8 全文。 */
  content: string | null;
}

export interface SettingsSyncUserAgentsFileWriteResult {
  path: string;
  bytesWritten: number;
  /** 本次保存是否新建了文件（此前不存在）。 */
  created: boolean;
}
