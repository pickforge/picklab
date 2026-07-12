export const packageName = "@pickforge/picklab-browser";

export {
  SUPPORTED_CHROME_BINARIES,
  detectChromeBinary,
  requireChromeBinary,
  type DetectChromeOptions,
} from "./detect.js";

export {
  browserRuntimeLayout,
  buildBrowserEnv,
  type BrowserRuntimeLayout,
  type BuildBrowserEnvOptions,
} from "./env.js";

export { buildChromeArgs, type BuildChromeArgsOptions } from "./args.js";

export {
  buildSupervisedBrowserCommand,
  type SupervisedBrowserCommand,
} from "./supervisor.js";

export {
  parseDevToolsActivePort,
  readDevToolsActivePort,
  waitForDevToolsPort,
  type DevToolsPortResult,
  type WaitForDevToolsPortOptions,
} from "./devtools.js";

export {
  browserSessionDir,
  createBrowserSession,
  destroyBrowserSession,
  getBrowserSessionStatus,
  type BrowserSessionHandle,
  type BrowserSessionStatus,
  type CreateBrowserSessionOptions,
} from "./session.js";
