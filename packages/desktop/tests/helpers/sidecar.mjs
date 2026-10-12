if (
  ["BUN_BE_BUN", "BUN_OPTIONS", "NODE_OPTIONS"].some((name) => process.env[name]) ||
  Object.keys(process.env).some((name) => name.startsWith("DYLD_"))
)
  process.exit(2);
process.on("SIGTERM", () => {
  if (!process.argv.includes("--ignore-term")) process.exit(0);
});
if (!process.argv.includes("--no-handshake"))
  console.log(
    JSON.stringify({
      port: 32123,
      token: process.argv.includes("--data-root-token")
        ? JSON.stringify({
            dataRoot: process.env.RUKIE_DESKTOP_DATA_ROOT,
            configurationRoot: process.env.RUKIE_DESKTOP_CONFIGURATION_ROOT,
            homeDir: process.env.RUKIE_DESKTOP_HOME_DIR,
            encryptionBackend: process.env.RUKIE_DESKTOP_ENCRYPTION_BACKEND,
          })
        : process.argv.includes("--env-token")
          ? process.env.RUKIE_TEST_PROVIDER_KEY
          : process.argv.includes("--pid-token")
            ? String(process.pid)
            : "test-token",
    }),
  );
process.stdin.resume();
// A child-owned interval keeps the fake process alive; only parent deadlines use fake time.
setInterval(() => {}, 60_000);
