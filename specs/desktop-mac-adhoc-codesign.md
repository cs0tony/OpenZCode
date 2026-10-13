# Spec：桌面端 macOS 安装包默认走 ad-hoc 完整签名

## 背景与目标

`.github/workflows/package.yml` 在未配置 `MAC_CSC_LINK` / `MAC_CSC_KEY_PASSWORD` /
`MAC_SIGNING_IDENTITY` 三个 secrets 时，此前不设置 `ZCODE_ENABLE_MAC_SIGN`，
`electron-builder.config.js` 将 `mac.identity` 置为 `null`，electron-builder **整体跳过
签名**：.app 没有 CodeResources 密封资源，内部二进制仅保留 Electron 官方分发的
ad-hoc 签名，主程序与 Helper 的 bundle 密封因改名/改 Info.plist 已失效。

后果：安装包被浏览器下载后带 `com.apple.quarantine` 隔离属性，Gatekeeper 校验失败：

- Apple Silicon（arm64）：弹"应用已损坏，无法打开"（unsigned/ad-hoc 无受信证书链的
  固定行为）；
- Intel（x64）：通常弹"无法验证开发者"（老系统可右键打开，macOS 15 起改到系统设置）。

本 spec 将无证书路径从"跳过签名"改为"ad-hoc 完整签名"：产物具备完整有效的密封资源
（`codesign --verify --deep --strict` 通过），arm64 上移除隔离属性后必然可运行，经
非隔离渠道（brew、终端解压 zip/tar.gz、curl）分发时可直接打开。

**边界（诚实声明）**：ad-hoc 签名不能消除浏览器下载场景的"已损坏"弹窗——Gatekeeper
对无受信证书链的隔离应用一律按损坏拦截，无法从打包侧绕过。要"下载即可打开"只有
Developer ID 证书 + 公证一条路（付费 Apple Developer Program）。

## 决策

### 签名模式（唯一所有者：`electron-builder.config.js` mac 配置）

| 条件 | 模式 | mac.identity | hardenedRuntime | timestamp |
| --- | --- | --- | --- | --- |
| `ZCODE_ENABLE_MAC_SIGN=1` 且有 `APPLE_SIGNING_IDENTITY`/`CSC_NAME` | Developer ID 证书 | 归一化后的身份名 | true | 默认（联网 TSA） |
| 未配置证书 secrets（默认） | ad-hoc | `"-"` | false | `"none"` |
| `ZCODE_ENABLE_MAC_SIGN=1` 但无身份（Preview flavor） | 构建失败 | — | — | — |

- Preview 分支的失败守卫保留：显式要求证书签名的构建不允许静默降级成 ad-hoc，
  避免"产物存在"被误认为走了与生产相同的签名链路。
- ad-hoc 路径复用 electron-builder 26.8 原生支持（`identity: "-"` →
  `Identity("-")`，`identityValidation: false` 免钥匙串查找），底层 `@electron/osx-sign`
  会按依赖深度对 .app 内全部嵌套代码（framework/Helper/子 app）与所有裸 Mach-O
  （Resources 下的 rg/ugrep/bfs、macos-window-bounds、asar.unpacked 的 node-pty
  dylib 等）逐个 `codesign --sign -` 签名，结束后自动执行
  `codesign --verify --deep --strict`，失败即构建失败——签名完整性由打包链路自身校验。

### 不变量

- 证书模式（三 secrets 齐备）行为不变。
- `signIgnore` 的 glm/tools 排除列表已删除：那是上游 ZCode"独立 job 预签名 +
  notarization staple"的配套逻辑，本仓库没有预签名 job，保留会让这两个目录的
  可执行文件在 arm64 上处于未签名状态（执行即被 AMFI 杀死，strict 校验失败）。
- `notarize: false` 不变：本仓库无公证阶段，显式关闭避免 electron-builder 在
  build 阶段强要 Apple 凭据提前失败。
- entitlements 两个 plist、`gatekeeperAssess: false`、目标（dmg/zip）不变；
  Windows/Linux 打包不受影响。

### 失败语义

| 场景 | 行为 |
| --- | --- |
| ad-hoc 签名中任一 codesign 调用失败 | osx-sign 重试 3 次后构建失败，不打未密封产物 |
| 签名后 strict 校验不通过 | 构建失败（osx-sign 内置 verify） |
| 证书 secrets 只配了部分 | 不启用证书模式，静默降级 ad-hoc（workflow 日志明示） |
| Preview flavor 显式要求证书但无身份 | 配置层抛错，构建失败 |

## 用户侧语义（发版说明可直接引用）

- 浏览器下载 dmg/zip 安装后首次打开提示"已损坏"：终端执行
  `xattr -cr /Applications/<App>.app` 后即可正常打开。
- 通过 Homebrew / 终端 `unzip`/`tar` 解压 / curl 下载等不施加隔离属性的渠道分发时，
  ad-hoc 包可直接打开。

## 验收场景

1. 不配置 secrets 跑 `desktop` job（mac/arm64 与 mac/x64）：日志出现
   "使用 ad-hoc 身份完整签名"；构建内 `codesign --verify --deep --strict` 通过；
   产物 dmg/zip 内 .app 的 `codesign -dv` 显示 `Signature=adhoc`。
2. `xattr -cr` 后 arm64 应用启动正常，Resources 下工具（rg/ugrep 等）可被 host 调起。
3. 配置三个 secrets 后：行为与此前证书模式一致（hardened runtime、默认时间戳）。
4. Preview flavor + `ZCODE_ENABLE_MAC_SIGN=1` 无身份：构建失败并给出配置错误。
