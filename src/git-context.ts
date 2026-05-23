// Git context gatherer — auto-detects repo info for Jules sessions
import { spawn } from "child_process"
import { resolve } from "path"

export interface GitContext {
  owner: string
  repo: string
  branch: string
  isDirty: boolean
  diff: string
}

/**
 * Run a git command and return stdout, or "" on failure.
 */
async function git(args: string[], cwd?: string): Promise<string> {
  return new Promise(resolve => {
    const proc = spawn("git", args, { cwd, shell: true, timeout: 5000 })
    let out = ""
    proc.stdout.on("data", (d: Buffer) => (out += d.toString()))
    proc.on("close", (code) => resolve(code === 0 ? out.trim() : ""))
    proc.on("error", () => resolve(""))
  })
}

/**
 * Parse `git@github.com:owner/repo.git` or `https://github.com/owner/repo.git`
 */
function parseRemote(url: string): { owner: string; repo: string } | null {
  const m = url.match(/(?:git@|https:\/\/)(?:[\w.@]+)[/:]([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?$/)
  return m ? { owner: m[1], repo: m[2] } : null
}

/**
 * Gather git context from the current working directory.
 * Returns undefined if not in a git repo.
 */
export async function gatherGitContext(workdir?: string): Promise<GitContext | undefined> {
  const cwd = workdir ?? process.cwd()

  const remoteUrl = await git(["config", "--get", "remote.origin.url"], cwd)
  if (!remoteUrl) return undefined

  const parsed = parseRemote(remoteUrl)
  if (!parsed) return undefined

  const [branch, status, diff] = await Promise.all([
    git(["rev-parse", "--abbrev-ref", "HEAD"], cwd),
    git(["status", "--porcelain"], cwd),
    git(["diff", "HEAD", "--stat"], cwd),  // stat only — full diff can be huge
  ])

  return {
    owner: parsed.owner,
    repo: parsed.repo,
    branch: branch || "main",
    isDirty: status.length > 0,
    diff: diff.slice(0, 2000), // cap at 2k chars
  }
}

/**
 * Build a source ID from git context.
 * Matches Jules convention: sources/github/{owner}/{repo}
 */
export function sourceIdFromGit(ctx: GitContext): string {
  return `sources/github/${ctx.owner}/${ctx.repo}`
}
