# ZCode 线上身份请求头不变量

## 背景

官方（bigmodel / zai）按请求携带的客户端身份字段识别"ZCode 来源流量"，并据此在服务端结算时套用活动配额口径（如 150% 配额活动）。OpenZCode 品牌更名只允许发生在仓库名、界面文案与内部命名，**不得进入这些线上字段**；否则官方后端会把流量识别为非 ZCode 客户端，活动配额口径失效。

依据：对官方 ZCode 桌面端安装包（`app.asar` 内 host/main bundle 的 `buildZCodeSourceHeadersFromContext`）的逐字段比对。

## 不变量（wire identity headers）

`packages/shared/src/zcode-source-headers.ts` 构造的以下字段必须与官方 ZCode 客户端逐字节一致：

| 字段                  | 线上值                                                |
| --------------------- | ----------------------------------------------------- |
| `User-Agent`          | `ZCode/{appVersion}`，缺省 `ZCode/unknown`            |
| `X-ZCode-App-Version` | `{appVersion}`（有版本号时才携带）                    |
| `X-Title`             | `Z Code@{sourceTitle}`，缺省 `Z Code@electron`        |
| `HTTP-Referer`        | 请求目标 endpoint origin（缺省 `https://zcode.z.ai`） |

其余字段（`X-Device-Mid`、`X-Client-Language`、`X-Client-Timezone`、`X-Os-Category`、`X-Os-Version`、`X-Platform`、`X-Release-Channel`）为中性设备/环境信息，保持现有实现即可。

## 规则

1. 任何品牌更名（如 OpenZCode）不得修改上表字段的字段名或值模板。
2. 界面可见品牌、日志文案、内部符号命名不受此约束。
3. 守卫测试：`packages/shared/test/zcodeSourceHeaders.test.ts` 断言上表取值；修改这些值前必须先更新本 spec 并说明官方口径变化。

## 验收场景

- `buildZCodeSourceHeadersFromContext({ appVersion: "3.14.3" })` 返回 `User-Agent: "ZCode/3.14.3"`、`X-ZCode-App-Version: "3.14.3"`、`X-Title: "Z Code@electron"`。
- 无 `appVersion` 时 `User-Agent` 为 `ZCode/unknown` 且不携带 `X-ZCode-App-Version`。
