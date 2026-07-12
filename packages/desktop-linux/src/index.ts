export const packageName = "@pickforge/picklab-desktop-linux";

export {
  XvfbStartError,
  allocateDisplay,
  buildXvfbArgs,
  isDisplayAlive,
  parseDisplayNumber,
  startXvfb,
  stopXvfb,
  type AllocateDisplayOptions,
  type StartXvfbOptions,
  type XvfbPartialStart,
  type XvfbStartFailureReason,
  type XvfbArgsOptions,
  type XvfbHandle,
} from "./display.js";

export {
  buildVncArgs,
  detectVncBinary,
  startVnc,
  type StartVncOptions,
  type VncArgsOptions,
  type VncHandle,
} from "./vnc.js";

export {
  buildVncViewerArgs,
  detectVncViewer,
  openVncViewer,
  type DetectedVncViewer,
  type OpenVncViewerOptions,
  type OpenVncViewerResult,
  type VncViewerName,
} from "./viewer.js";

export {
  launchApp,
  listWindows,
  waitForWindow,
  type AppHandle,
  type LaunchAppOptions,
  type WindowInfo,
} from "./apps.js";

export {
  buildScreenshotCommand,
  detectScreenshotTool,
  screenshot,
  type ScreenshotOptions,
  type ScreenshotResult,
  type ScreenshotStep,
  type ScreenshotTool,
} from "./screenshot.js";

export {
  buildClickArgs,
  buildDoubleClickArgs,
  buildDragArgs,
  buildKeyArgs,
  buildMoveArgs,
  buildScrollArgs,
  buildTypeArgs,
  click,
  doubleClick,
  drag,
  MAX_DOUBLE_CLICK_INTERVAL_MS,
  MAX_DRAG_DURATION_MS,
  MAX_SCROLL_STEPS,
  move,
  pressKey,
  scroll,
  typeText,
  type ClickArgsOptions,
  type ClickOptions,
  type DoubleClickArgsOptions,
  type DoubleClickOptions,
  type DragArgsOptions,
  type DragOptions,
  type MoveArgsOptions,
  type MoveOptions,
  type PressKeyOptions,
  type ScrollArgsOptions,
  type ScrollOptions,
  type TypeTextOptions,
} from "./input.js";

export {
  createDesktopSession,
  desktopSessionLogDir,
  destroyDesktopSession,
  ensureSessionVnc,
  getDesktopSessionStatus,
  type CreateDesktopSessionOptions,
  type DesktopSessionHandle,
  type DesktopSessionStatus,
  type EnsureSessionVncOptions,
  type EnsuredSessionVnc,
} from "./session.js";

export { findOnPath } from "./util.js";
