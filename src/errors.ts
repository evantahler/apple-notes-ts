export class MacOSError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MacOSError";
  }
}

export class DatabaseNotFoundError extends MacOSError {
  constructor(path: string) {
    super(`Database not found or inaccessible: ${path}`);
    this.name = "DatabaseNotFoundError";
  }
}

export class DatabaseAccessDeniedError extends MacOSError {
  constructor(path: string) {
    const app = detectTerminalApp();
    const appHint = app ? ` to "${app}"` : " to your terminal app";
    super(
      `Access denied to database: ${path}\n` +
        `Grant Full Disk Access${appHint} in System Settings → Privacy & Security → Full Disk Access.`,
    );
    this.name = "DatabaseAccessDeniedError";
  }

  openSettings(): void {
    Bun.spawn([
      "open",
      "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
    ]);
  }
}

function detectTerminalApp(): string | null {
  const bundleId = process.env.__CFBundleIdentifier;
  if (bundleId) {
    const known: Record<string, string> = {
      "com.apple.Terminal": "Terminal",
      "com.googlecode.iterm2": "iTerm2",
      "dev.warp.Warp-Stable": "Warp",
      "com.microsoft.VSCode": "Visual Studio Code",
      "com.todesktop.230313mzl4w4u92": "Cursor",
      "dev.zed.Zed": "Zed",
      "com.conductor.app": "Conductor",
    };
    if (known[bundleId]) return known[bundleId];
  }

  const termProgram = process.env.TERM_PROGRAM;
  if (termProgram) return termProgram;

  return null;
}
