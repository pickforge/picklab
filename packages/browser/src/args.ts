const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "localhost"]);

export interface BuildChromeArgsOptions {
  /** Chrome `--user-data-dir`; the ephemeral profile. */
  profileDir: string;
  /** CDP bind address; must be loopback. Defaults to `127.0.0.1`. */
  cdpAddress?: string;
  width?: number;
  height?: number;
  /** Disable Chrome's own sandbox. Off by default; only for constrained hosts. */
  noSandbox?: boolean;
  startUrl?: string;
  extraArgs?: string[];
}

/**
 * Build the argv array for a headed Chrome launched inside a private Xvfb.
 *
 * The DevTools endpoint uses an OS-assigned port (`--remote-debugging-port=0`)
 * bound explicitly to loopback, so two concurrent sessions never collide and
 * the endpoint is never reachable off-host. The port is discovered afterwards
 * by reading `<profile>/DevToolsActivePort`.
 */
export function buildChromeArgs(opts: BuildChromeArgsOptions): string[] {
  if (opts.profileDir === "") {
    throw new Error("buildChromeArgs requires a non-empty profileDir");
  }
  const address = opts.cdpAddress ?? "127.0.0.1";
  if (!LOOPBACK_ADDRESSES.has(address)) {
    throw new Error(
      `Refusing to bind the DevTools endpoint to non-loopback address "${address}"`,
    );
  }
  const args = [
    `--user-data-dir=${opts.profileDir}`,
    "--remote-debugging-port=0",
    `--remote-debugging-address=${address}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-sync",
    "--disable-features=Translate,MediaRouter",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--password-store=basic",
    "--use-mock-keychain",
  ];
  if (opts.width !== undefined && opts.height !== undefined) {
    args.push(`--window-size=${opts.width},${opts.height}`);
  }
  if (opts.noSandbox === true) {
    args.push("--no-sandbox");
  }
  if (opts.extraArgs !== undefined) {
    args.push(...opts.extraArgs);
  }
  args.push(opts.startUrl ?? "about:blank");
  return args;
}
