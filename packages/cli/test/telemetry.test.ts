import { describe, expect, it } from "vitest";
import * as Sentry from "@sentry/node";
import { initTelemetry, telemetryEnabled } from "../src/telemetry.js";

describe("telemetryEnabled", () => {
  it("defaults to on when unset", () => {
    expect(telemetryEnabled({})).toBe(true);
  });

  it("defaults to on when trimmed-empty", () => {
    expect(telemetryEnabled({ PICKLAB_TELEMETRY: "  " })).toBe(true);
  });

  it("defaults to on for unrelated values", () => {
    expect(telemetryEnabled({ PICKLAB_TELEMETRY: "yes" })).toBe(true);
  });

  it("is off for '0'", () => {
    expect(telemetryEnabled({ PICKLAB_TELEMETRY: "0" })).toBe(false);
  });

  it("is off for 'false'", () => {
    expect(telemetryEnabled({ PICKLAB_TELEMETRY: "false" })).toBe(false);
  });

  it("is off for 'OFF' case-insensitively", () => {
    expect(telemetryEnabled({ PICKLAB_TELEMETRY: "OFF" })).toBe(false);
  });

  it("is off for ' off ' with surrounding whitespace", () => {
    expect(telemetryEnabled({ PICKLAB_TELEMETRY: " off " })).toBe(false);
  });
});

describe("initTelemetry", () => {
  it("does not initialize Sentry when opted out", () => {
    initTelemetry({ PICKLAB_TELEMETRY: "0" });
    expect(Sentry.isInitialized()).toBe(false);
  });
});
