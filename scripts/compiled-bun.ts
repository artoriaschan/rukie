/** Common compiled runtime contract for CLI releases and the desktop sidecar. */
export function compiledBunOptions(target: "bun-darwin-arm64", outfile: string) {
  return {
    target: "bun" as const,
    define: { RUKIE_COMPILED: "true" },
    env: "disable" as const,
    compile: {
      target,
      outfile,
      autoloadDotenv: false,
      autoloadBunfig: false,
      autoloadPackageJson: false,
      autoloadTsconfig: false,
    },
  };
}
