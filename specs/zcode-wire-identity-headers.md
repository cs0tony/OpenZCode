# ZCode 线上身份请求头不变量

## 背景

官方（bigmodel / zai）按请求携带的客户端身份字段识别"ZCode 来源流量"，并据此在服务端结算时套用活动配额口径（如 150% 配额活动）。OpenZCode 品牌更名只允许发生在仓库名、界面文案与内部命名，**不得进入这些线上字段**；否则官方后端会把流量识别为非 ZCode 客户端，活动配额口径失效。

依据：对官方 ZCode 桌面端安装包（`app.asar` 内 host/main bundle 的 `buildZCodeSourceHeadersFromContext`）的逐字段比对。

## 覆盖通道

不变量约束两条出站通道，两条通道使用同一套官方值模板：

1. **平台端点流量**（OAuth、`client/configs`、`billing/balance`、遥测等）：由 `packages/shared/src/zcode-source-headers.ts` 的 `buildZCodeSourceHeadersFromContext` 构造，`NodeApiClient` 按 endpoint origin 统一注入。
2. **模型网关流量**（`/api/v1/zcode-plan/anthropic` 等模型请求）：由 `apps/zcode-cli/packages/bootstrap/src/model-config.ts` 的 `buildCliZCodeSourceHeaders` 构造，经 `createRuntimeAiSdkModelExecutionConfig` 的 `defaultHeaders` 合入每个模型请求（桌面内置 runtime 与独立 CLI 共用）。

## 不变量（wire identity headers）

`packages/shared/src/zcode-source-headers.ts` 构造的以下字段必须与官方 ZCode 客户端逐字节一致：

| 字段                  | 线上值                                                |
| --------------------- | ----------------------------------------------------- |
| `User-Agent`          | `ZCode/{appVersion}`，缺省 `ZCode/unknown`            |
| `X-ZCode-App-Version` | `{appVersion}`（有版本号时才携带）                    |
| `X-Title`             | `Z Code@{sourceTitle}`，缺省 `Z Code@electron`        |
| `HTTP-Referer`        | 请求目标 endpoint origin（缺省 `https://zcode.z.ai`） |

其余字段（`X-Device-Mid`、`X-Client-Language`、`X-Client-Timezone`、`X-Os-Category`、`X-Os-Version`、`X-Platform`、`X-Release-Channel`）为中性设备/环境信息，保持现有实现即可。

模型网关通道额外携带一个官方代理标识字段，同样不得品牌化：

| 字段            | 线上值 | 通道       |
| --------------- | ------ | ---------- |
| `X-ZCode-Agent` | `glm`  | 仅模型通道 |

## 规则

1. 任何品牌更名（如 OpenZCode）不得修改上表字段的字段名或值模板；也不得新增以品牌命名的线上请求头（如 `X-OpenZCode-*`）。
2. 界面可见品牌、日志文案、内部符号命名不受此约束。
3. 守卫测试：
   - `packages/shared/test/zcodeSourceHeaders.test.ts` 断言平台端点通道取值；
   - `apps/zcode-cli/packages/bootstrap/test/model-config-source-headers.test.ts` 断言模型网关通道取值。
     修改这些值前必须先更新本 spec 并说明官方口径变化。

## 事件记录

- `c60eb38`（应用可见品牌统一为 OpenZCode）误将模型网关通道的 `User-Agent`、`X-ZCode-App-Version`、`X-ZCode-Agent` 改为 OpenZCode 品牌值。
- `a8b3045`（恢复 ZCode 线上身份请求头）只恢复了平台端点通道，遗漏模型网关通道。
- 本次按 `872ad96` 初版的官方值补齐恢复模型网关通道，并新增守卫测试防止再次漂移。

## 验收场景

- `buildZCodeSourceHeadersFromContext({ appVersion: "3.14.3" })` 返回 `User-Agent: "ZCode/3.14.3"`、`X-ZCode-App-Version: "3.14.3"`、`X-Title: "Z Code@electron"`。
- 无 `appVersion` 时 `User-Agent` 为 `ZCode/unknown` 且不携带 `X-ZCode-App-Version`。
- `createRuntimeAiSdkModelExecutionConfig({ ZCODE_APP_VERSION: "3.14.4" }, { sourceTitle: "cli" })` 的 `defaultHeaders` 返回 `User-Agent: "ZCode/3.14.4"`、`X-ZCode-App-Version: "3.14.4"`、`X-Title: "Z Code@cli"`、`X-ZCode-Agent: "glm"`。
- 两条通道的所有线上头字段名与值均不包含 `openzcode`（大小写不敏感）。
