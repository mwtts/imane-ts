export type LogLevel = "debug" | "info" | "warn" | "error";

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const env = (process.env.LOG_LEVEL ?? "info").toLowerCase() as LogLevel;
  return ORDER[env] ?? ORDER.info;
}

export interface Logger {
  debug(message: string, detail?: unknown): void;
  info(message: string, detail?: unknown): void;
  warn(message: string, detail?: unknown): void;
  error(message: string, detail?: unknown): void;
}

export function createLogger(category: string): Logger {
  const write = (level: LogLevel, message: string, detail?: unknown) => {
    if (ORDER[level] < threshold()) return;
    const line = `${new Date().toISOString()} ${level.toUpperCase()} [${category}] ${message}`;
    if (detail === undefined) console.error(line);
    else console.error(line, detail);
  };
  return {
    debug: (m, d) => write("debug", m, d),
    info: (m, d) => write("info", m, d),
    warn: (m, d) => write("warn", m, d),
    error: (m, d) => write("error", m, d),
  };
}
