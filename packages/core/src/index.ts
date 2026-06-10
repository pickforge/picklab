export const packageName = "@pickforge/picklab-core";

export {
  agentsDir,
  ensureDir,
  globalConfigPath,
  picklabHome,
  projectConfigPath,
  runsDir,
  sessionsDir,
  type EnvLike,
} from "./paths.js";

export {
  deepMerge,
  loadConfig,
  readConfigFile,
  resolvedDefaults,
  saveGlobalConfig,
  saveProjectConfig,
  type PicklabConfig,
  type PicklabProfile,
} from "./config.js";

export {
  createRun,
  listRuns,
  RunHandle,
  type ArtifactType,
  type CreateRunOptions,
  type RunArtifact,
  type RunManifest,
  type RunStatus,
} from "./run.js";

export { isSecretKey, redactEnv, redactSecrets } from "./redact.js";

export {
  CommandError,
  isPidAlive,
  runCommand,
  startDaemon,
  stopPid,
  type DaemonHandle,
  type RunCommandOptions,
  type RunCommandResult,
  type StartDaemonOptions,
} from "./proc.js";

export {
  captureToTarget,
  requireDisplay,
  resolveRunnableSession,
  resolveScreenshotTarget,
  type ResolveRunnableSessionOptions,
  type ResolveScreenshotTargetOptions,
  type RunnableSessionType,
  type ScreenshotTarget,
} from "./target.js";

export {
  createSession,
  destroySessionRecord,
  getSession,
  listSessions,
  updateSession,
  type AndroidSessionInfo,
  type CreateSessionInput,
  type DesktopSessionInfo,
  type SessionRecord,
  type SessionStatus,
  type SessionType,
} from "./session.js";
