import { useCallback, useEffect, useRef, useState } from "react";
import { FolderOpen, RotateCcw, Save } from "lucide-react";
import { SETTINGS_SYNC_USER_AGENTS_FILE_MAX_BYTES } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Textarea } from "@/components/ui/textarea.js";
import { toast } from "@/components/ui/toast.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SettingsGroupCard } from "@/settings/SettingsPageParts.js";
import { logger } from "@/logger.js";

interface PersonalizationSectionProps {
  isDesktop?: boolean;
}

type UserAgentsFileState = {
  path: string;
  directoryPath: string;
  exists: boolean;
  content: string;
};

function utf8ByteLength(content: string): number {
  return new TextEncoder().encode(content).length;
}

/**
 * 个性化：编辑用户级全局指令文件 ~/.openzcode/AGENTS.md（唯一事实在磁盘，
 * 服务端不缓存）。保存即落盘，agent 在下一次上下文构建时自动读取；
 * 文件不存在时保存即创建。行为规则见 specs/settings-personalization-user-agents-md.md。
 */
export function PersonalizationSection({ isDesktop = false }: PersonalizationSectionProps) {
  const { intl } = useZCodeIntl();
  const platform = usePlatform();
  const { settingsSyncService } = useServices();

  const [loaded, setLoaded] = useState<UserAgentsFileState | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const loadVersionRef = useRef(0);

  const load = useCallback(async () => {
    const version = loadVersionRef.current + 1;
    loadVersionRef.current = version;
    setLoading(true);
    setLoadFailed(false);
    try {
      const result = await settingsSyncService.readUserAgentsFile();
      if (loadVersionRef.current !== version) {
        return;
      }
      setLoaded({
        path: result.path,
        directoryPath: result.directoryPath,
        exists: result.exists,
        content: result.content ?? "",
      });
      setDraft(result.content ?? "");
    } catch (error) {
      if (loadVersionRef.current !== version) {
        return;
      }
      // 读失败时禁用编辑与保存：用户可能在看不到现有内容的情况下误覆盖。
      logger.warn("[PersonalizationSection] 读取用户级 AGENTS.md 失败", {
        error: error instanceof Error ? error.message : String(error),
      });
      setLoaded(null);
      setDraft("");
      setLoadFailed(true);
      toast(intl.formatMessage({ id: "settings.personalization.loadFailed" }));
    } finally {
      if (loadVersionRef.current === version) {
        setLoading(false);
      }
    }
  }, [intl, settingsSyncService]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = useCallback(async () => {
    if (utf8ByteLength(draft) > SETTINGS_SYNC_USER_AGENTS_FILE_MAX_BYTES) {
      toast(intl.formatMessage({ id: "settings.personalization.tooLarge" }));
      return;
    }
    setSaving(true);
    try {
      await settingsSyncService.writeUserAgentsFile({ content: draft });
      setLoaded((previous) =>
        previous
          ? {
              ...previous,
              exists: true,
              content: draft,
            }
          : previous,
      );
      toast(intl.formatMessage({ id: "settings.personalization.saved" }));
    } catch (error) {
      // 保存失败不回滚 draft：编辑框内容保留，用户可直接重试。
      logger.warn("[PersonalizationSection] 保存用户级 AGENTS.md 失败", {
        error: error instanceof Error ? error.message : String(error),
      });
      toast(intl.formatMessage({ id: "settings.personalization.saveFailed" }));
    } finally {
      setSaving(false);
    }
  }, [draft, intl, settingsSyncService]);

  // 保存语义是"把编辑框内容落盘"：文件未创建时即使未编辑也允许保存，
  // 否则用户第一次进页面无法创建文件；已存在时按"有修改才可保存"门控。
  const canSave = loaded !== null && !loadFailed && (!loaded.exists || draft !== loaded.content);
  const dirty = loaded !== null && loaded.exists && draft !== loaded.content;

  const handleReveal = useCallback(async () => {
    if (!loaded) {
      return;
    }
    const result = await platform.openInFileManager(loaded.directoryPath);
    if (!result.success) {
      toast(intl.formatMessage({ id: "settings.personalization.revealFailed" }));
    }
  }, [intl, loaded, platform]);

  return (
    <div className="space-y-3">
      <div className="text-ui-base leading-6 text-foreground-subtle">
        {intl.formatMessage({ id: "settings.personalization.description" })}
      </div>
      <SettingsGroupCard>
        <div className="space-y-3 px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-ui-base text-foreground-subtle">
              {intl.formatMessage({ id: "settings.personalization.pathLabel" })}
            </span>
            <span className="min-w-0 break-all font-mono text-ui-sm text-foreground">
              {loaded?.path ?? ""}
            </span>
            {isDesktop ? (
              <Button
                variant="outline"
                size="sm"
                disabled={!loaded?.exists || loading || saving}
                title={
                  loaded?.exists
                    ? undefined
                    : intl.formatMessage({ id: "settings.personalization.revealHint" })
                }
                onClick={() => void handleReveal()}
                data-testid="settings-personalization-reveal"
              >
                <FolderOpen className="size-4" />
                {intl.formatMessage({ id: "settings.personalization.reveal" })}
              </Button>
            ) : null}
          </div>
          {loadFailed ? (
            <div className="flex items-center gap-2">
              <span className="text-ui-base text-foreground-subtle">
                {intl.formatMessage({ id: "settings.personalization.loadFailedHint" })}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={loading || saving}
                onClick={() => void load()}
                data-testid="settings-personalization-retry"
              >
                <RotateCcw className="size-4" />
                {intl.formatMessage({ id: "settings.personalization.retry" })}
              </Button>
            </div>
          ) : null}
          {loaded !== null && !loaded.exists ? (
            <div className="text-ui-base leading-6 text-foreground-subtle">
              {intl.formatMessage({ id: "settings.personalization.notCreatedHint" })}
            </div>
          ) : null}
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // 编辑器内 Ctrl/Cmd+S 与点保存按钮等价（preventDefault 阻止浏览器默认行为）；
              // 门控与按钮一致（canSave）。
              if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
                event.preventDefault();
                if (canSave && !saving && !loading) {
                  void handleSave();
                }
              }
            }}
            spellCheck={false}
            disabled={loading || saving || loadFailed}
            className="min-h-64 w-full font-mono text-ui-base"
            aria-label={intl.formatMessage({ id: "settings.personalization.editorLabel" })}
            data-testid="settings-personalization-editor"
          />
          <div className="flex items-center gap-2">
            <Button
              variant="default"
              size="sm"
              disabled={!canSave || saving || loading}
              onClick={() => void handleSave()}
              data-testid="settings-personalization-save"
            >
              <Save className="size-4" />
              {intl.formatMessage({ id: "settings.personalization.save" })}
            </Button>
            {dirty ? (
              <span className="text-ui-base text-foreground-subtle">
                {intl.formatMessage({ id: "settings.personalization.unsaved" })}
              </span>
            ) : null}
            <span className="text-ui-base text-foreground-subtle">
              {intl.formatMessage({ id: "settings.personalization.effectHint" })}
            </span>
          </div>
        </div>
      </SettingsGroupCard>
    </div>
  );
}
