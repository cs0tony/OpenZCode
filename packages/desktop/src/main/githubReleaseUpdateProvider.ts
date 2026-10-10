import type { CustomPublishOptions } from "builder-util-runtime";
import { Provider, type AppUpdater, type ResolvedUpdateFileInfo, type UpdateFileInfo, type UpdateInfo } from "electron-updater";
import type { ProviderRuntimeOptions } from "electron-updater/out/providers/Provider.js";
import type { ElectronReleaseChannel } from "@zcode/shared";
import semver from "semver";
import { getElectronReleasePlatform, getLinuxUpdateExtensions } from "./manifestUpdateProvider.js";

// OpenZCode 桌面包由 .github/workflows/package.yml 在 v* 标签触发时构建并附加到
// GitHub Release。桌面自动更新源必须指向本仓库，而不是官方 ZCode 服务端 manifest：
// 继续请求 zcode.z.ai 会检测并下载官方安装包，用户点击更新后 OpenZCode 被官方版覆盖。
export const OPEN_ZCODE_RELEASE_REPO = "cs0tony/OpenZCode";

// GitHub /releases/latest 只返回最新正式 release（自动排除 prerelease/draft），
// 与 stable 语义一致，也避免了自行解析 releases 列表时的排序与过滤成本。
const GITHUB_LATEST_RELEASE_API = `https://api.github.com/repos/${OPEN_ZCODE_RELEASE_REPO}/releases/latest`;

// GitHub API 对未认证请求要求显式 User-Agent，否则返回 403。
const GITHUB_API_ACCEPT_HEADER = "application/vnd.github+json";
const GITHUB_API_USER_AGENT = "OpenZCode-Desktop-Updater";

// 与 electron-builder.config.js 的 buildDesktopArtifactName 保持一致：
// `<productName>-<version>-<platform>-<arch>[<_TEST>].<ext>`。
// platform 段只有 mac/win/linux 三种；_TEST 只出现在测试后端的安装包上。
type DesktopArtifactPlatform = "mac" | "win" | "linux";

// darwin 的自动更新走 Squirrel.Mac，只接受 zip；dmg 仅用于手动安装，不能进更新链路。
const DARWIN_UPDATE_EXTENSIONS = ["zip"] as const;
// Windows NSIS 更新链路只接受 exe。
const WINDOWS_UPDATE_EXTENSIONS = ["exe"] as const;

interface GitHubReleaseUpdateProviderOptions extends CustomPublishOptions {
  releaseChannel?: ElectronReleaseChannel;
  resolveReleaseChannel?: () => ElectronReleaseChannel | Promise<ElectronReleaseChannel>;
}

interface GitHubReleaseAssetLike {
  name?: string | null;
  browserDownloadUrl: string;
}

