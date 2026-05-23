// CLI detection and execution for Jules
import { spawn } from "child_process"
import { Logger } from "./logger"

let _cliAvailable: boolean | null = null

/**
 * Check if jules CLI is installed and working.
 * Caches result after first check.
 */
export async function detectCLI(log?: Logger): Promise<boolean> {
  if (_cliAvailable !== null) return _cliAvailable

  try {
    const result = await execJules(["remote", "list", "--session"], { timeout: 15000 })
    _cliAvailable = result.exitCode === 0 && result.stdout.length > 0
  } catch {
    _cliAvailable = false
  }

  log?.info(`CLI detection: ${_cliAvailable ? "available" : "not found"}`)
  return _cliAvailable
}

export interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number
}

/**
 * Execute a jules CLI command. Returns stdout/stderr/exitCode.
 */
export async function execJules(
  args: string[],
  opts?: { timeout?: number; cwd?: string },
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn("jules", args, {
      cwd: opts?.cwd ?? process.cwd(),
      shell: true,
      // NOTE: spawn() ignores `timeout` — enforce manually below
    })

    let stdout = ""
    let stderr = ""
    let killed = false

    // Enforce timeout manually (spawn doesn't support the timeout option)
    const timeoutMs = opts?.timeout ?? 30_000
    const timer = setTimeout(() => {
      killed = true
      try { proc.kill("SIGTERM") } catch {}
      setTimeout(() => { try { proc.kill("SIGKILL") } catch {} }, 2000)
    }, timeoutMs)

    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()))
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()))

    proc.on("close", (code) => {
      clearTimeout(timer)
      const exitCode = killed ? 1 : (code ?? (stdout.length > 0 ? 0 : 1))
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode })
    })

    proc.on("error", (err) => {
      clearTimeout(timer)
      reject(new Error(`jules CLI error: ${err.message}`))
    })
  })
}
