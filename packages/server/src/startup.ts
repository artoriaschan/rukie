import { homedir } from "node:os";
import {
  memorySecretEncryption,
  privateSecretEncryption,
  systemKeychainSecretEncryption,
  type SecretEncryption,
  type EncryptionBackend,
} from "./storage/secrets.ts";

/** Capture launch-only capabilities before tools inherit the normal system environment. */
export function readSidecarStartup(env: NodeJS.ProcessEnv): {
  homeDir: string;
  dataRoot: string;
  configurationRoot?: string;
  managementToken?: string;
  encryptionBackend: EncryptionBackend;
  encryption: SecretEncryption;
} {
  const dataRoot = env.RUKIE_DESKTOP_DATA_ROOT;
  const configurationRoot = env.RUKIE_DESKTOP_CONFIGURATION_ROOT;
  const homeDir = env.RUKIE_DESKTOP_HOME_DIR ?? homedir();
  const backend = env.RUKIE_DESKTOP_ENCRYPTION_BACKEND;
  const service = env.RUKIE_DESKTOP_SECRET_SERVICE;
  const secretUrl = env.RUKIE_DESKTOP_SECRET_URL;
  const secretToken = env.RUKIE_DESKTOP_SECRET_TOKEN;
  const managementToken = env.RUKIE_DESKTOP_MANAGEMENT_TOKEN;
  for (const name of Object.keys(env)) if (name.startsWith("RUKIE_DESKTOP_")) delete env[name];
  if (!dataRoot) throw new Error("Desktop sidecar requires an explicit application data root.");
  let encryption: SecretEncryption;
  switch (backend) {
    case "electron":
      if (!secretUrl || !secretToken)
        throw new Error("Electron encryption requires a private secret URL and token.");
      encryption = privateSecretEncryption(secretUrl, secretToken);
      break;
    case "system-keychain":
      if (!service?.trim()) throw new Error("System keychain encryption requires a service name.");
      encryption = systemKeychainSecretEncryption(service);
      break;
    case "memory":
      encryption = memorySecretEncryption();
      break;
    default:
      throw new Error("Desktop sidecar requires an explicit encryption backend.");
  }
  return {
    homeDir,
    dataRoot,
    configurationRoot,
    managementToken,
    encryptionBackend: backend,
    encryption,
  };
}