interface GitHubLatestReleaseLike {
  tagName: string;
  releaseName: string | null;
  releaseBody: string | null;
  publishedAt: string | null;
  assets: GitHubReleaseAssetLike[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function parseGitHubLatestRelease(payload: unknown): GitHubLatestReleaseLike {
  if (!isRecord(payload)) {
    throw new Error(`Invalid GitHub latest release payload: ${GITHUB_LATEST_RELEASE_API}`);
  }

  const tagName = readString(payload["tag_name"]);
  if (!tagName) {
    throw new Error(`GitHub latest release payload has no tag_name: ${GITHUB_LATEST_RELEASE_API}`);
  }

  const assets = Array.isArray(payload["assets"])
    ? payload["assets"]
        .filter(isRecord)
        .map((asset): GitHubReleaseAssetLike | null => {
          const name = readString(asset["name"]);
          const browserDownloadUrl = readString(asset["browser_download_url"]);
          if (!name || !browserDownloadUrl) {
            return null;
          }
          return { name, browserDownloadUrl };
        })
        .filter((asset): asset is GitHubReleaseAssetLike => asset !== null)
    : [];

  return {
    tagName,
    releaseName: readString(payload["name"]),
    releaseBody: readString(payload["body"]),
    publishedAt: readString(payload["published_at"]),
    assets,
  };
}

function getDesktopArtifactPlatform(platform: NodeJS.Platform): DesktopArtifactPlatform {
  switch (platform) {
    case "darwin":
      return "mac";
    case "win32":
      return "win";
    case "linux":
      return "linux";
    default:
      throw new Error(`Unsupported desktop update platform: ${String(platform)}`);
  }
}

function getDesktopUpdateExtensions(
  platform: DesktopArtifactPlatform,
  linuxExtensions: readonly string[] | null,
): readonly string[] {
  switch (platform) {
    case "mac":
      return DARWIN_UPDATE_EXTENSIONS;
    case "win":
      return WINDOWS_UPDATE_EXTENSIONS;
    case "linux":
      // Linux 的实际更新器由安装包类型决定（AppImage/deb/rpm/pacman），
      // 复用 manifest provider 的同一套扩展名映射，避免两处规则漂移。
      // getLinuxUpdateExtensions 返回带前导点的扩展名，这里统一去掉，避免拼接出 ".." 后缀。
      return (linuxExtensions ?? []).map((extension) => extension.replace(/^\./, ""));
  }
}

// electron-builder 各 Linux target 对 ${arch} 占位符的规范化名不一致：
// deb 用 amd64/arm64，rpm 用 x86_64/aarch64，AppImage 用 x86_64/arm64，
// pacman 用 x64/aarch64（真实 release 资产已验证）。按别名集合匹配，
// 避免某个安装格式因架构段写法不同而永远匹配不到更新包。
const ARCH_ALIASES: Record<string, readonly string[]> = {
  x64: ["x64", "x86_64", "amd64"],
  arm64: ["arm64", "aarch64"],
};

/**
 * 按 workflow 产物命名规则匹配当前平台的更新包。
 * 匹配边界是 "-<platform>-<arch>" 段（productName 可含空格/连字符，不能整串前缀匹配），
 * _TEST 后缀只标记后端环境，不影响更新包识别。
 */
function matchesDesktopAssetName(
  assetName: string,
  platform: DesktopArtifactPlatform,
  arch: string,
  extensions: readonly string[],
): boolean {
  const lowered = assetName.toLowerCase();
  const archAliases = ARCH_ALIASES[arch] ?? [arch];
  return extensions.some((extension) =>
    archAliases.some((archAlias) =>
      [
        `-${platform}-${archAlias}.${extension}`,
        `-${platform}-${archAlias}_test.${extension}`,
      ].some((suffix) => lowered.endsWith(suffix)),
    ),
  );
}

function normalizeReleaseTagName(tagName: string): string {
  const version = tagName.trim().replace(/^v/i, "");
  // 发版 tag 必须 semver 可解析；否则版本比较（semver.gt）行为不可预期，
  // 宁可让本次检查显式失败，也不能把非法版本当成"已是最新"。
  if (!semver.valid(version)) {
    throw new Error(`GitHub release tag is not a valid semver version: ${tagName}`);
  }
  return version;
}

export class GitHubReleaseUpdateProvider extends Provider<UpdateInfo> {
  private readonly options: GitHubReleaseUpdateProviderOptions;
  private readonly releasePlatform: string;
  private readonly linuxExtensions: readonly string[] | null;
  // getLatestVersion（检查更新）阶段填充，resolveFiles（下载）阶段消费；
  // 与 ManifestUpdateProvider.resolveBaseUrl 相同的两阶段初始化，不能声明为 readonly。
  private releaseFiles: UpdateFileInfo[];

  constructor(
    options: GitHubReleaseUpdateProviderOptions,
    updater: AppUpdater,
    runtimeOptions: ProviderRuntimeOptions,
  ) {
    super(runtimeOptions);
    this.options = options;
    this.releasePlatform = getElectronReleasePlatform();
    this.linuxExtensions = getLinuxUpdateExtensions(updater);
    // resolveFiles 在 getLatestVersion 之后调用；先用空数组占位保持实例可构造。
    this.releaseFiles = [];
  }

  override get isUseMultipleRangeRequest(): boolean {
    // GitHub release asset 下载不支持 electron-updater 的 multipart Range 语义，
    // 与内置 GitHubProvider 保持一致，避免差分下载误判。
    return false;
  }

  override async getLatestVersion(): Promise<UpdateInfo> {
    // GitHub Releases 没有 preview/stable 分线，两个 channel 检查同一条线；
    // 保留 resolveReleaseChannel 是为了让 channel 值继续充当
    // skippedElectronUpdateVersions 的持久化 key 和 stale 检测标记。
    const releaseChannel = await this.resolveReleaseChannel();
    const raw = await this.httpRequest(new URL(GITHUB_LATEST_RELEASE_API), {
      accept: GITHUB_API_ACCEPT_HEADER,
      "user-agent": GITHUB_API_USER_AGENT,
    });
    if (!raw) {
      throw new Error(`Empty GitHub latest release response: ${GITHUB_LATEST_RELEASE_API}`);
    }

    let release: GitHubLatestReleaseLike;
    try {
      release = parseGitHubLatestRelease(JSON.parse(raw));
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid GitHub latest release JSON: ${GITHUB_LATEST_RELEASE_API}`);
      }
      throw error;
    }

    const version = normalizeReleaseTagName(release.tagName);
    const platform = getDesktopArtifactPlatform(process.platform);
    const extensions = getDesktopUpdateExtensions(platform, this.linuxExtensions);
    const updateAssets = release.assets.filter((asset) =>
      matchesDesktopAssetName(asset.name ?? "", platform, process.arch, extensions),
    );
    if (updateAssets.length === 0) {
      throw new Error(
        `GitHub release ${release.tagName} has no ${this.releasePlatform} update asset ` +
          `(expected extensions: ${extensions.join(", ") || "n/a"})`,
      );
    }

    // UpdateFileInfo 的类型声明要求必填 sha512，但 GitHub asset 元数据不提供校验和，
    // 运行时必须让字段缺省：下载器按 `sha512 != null` 决定是否启用 DigestTransform 校验，
    // 若填空串会被当成真实校验和，导致每次下载都以校验失败告终。
    // 这里用类型断言满足声明、运行时不携带该字段，完整性依赖 HTTPS + GitHub 托管。
    this.releaseFiles = updateAssets.map(
      (asset) => ({ url: asset.browserDownloadUrl }) as UpdateFileInfo,
    );

    return {
      version,
      files: this.releaseFiles,
      path: updateAssets[0]?.name ?? "",
      // UpdateInfo 必填的遗留字段；运行时只读 files[].info.sha512，不读顶层值，此占位无行为影响。
      sha512: "",
      releaseName: release.releaseName ?? release.tagName,
      ...(release.releaseBody ? { releaseNotes: release.releaseBody } : {}),
      ...(release.publishedAt ? { releaseDate: release.publishedAt } : {}),
      // 与 ManifestUpdateProvider 相同：把本次请求通道随 UpdateInfo 带回去，
      // main 进程靠它做旧通道结果的 stale 判定。
      zcodeReleaseChannel: releaseChannel,
    } as UpdateInfo;
  }

  override resolveFiles(updateInfo: UpdateInfo): ResolvedUpdateFileInfo[] {
    // getLatestVersion 已按平台/架构筛选出唯一格式的更新包，这里只需把完整
    // 下载 URL 解析为 URL 对象交给 electron-updater 下载器。
    const files = updateInfo.files.length > 0 ? updateInfo.files : this.releaseFiles;
    return files.map((fileInfo) => ({
      url: new URL(fileInfo.url),
      info: fileInfo,
    }));
  }

  private async resolveReleaseChannel(): Promise<ElectronReleaseChannel> {
    const resolved =
      (await this.options.resolveReleaseChannel?.()) ?? this.options.releaseChannel ?? "stable";
    return resolved === "preview" ? "preview" : "stable";
  }
}
