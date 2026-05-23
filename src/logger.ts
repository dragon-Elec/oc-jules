// Logger — writes through OpenCode's client.app.log() and to OS temp dir
import { appendFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

type Level = "debug" | "info" | "warn" | "error"

const RANK: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 }

export class Logger {
  private client: any
  private threshold: number
  private logFile: string

  constructor(client: any, level: Level = "info") {
    this.client = client
    this.threshold = RANK[level] ?? RANK.info
    this.logFile = join(tmpdir(), "opencode-jules.log")
  }

  private emit(level: Level, message: string, extra?: any) {
    if (RANK[level] < this.threshold) return
    
    const extraStr = extra !== undefined ? JSON.stringify(extra) : undefined
    
    // 1. Write to OpenCode client
    this.client?.app?.log?.({
      body: {
        service: "jules",
        level,
        message,
        extra: extraStr,
      },
    }).catch?.(() => {})

    // 2. Write to OS temp dir
    try {
      const timestamp = new Date().toISOString()
      const logLine = `[${timestamp}] [${level.toUpperCase()}] ${message}${extraStr ? ` ${extraStr}` : ""}\n`
      appendFileSync(this.logFile, logLine, "utf-8")
    } catch {
      // ignore file write errors
    }
  }

  debug(msg: string, data?: any) { this.emit("debug", msg, data) }
  info(msg: string, data?: any) { this.emit("info", msg, data) }
  warn(msg: string, data?: any) { this.emit("warn", msg, data) }
  error(msg: string, data?: any) { this.emit("error", msg, data) }
}
