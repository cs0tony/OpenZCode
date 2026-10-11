# ZCode 线上身份不变量（请求头 + 模型可见文案）

## 背景与服务端识别分层

官方（bigmodel / zai）按多个层面识别"ZCode 来源流量"。依据：对官方 ZCode 桌面端 3.14.4 安装包
（`app.asar` 内 host/main bundle 与 `Resources/glm/zcode.cjs`，glm 运行时 0.13.3）的逐字段反编译比对，
以及对本仓库的全量比对。

1. **归因层（静态身份请求头）**：官方后端按请求携带的客户端身份字段识别"ZCode 来源流量"，
   并据此在服务端结算时套用活动配额口径（如 150% 配额活动）。OpenZCode 品牌更名只允许发生在
   仓库名、界面文案与内部命名，不得进入这些线上字段。
2. **强制校验层（ClientRequestSigningV4）**：官方模型通道另有服务端开关控制的密码学客户端证明协议——
   feature gate（`GET {origin}/api/v1/agent/configs` → `data.codingPlanSignature.enable`）启用后，
   客户端先经 `POST {模型网关同源}/api/paas/c1f3a7e2/v2/client` 握手换取 Ed25519 签名私钥
   （凭证为 `{apiKeyId}.{apiKeySecret}`，握手用 HKDF 派生 HMAC 签名，私钥经 AES-GCM 加密下发），
   随后每个模型请求附加 `X-Client-Ts`、`X-Client-Version`、`X-Client-Sig`、`X-Session-Id`、
   `X-Client-Nonce`、`X-App-Id`、`X-Client-Pow` 七个头（Ed25519 签名 + 8 前导零位 PoW）。
   官方 3.14.4 的适用范围：`zhipu-coding-plan-api-key` 访问类型、individual/team coding plan、
   `*.chatglm.site` 与 z.ai / bigmodel.cn 域名族；**start-plan 与 off-peak 明确豁免**。
   开源快照（`872ad96`）不含该机制，OpenZCode 当前源码亦无（全库 0 命中）。
3. **请求体指纹层（模型可见文案）**：系统提示词、子代理提示词、工具描述、system-reminder、
   附件错误文案等进入模型请求体的字符串，同样是服务端可指纹识别的客户端特征。

> 结论口径：静态身份头只是归因层，不是（也不曾是）服务端拦截的唯一依据。OpenZCode 在 start-plan
> 通道被 `provider_code=3012`（HTTP 405，"request has been blocked due to unusual activity"）拦截时，
> 该业务码在官方 3.14.4 客户端中同样不存在，属服务端风控判定；第 2/3 层与请求体之外的行为信号都是
> 候选原因，逐字节还原官方可观测面是当前可执行的对齐手段。

## 覆盖通道

不变量约束以下出站面：

1. **平台端点流量**（OAuth、`client/configs`、`billing/balance`、遥测等）：由
   `packages/shared/src/zcode-source-headers.ts` 的 `buildZCodeSourceHeadersFromContext` 构造，
   `NodeApiClient` 按 endpoint origin 统一注入。
2. **模型网关流量**（`/api/v1/zcode-plan/anthropic` 等模型请求）：由
   `apps/zcode-cli/packages/bootstrap/src/model-config.ts` 的 `buildCliZCodeSourceHeaders` 构造，
   经 `createRuntimeAiSdkModelExecutionConfig` 的 `defaultHeaders` 合入每个模型请求
   （桌面内置 runtime 与独立 CLI 共用）。
3. **模型可见文案**（系统提示词、子代理提示词、工具描述、system-reminder、附件错误文案）：
   散布在 `apps/zcode-cli/packages/core/src` 各提示词构造器中，见下表。
4. **WebFetch 出站 UA**（`apps/zcode-cli/packages/core/src/tool/handlers/webfetch-constants.ts`
   的 `WEBFETCH_USER_AGENT`）：抓取第三方网页时的 User-Agent，属线上出站身份字段。

## 不变量（wire identity headers）

