import { DEFAULT_ZCODE_ENDPOINT_ORIGIN } from "./zcodeEndpoint.js";

// 线上身份字段必须与官方 ZCode 客户端逐字节一致（specs/zcode-wire-identity-headers.md）：
// 官方后端按这些字段识别 ZCode 来源流量并套用活动配额口径（如 150% 配额活动）。
// 品牌更名只允许发生在仓库名、界面文案与内部命名，不得进入这些线上请求头值。
export const ZCODE_SOURCE_HEADERS = {
  "User-Agent": "ZCode/unknown",
  "HTTP-Referer": DEFAULT_ZCODE_ENDPOINT_ORIGIN,
  "X-Title": "Z Code@electron",
} as const;

export interface BuildZCodeSourceHeadersFromContextOptions {
  appVersion?: string;
  arch?: string;
  clientLanguage?: string;
  clientTimezone?: string;
  deviceMid?: string;
  endpointOrigin?: string;
  osVersion?: string;
  platform?: string;
  releaseChannel?: string;
  sourceTitle?: string;
}

export function normalizeZCodeSourceHeaderValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !/^[\x20-\x7e]+$/.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

export function buildZCodeSourceHeadersFromContext(
  options: BuildZCodeSourceHeadersFromContextOptions = {},
): Record<string, string> {
  const appVersion = normalizeZCodeSourceHeaderValue(options.appVersion);
  const arch = normalizeZCodeSourceHeaderValue(options.arch);
  const clientLanguage = normalizeZCodeSourceHeaderValue(options.clientLanguage) ?? "unknown";
  const clientTimezone = normalizeZCodeSourceHeaderValue(options.clientTimezone) ?? "unknown";
  const deviceMid = normalizeZCodeSourceHeaderValue(options.deviceMid);
  const endpointOrigin =
    normalizeZCodeSourceHeaderValue(options.endpointOrigin) ?? DEFAULT_ZCODE_ENDPOINT_ORIGIN;
  const osVersion = normalizeZCodeSourceHeaderValue(options.osVersion);
  const platform = normalizeZCodeSourceHeaderValue(options.platform);
  const releaseChannel = normalizeZCodeSourceHeaderValue(options.releaseChannel);
  const sourceTitle = normalizeZCodeSourceHeaderValue(options.sourceTitle) ?? "electron";

  return {
    ...ZCODE_SOURCE_HEADERS,
    "HTTP-Referer": endpointOrigin,
    "User-Agent": `ZCode/${appVersion ?? "unknown"}`,
    ...(appVersion ? { "X-ZCode-App-Version": appVersion } : {}),
    "X-Title": `Z Code@${sourceTitle}`,
    ...(platform && arch ? { "X-Platform": `${platform}-${arch}` } : {}),
    ...(releaseChannel ? { "X-Release-Channel": releaseChannel } : {}),
    "X-Client-Language": clientLanguage,
    "X-Client-Timezone": clientTimezone,
    ...(platform ? { "X-Os-Category": normalizeOsCategory(platform) } : {}),
    ...(osVersion ? { "X-Os-Version": osVersion } : {}),
    ...(deviceMid ? { "X-Device-Mid": deviceMid } : {}),
  };
}

function normalizeOsCategory(platform: string): string {
  switch (platform) {
    case "darwin":
      return "macos";
    case "win32":
      return "windows";
    default:
      return "linux";
  }
}
