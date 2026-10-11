import type {
  SettingsSyncDiscoveryResult,
  SettingsSyncClaudeAgentsFileCopyResult,
  SettingsSyncClaudeAgentsFileMigrationStatus,
  SettingsSyncFirstRunPromptState,
  SettingsSyncImportResult,
  SettingsSyncProgressEvent,
  SettingsSyncSelection,
  SettingsSyncUserAgentsFile,
  SettingsSyncUserAgentsFileWriteResult,
} from "@zcode/shared";
import { ServiceChannels } from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";

export interface ISettingsSyncService {
  getClaudeAgentsFileMigrationStatus(request: {
    workspacePath?: string;
    workspaceIdentity?: string;
  }): Promise<SettingsSyncClaudeAgentsFileMigrationStatus>;
  copyClaudeAgentsFileToZcodeAgentsFile(request?: {
    workspacePath?: string;
    workspaceIdentity?: string;
    overwrite?: boolean;
  }): Promise<SettingsSyncClaudeAgentsFileCopyResult>;
  /**
   * 读取用户级 AGENTS.md（~/.openzcode/AGENTS.md）。目标路径由 host 解析，
   * 渲染进程不传路径；文件不存在时 exists=false、content=null。
   */
  readUserAgentsFile(): Promise<SettingsSyncUserAgentsFile>;
  /**
   * 保存用户级 AGENTS.md。目标路径由 host 解析；写入原子（临时文件 + rename），
   * 超过 SETTINGS_SYNC_USER_AGENTS_FILE_MAX_BYTES 时拒绝。
   */
  writeUserAgentsFile(request: {
    content: string;
  }): Promise<SettingsSyncUserAgentsFileWriteResult>;
  detect(request: {
    workspacePath?: string;
    workspaceIdentity?: string;
    categories?: SettingsSyncSelection["category"][];
    intent?: "firstRun" | "manualImport";
  }): Promise<SettingsSyncDiscoveryResult>;
  importSelected(request: {
    workspacePath?: string;
    workspaceIdentity?: string;
    selections: SettingsSyncSelection[];
    onProgress?: (event: SettingsSyncProgressEvent) => void;
  }): Promise<SettingsSyncImportResult>;
  getFirstRunPromptState(): Promise<SettingsSyncFirstRunPromptState>;
  markFirstRunPromptHandled(): Promise<void>;
}

export const ISettingsSyncService = createServiceDescriptor<ISettingsSyncService>(
  ServiceChannels.SettingsSync,
);