`packages/shared/src/zcode-source-headers.ts` 构造的以下字段必须与官方 ZCode 客户端逐字节一致：

| 字段                  | 线上值                                                |
| --------------------- | ----------------------------------------------------- |
| `User-Agent`          | `ZCode/{appVersion}`，缺省 `ZCode/unknown`            |
| `X-ZCode-App-Version` | `{appVersion}`（有版本号时才携带）                    |
| `X-Title`             | `Z Code@{sourceTitle}`，缺省 `Z Code@electron`        |
| `HTTP-Referer`        | 请求目标 endpoint origin（缺省 `https://zcode.z.ai`） |

其余字段（`X-Device-Mid`、`X-Client-Language`、`X-Client-Timezone`、`X-Os-Category`、`X-Os-Version`、
`X-Platform`、`X-Release-Channel`）为中性设备/环境信息，保持现有实现即可。

模型网关通道额外携带一个官方代理标识字段，同样不得品牌化：

| 字段            | 线上值 | 通道       |
| --------------- | ------ | ---------- |
| `X-ZCode-Agent` | `glm`  | 仅模型通道 |

## 不变量（模型可见文案）

`apps/zcode-cli/packages/core/src` 中以下字符串必须与官方 ZCode 线上文案逐字一致（品牌词为 `ZCode`）：

| 文案（品牌词处）                                                                                                                                                | 所有者                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| CLI prefix：`You are ZCode, an interactive coding agent`                                                                                                        | `context/sections/cli-prefix.ts`                              |
| Agent Identity 开场句：`…while using ZCode's tools and instructions.` / `You are an interactive ZCode agent that helps users with software engineering tasks.`  | `context/sections/identity.ts`                                |
| Desktop Context 段名/标题：`ZCode Desktop Context`、`# ZCode Desktop Context`                                                                                   | `context/sections/desktop.ts`                                 |
| Explore 子代理开场句：`You are ZCode Explore, a file search and codebase research specialist for ZCode CLI. …`                                                  | `subagent/explore.ts`                                         |
| GeneralPurpose 子代理开场句：`You are an agent for ZCode CLI. …`                                                                                                | `subagent/general-purpose.ts`                                 |
| Workflow 提示词：`You are running the ZCode workflow phase`、`…a ZCode workflow node inside phase/for phase`、`…a ZCode workflow exploration planner for phase` | `workflow/expert/prompts.ts`、`workflow/scheduler/prompts.ts` |
| ReadSessionContext 工具描述（capability/description/modelInstructions/reason）                                                                                  | `tool/handlers/read-session-context.ts`                       |
| Task 工具别名 capability：`Claude Code-compatible alias for launching a ZCode subagent`                                                                         | `tool/handlers/agent.ts`                                      |
| Read 工具视频上限描述：`subject to ZCode's video input limit`                                                                                                   | `tool/handlers/read.ts`                                       |
| 附件错误原因：`the video is larger than the ZCode video input limit`                                                                                            | `runtime/helpers/attachment-path-reference.ts`                |
| ExitPlanMode 说明：`required plan parameter in ZCode`                                                                                                           | `tool/handlers/plan-mode-prompts.ts`                          |
| system-reminder：mid-turn / peer session 文案中的 `ZCode`                                                                                                       | `system-reminder/incoming-message.ts`                         |
| 会话引用提醒：`The user referenced prior ZCode session(s) in this prompt:`                                                                                      | `session-context/references.ts`                               |
| in-app browser 请求行：`## My request for ZCode:`                                                                                                               | `runtime/helpers/conversation.ts`                             |
| 连通性探针：`You are ZCode connectivity probe.`                                                                                                                 | `runtime/methods/workspace-generate-text.ts`                  |
| WebFetch 出站 UA：`ZCode-WebFetch/0.1 (+https://zcode.ai; coding-agent-cli)`                                                                                    | `tool/handlers/webfetch-constants.ts`                         |

