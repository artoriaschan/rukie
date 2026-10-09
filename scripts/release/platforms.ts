export const BUILD_BUN_VERSION = "1.4.2";
export const MAIN_PACKAGE = "@rukie/coding-agent";

/** Each supported target owns its package and resources; Frontend execution stays shared. */
export const releasePlatforms = {
  "darwin-arm64": {
    os: "darwin",
    cpu: "arm64",
    machCpuType: 0x0100000c,
    packageName: "@rukie/coding-agent-darwin-arm64",
    bunTarget: "bun-darwin-arm64",
    ripgrepPackage: "@vscode/ripgrep-darwin-arm64",
    sharpPackage: "@img/sharp-darwin-arm64",
    vipsPackage: "@img/sharp-libvips-darwin-arm64",
    sharpBinary: "sharp-darwin-arm64-0.35.4.node",
    vipsBinary: "libvips-cpp.8.18.6.dylib",
  },
} as const;

export type ReleasePlatform = keyof typeof releasePlatforms;
export const DEFAULT_PLATFORM: ReleasePlatform = "darwin-arm64";

export function isReleasePlatform(value: unknown): value is ReleasePlatform {
  return typeof value === "string" && Object.hasOwn(releasePlatforms, value);
}
