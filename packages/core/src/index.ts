export const packageName = "@pickforge/picklab-core";

export {
  agentsDir,
  ensureDir,
  globalConfigPath,
  isProfileConfined,
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
  listProcessGroupMembers,
  processIdentityMatches,
  readProcessIdentity,
  readProcessStartTicks,
  runCommand,
  startDaemon,
  stopPid,
  stopProcessGroupVerified,
  type DaemonHandle,
  type ProcessIdentity,
  type RunCommandOptions,
  type RunCommandResult,
  type StartDaemonOptions,
  type StopProcessGroupOutcome,
  type StopProcessGroupResult,
} from "./proc.js";

export {
  captureToTarget,
  requireDisplay,
  resolveRunnableSession,
  resolveScreenshotTarget,
  sessionHasCapability,
  type ResolveRunnableSessionOptions,
  type ResolveScreenshotTargetOptions,
  type RunnableSessionType,
  type ScreenshotTarget,
  type SessionCapability,
} from "./target.js";

export {
  REAPER_CLEANUP_PENDING_META_KEY,
  createSession,
  destroySessionRecord,
  getSession,
  isDisplaySocketAlive,
  isSessionProcessAlive,
  listSessions,
  reapDeadRunningSessions,
  updateSession,
  type AndroidSessionInfo,
  type BrowserSessionInfo,
  type CreateSessionInput,
  type DesktopSessionInfo,
  type SessionLivenessCheck,
  type SessionRecord,
  type SessionStatus,
  type SessionType,
} from "./session.js";