**例外**：承载 fork 真实文件系统路径的字符串按 `specs/environment-isolation-from-zcode.md` 保持隔离目录，
不得"还原"为官方路径（当前唯一豁免：`tool/handlers/list-saved-workflows.ts` 描述中的 `~/.openzcode/workflows`）。

**判定规则**：能与官方安装包逐字比对时以比对结果为准；无法比对时，等价品牌词替换（OpenZCode → ZCode）
即为官方口径。日志文案、代码注释、UI 可见文案不受此约束。

## 规则

1. 任何品牌更名（如 OpenZCode）不得修改上表字段的字段名或值模板；也不得新增以品牌命名的线上请求头
   （如 `X-OpenZCode-*`）。
2. 品牌更名同样不得进入"模型可见文案"表中的任何字符串与 WebFetch UA；承载 fork 真实文件系统路径的
   字符串除外。
3. 界面可见品牌、日志文案、内部符号命名与代码注释不受此约束。
4. 守卫测试：
   - `packages/shared/test/zcodeSourceHeaders.test.ts` 断言平台端点通道取值；
   - `apps/zcode-cli/packages/bootstrap/test/model-config-source-headers.test.ts` 断言模型网关通道取值；
   - `apps/zcode-cli/packages/core/test/wire-visible-prompt-brand.test.ts` 断言模型可见文案与出站 UA
     取值，并扫描 `core/src` 非注释行不含 `openzcode`（`.openzcode` 真实路径豁免）。
     修改这些值前必须先更新本 spec 并说明官方口径变化。

## 事件记录

- `c60eb38`（应用可见品牌统一为 OpenZCode）误将模型网关通道的 `User-Agent`、`X-ZCode-App-Version`、
  `X-ZCode-Agent` 改为 OpenZCode 品牌值，同时波及模型可见文案（系统提示词、子代理提示词、工具描述、
  system-reminder、WebFetch UA 等）。
- `a8b3045`（恢复 ZCode 线上身份请求头）只恢复了平台端点通道，遗漏模型网关通道。
- `701c966` 按 `872ad96` 初版的官方值补齐恢复模型网关通道，并新增守卫测试防止再次漂移。
- 2026-10-11：对官方 3.14.4 安装包全量比对确认服务端识别分层（归因头 / ClientRequestSigningV4 /
  请求体指纹），纠正本 spec 此前"官方仅按请求头识别"的口径；还原全部模型可见文案为官方措辞，
  并将守卫测试扩展到请求体。

## 验收场景

- `buildZCodeSourceHeadersFromContext({ appVersion: "3.14.3" })` 返回 `User-Agent: "ZCode/3.14.3"`、
  `X-ZCode-App-Version: "3.14.3"`、`X-Title: "Z Code@electron"`。
- 无 `appVersion` 时 `User-Agent` 为 `ZCode/unknown` 且不携带 `X-ZCode-App-Version`。
- `createRuntimeAiSdkModelExecutionConfig({ ZCODE_APP_VERSION: "3.14.4" }, { sourceTitle: "cli" })`
  的 `defaultHeaders` 返回 `User-Agent: "ZCode/3.14.4"`、`X-ZCode-App-Version: "3.14.4"`、
  `X-Title: "Z Code@cli"`、`X-ZCode-Agent: "glm"`。
- `buildCliPrefixSection().content` 为 `You are ZCode, an interactive coding agent`；
  `buildIdentitySection()` 内容含 `You are an interactive ZCode agent that helps users with software
engineering tasks.` 且不含 `OpenZCode`。
- `buildExploreAgentPrompt({})`、`buildGeneralPurposeSystemPrompt()` 开场句品牌词为 `ZCode`；
  `WEBFETCH_USER_AGENT` 为 `ZCode-WebFetch/0.1 (+https://zcode.ai; coding-agent-cli)`。
- `apps/zcode-cli/packages/core/src` 所有非注释行不含 `openzcode`（`.openzcode` 真实路径豁免）。
- 两条通道的所有线上头字段名与值均不包含 `openzcode`（大小写不敏感）。
