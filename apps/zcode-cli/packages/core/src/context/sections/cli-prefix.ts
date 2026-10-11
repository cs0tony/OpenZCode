// ============================================================
// CLI Prefix Section Builder
// ============================================================

import type { ContextSection } from "../types.js";
import { estimateTokens } from "../utils.js";

// 模型可见文案必须与官方 ZCode 逐字一致（specs/zcode-wire-identity-headers.md）：
// 服务端可按请求体指纹识别客户端，品牌更名不得进入本字符串。
const CLI_PREFIX_PROMPT = "You are ZCode, an interactive coding agent";

export function buildCliPrefixSection(): ContextSection {
  const content = CLI_PREFIX_PROMPT;

  return {
    name: "CLI Prefix",
    source: "cli_prefix",
    injectionTarget: "system",
    cacheHint: "stable",
    chars: content.length,
    tokens: estimateTokens(content),
    content,
    preview: content.slice(0, 100),
  };
}
