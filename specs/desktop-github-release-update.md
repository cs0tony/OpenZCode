# Spec：桌面端自动更新源切换为 OpenZCode GitHub Releases

## 背景与目标

桌面端自动更新此前复用官方 ZCode 的服务端 manifest feed
（`https://zcode.z.ai/api/v1/releases/electron/manifest`，常量
`DEFAULT_ZCODE_ENDPOINT_ORIGIN`）。OpenZCode 检测到并下载安装的是**官方 ZCode**
安装包，用户点击"下载更新 / 重启以更新"后 OpenZCode 会被官方版本覆盖。

本 spec 将桌面端（production flavor）默认更新源切换为本仓库的 GitHub Releases
（`https://github.com/cs0tony/OpenZCode`）。桌面安装包由
`.github/workflows/package.yml` 在 `v*` 标签触发时构建并附加到 GitHub Release，
产物命名规则（`electron-builder.config.js` 的 `buildDesktopArtifactName`）：

```
<productName>-<version>-<platform>-<arch>[<_TEST>].<ext>
# 例：OpenZCode-3.14.4-mac-arm64.zip / OpenZCode-3.14.4-win-x64.exe
#     OpenZCode-3.14.4-linux-x64.AppImage / ...._TEST.dmg
```

## 决策

### 唯一所有者

- 更新源选择与 GitHub feed 解析唯一所有者：
  `packages/desktop/src/main/githubReleaseUpdateProvider.ts`
  （`GitHubReleaseUpdateProvider extends Provider<UpdateInfo>`）。
- `packages/desktop/src/main/autoUpdater.ts` 的 feed 装配函数按以下规则二选一：
  - 启动参数/环境变量显式提供 manifest feed 覆盖（`--zcode-update-feed-url` /
    `ZCODE_UPDATE_FEED_URL`，仅 dev 态生效）→ 继续使用
    `ManifestUpdateProvider`（官方服务端 manifest，保留 dev 联调能力）；
  - 否则（正式包默认路径）→ 使用 `GitHubReleaseUpdateProvider`。
- `getLinuxUpdateExtensions`（按安装格式过滤 Linux 更新包）由
  `manifestUpdateProvider.ts` 导出，两个 provider 共用，不复制第二份。

### 更新检测语义

1. 请求 `GET https://api.github.com/repos/cs0tony/OpenZCode/releases/latest`
   （只返回最新正式 release，天然排除 prerelease/draft）。
2. `tag_name`（`v3.14.4`）去掉 `v` 前缀得到 semver 版本，交给 electron-updater
   既有版本比较逻辑（`update-available` / `update-not-available` 不变）。
3. 在 release `assets` 中按"平台段 + 架构段 + 扩展名"匹配唯一更新包：
   - darwin → `.zip`（MacUpdater 更新链路要求 zip；dmg 仅供手动安装）；
   - win32 → `.exe`（NSIS）；
   - linux → 按 updater 实例类型 `.AppImage` / `.deb` / `.rpm` / `.pkg.tar.zst`。
   - 架构段按别名集合匹配（electron-builder 各 Linux target 对 `${arch}` 的规范化名
     不一致，真实资产已验证）：x64 ↔ `x64` / `x86_64` / `amd64`，
     arm64 ↔ `arm64` / `aarch64`。
   - 文件名允许 `_TEST` 后缀（测试环境产物），匹配时不区分。
4. 找不到匹配资产、GitHub API 限流（403/429）、网络失败 → 抛错，由
   autoUpdater 既有 error 处理收敛回 idle 状态（可重试），不进入半更新状态。

### 不变量

- electron-updater 状态机、菜单/IPC 协议（`UpdateStateChanged`、
  `DownloadUpdate`、`QuitAndInstallUpdate` 等）、UI 入口（title bar 更新按钮、
  帮助菜单）全部不变；仅替换 feed 的"manifest 获取 + 更新文件解析"环节。
- Preview flavor 仍整体禁用 updater（`initAutoUpdater({ enabled: false })`），
  GitHub feed 只服务 production 身份。
- `resolveReleaseChannel` 回调保留：GitHub Releases 无 preview/stable 分线，
  两个 channel 检查同一 latest release；channel 值继续作为
  `skippedElectronUpdateVersions` 的持久化 key 与 stale 检测标记
  （`zcodeReleaseChannel` 字段），跳过版本、手动检查等行为不变。
- 校验边界：GitHub release asset 元数据不含 sha512，更新文件在运行时不携带
  checksum 字段，完整性依赖 HTTPS + GitHub 托管；electron-updater 按
  `sha512 != null` 决定是否启用下载校验，因此校验和字段必须缺省——
  若填空串会被当成真实校验和，导致每次下载都以校验失败告终。
  缓存命中路径的 sha512 比对对无 checksum 文件退化为"清缓存重新下载"，无功能影响。

### 失败语义

| 场景 | 行为 |
| --- | --- |
| GitHub API 不可达/限流 | provider 抛错 → 现有 `handleAutoUpdateFailure` → 回 idle，下个轮询周期重试 |
| release 无当前平台安装包（如某平台该版本未出包） | provider 抛 `no matching release asset` 错误，不误报"已是最新" |
| tag 非 semver | 抛错并带原始 tag 文本，便于排查发版问题 |

## 验收场景

1. production 包启动/手动检查更新：请求
   `api.github.com/repos/cs0tony/OpenZCode/releases/latest`；远端版本高于本地
   时菜单显示"发现更新 vX.Y.Z"，点击下载的是 OpenZCode 安装包（URL 为
   `github.com/cs0tony/OpenZCode/releases/download/...`）。
2. 远端版本不高于本地：`update-not-available`，菜单回到"检查更新"。
3. dev 态带 `ZCODE_UPDATE_FEED_URL` 启动：仍走官方服务端 manifest provider，
   用于联调服务端链路；打包态该覆盖被忽略（维持现有安全规则）。
4. Windows 下载的是 `-win-<arch>.exe`；macOS 下载的是 `-mac-<arch>.zip`；
   Linux AppImage/deb/rpm/pacman 安装各自匹配对应扩展名。
