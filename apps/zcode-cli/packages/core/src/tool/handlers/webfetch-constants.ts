export const WEBFETCH_TOOL_NAME = "WebFetch";
export const DEFAULT_WEBFETCH_TIMEOUT_MS = 60_000;
export const MAX_WEBFETCH_URL_CHARS = 2_000;
export const MAX_WEBFETCH_RESPONSE_BYTES = 10 * 1024 * 1024;
export const MAX_MODEL_INPUT_CHARS = 100_000;
export const MAX_WEBFETCH_MODEL_BYTES = 100_000;
export const CACHE_TTL_MS = 15 * 60 * 1000;
export const CACHE_MAX_BYTES = 50 * 1024 * 1024;
export const MAX_REDIRECTS = 10;

// 线上出站身份字段，与官方 ZCode 逐字一致（specs/zcode-wire-identity-headers.md），不得品牌化。
export const WEBFETCH_USER_AGENT = "ZCode-WebFetch/0.1 (+https://zcode.ai; coding-agent-cli)";
