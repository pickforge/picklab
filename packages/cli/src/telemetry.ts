import { createRequire } from "node:module";
import * as Sentry from "@sentry/node";
import { redactSecrets } from "@pickforge/picklab-core";

export type EnvLike = Record<string, string | undefined>;

const DSN =
  "https://25cc6307aeca0d1d454e0af21bee5498@o4511699702317056.ingest.us.sentry.io/4511699813990400";

const DISABLE_VALUES = new Set(["0", "false", "off"]);

export function telemetryEnabled(env: EnvLike = process.env): boolean {
  const value = env.PICKLAB_TELEMETRY?.trim();
  if (value === undefined || value === "") {
    return true;
  }
  return !DISABLE_VALUES.has(value.toLowerCase());
}

export function initTelemetry(env: EnvLike = process.env): void {
  if (!telemetryEnabled(env)) {
    return;
  }
  const require = createRequire(import.meta.url);
  const { version } = require("../package.json") as { version: string };
  Sentry.init({
    dsn: DSN,
    release: `picklab@${version}`,
    tracesSampleRate: 0,
    beforeBreadcrumb: () => null,
    beforeSend: (event) => {
      delete event.server_name;
      delete event.modules;
      if (typeof event.message === "string") {
        event.message = redactSecrets(event.message);
      }
      for (const exception of event.exception?.values ?? []) {
        if (exception.value !== undefined) {
          exception.value = redactSecrets(exception.value);
        }
      }
      return event;
    },
  });
}

export async function captureFatal(err: unknown): Promise<void> {
  Sentry.captureException(err);
  await Sentry.flush(2000);
}
