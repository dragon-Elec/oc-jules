// Tool definitions for the Jules OpenCode plugin
import { tool } from "@opencode-ai/plugin"
import type { JulesClient } from "./client"
import type { JulesConfig, Activity, Source, Session } from "./types"
import { gatherGitContext, sourceIdFromGit } from "./git-context"
import { detectCLI, execJules } from "./cli"
import { readFileSync, existsSync } from "fs"
import { join, dirname } from "path"
import { homedir } from "os"
import { fileURLToPath } from "url"

// ─── formatters ──────────────────────────────────────────────────

function fmtSession(s: Session): string {
  const lines = [
    `• ${s.title ?? s.id}`,
    `  ID: ${s.id}`,
    `  State: ${s.state}`,
    `  Created: ${s.createTime ?? "—"}`,
    `  URL: ${s.url ?? "—"}`,
  ]
  if (s.outputs?.length) {
    for (const o of s.outputs) {
      if (o.pullRequest) lines.push(`  PR: ${o.pullRequest.url}`)
    }
  }
  return lines.join("\n")
}

function fmtSource(s: Source): string {
  const r = s.githubRepo
  if (!r) return `• ${s.id}`
  const branches = r.branches?.map(b => b.displayName).join(", ") ?? "—"
  return [
    `• ${r.owner}/${r.repo}`,
    `  ID: ${s.name}`,
    `  Private: ${r.isPrivate ?? "—"}`,
    `  Default: ${r.defaultBranch?.displayName ?? "main"}`,
    `  Branches: ${branches}`,
  ].join("\n")
}

function fmtActivity(a: Activity): string {
  const parts = [`• [${a.originator ?? "?"}] ${a.description ?? a.id}`, `  ${a.createTime ?? ""}`]

  if (a.planGenerated?.plan?.steps) {
    const steps = a.planGenerated.plan.steps
    parts.push(`  Plan: ${steps.length} steps`)
    for (const s of steps) parts.push(`    ${s.index ?? ""}. ${s.title}`)
  }
  if (a.planApproved) parts.push(`  Plan approved: ${a.planApproved.planId}`)
  if (a.userMessaged) parts.push(`  User: ${a.userMessaged.userMessage.slice(0, 120)}`)
  if (a.agentMessaged) parts.push(`  Agent: ${a.agentMessaged.agentMessage.slice(0, 120)}`)
  if (a.progressUpdated) parts.push(`  Progress: ${a.progressUpdated.title ?? ""} ${a.progressUpdated.description ?? ""}`)
  if (a.sessionCompleted) parts.push("  ✓ Completed")
  if (a.sessionFailed) parts.push(`  ✗ Failed: ${a.sessionFailed.reason ?? "unknown"}`)

  if (a.artifacts?.length) {
    for (const art of a.artifacts) {
      if (art.changeSet?.gitPatch) parts.push(`  Patch: ${art.changeSet.gitPatch.suggestedCommitMessage ?? "diff"}`)
      if (art.bashOutput) parts.push(`  Bash: ${art.bashOutput.command} (exit ${art.bashOutput.exitCode})`)
      if (art.media) parts.push(`  Media: ${art.media.mimeType}`)
    }
  }

  return parts.join("\n")
}

// ─── resolve source/branch from git when not provided ───────────

async function resolveSource(
  explicit: string | undefined,
  config: JulesConfig,
): Promise<{ source?: string; branch?: string }> {
  if (explicit) return { source: explicit }

  // 1. config default
  if (config.defaultSource) return { source: config.defaultSource, branch: config.defaultBranch }

  // 2. auto-detect from git
  const ctx = await gatherGitContext()
  if (ctx) return { source: sourceIdFromGit(ctx), branch: ctx.branch }

  return {}
}

// ─── tool registry ───────────────────────────────────────────────

export async function buildTools(jules: JulesClient | null, config: JulesConfig) {
  const cliAvailable = await detectCLI()

  // Only register API tools if client is available
  const apiTools = jules ? {
    jules_create_session: tool({
      description:
        "Create async coding session with Jules — Google's autonomous AI coding agent that works in cloud on your GitHub repo. Runs offscreen, pushes results to branches. Best for: multi-file refactors, test generation, dependency updates, boilerplate. NOT for: quick single-line fixes, questions, things needing real-time back-and-forth. Session goes through states: QUEUED → PLANNING → (optional plan approval) → IN_PROGRESS → COMPLETED/FAILED. Check status with jules_session_status, monitor with jules_list_activities.",
      args: {
        prompt: tool.schema.string().describe("Task description — be specific. Include file paths, expected behavior, constraints. Jules plans from this."),
        title: tool.schema.string().optional().describe("Human-readable title. Auto-generated from prompt if omitted."),
        source: tool.schema.string().optional().describe("Connected repo resource name, e.g. 'sources/github/myorg/myrepo'. Use jules_list_sources to find. If omitted, auto-detected from git remote in current directory."),
        startingBranch: tool.schema.string().optional().describe("Git branch to base work on. Default: auto-detected from current git branch, or 'main'."),
        requirePlanApproval: tool.schema.boolean().optional().describe("If true, session pauses at AWAITING_PLAN_APPROVAL. Use jules_approve_plan to continue. Default: config requirePlanApproval or false."),
        automationMode: tool.schema.enum(["AUTO_CREATE_PR"]).optional().describe("Set to 'AUTO_CREATE_PR' to automatically create a GitHub PR when code changes are ready. Omit for no auto-PR."),
      },
      async execute(args) {
        const resolved = await resolveSource(args.source, config)

        const session = await jules!.createSession({
          prompt: args.prompt,
          title: args.title,
          source: resolved.source,
          startingBranch: args.startingBranch ?? resolved.branch ?? config.defaultBranch,
          requirePlanApproval: args.requirePlanApproval ?? config.requirePlanApproval,
          automationMode: args.automationMode as any,
        })
        return [
          `Session created!`,
          `ID: ${session.id}`,
          `Title: ${session.title ?? "—"}`,
          `State: ${session.state}`,
          `URL: ${session.url ?? "—"}`,
          "",
          "Use jules_session_status to check progress.",
        ].join("\n")
      },
    }),

    jules_list_sessions: tool({
      description:
        "List all Jules sessions (active, completed, failed). Returns session IDs needed by other jules_* tools. Sessions are cloud-based async tasks running on your GitHub repos.",
      args: {
        pageSize: tool.schema.number().optional().describe("Max sessions to return. Default: 10."),
      },
      async execute(args) {
        const res = await jules!.listSessions(args.pageSize ?? 10)
        if (!res.sessions?.length) return "No sessions found."
        return `Found ${res.sessions.length} session(s):\n\n${res.sessions.map(fmtSession).join("\n\n")}`
      },
    }),

    jules_session_status: tool({
      description:
        "Get session state, timestamps, outputs. States: QUEUED (waiting), PLANNING (analyzing), AWAITING_PLAN_APPROVAL (needs approval), AWAITING_USER_FEEDBACK (needs your input), IN_PROGRESS (working), COMPLETED (done, check outputs for PR link), FAILED (error).",
      args: {
        sessionId: tool.schema.string().describe("Session ID from jules_create_session or jules_list_sessions"),
      },
      async execute(args) {
        const s = await jules!.getSession(args.sessionId)
        const parts = [
          `Session: ${s.title ?? s.id}`,
          `ID: ${s.id}`,
          `State: ${s.state}`,
          `Created: ${s.createTime ?? "—"}`,
          `Updated: ${s.updateTime ?? "—"}`,
          `URL: ${s.url ?? "—"}`,
        ]
        if (s.outputs?.length) {
          parts.push("", "Outputs:")
          for (const o of s.outputs) {
            if (o.pullRequest) parts.push(`  PR: ${o.pullRequest.url} — ${o.pullRequest.title ?? ""}`)
            if (o.changeSet) parts.push(`  ChangeSet: ${o.changeSet.source ?? ""}`)
          }
        }
        return parts.join("\n")
      },
    }),

    jules_send_message: tool({
      description:
        "Send message to active session. Use when session is AWAITING_USER_FEEDBACK or to add instructions mid-execution. Jules will incorporate your message into its workflow.",
      args: {
        sessionId: tool.schema.string().describe("Session ID"),
        prompt: tool.schema.string().describe("Message — feedback, clarification, or additional instructions"),
      },
      async execute(args) {
        await jules!.sendMessage(args.sessionId, args.prompt)
        return `Message sent to session ${args.sessionId}.`
      },
    }),

    jules_approve_plan: tool({
      description:
        "Approve execution plan. Only works when session state is AWAITING_PLAN_APPROVAL (created with requirePlanApproval=true). After approval, Jules begins coding.",
      args: {
        sessionId: tool.schema.string().describe("Session ID in AWAITING_PLAN_APPROVAL state"),
      },
      async execute(args) {
        await jules!.approvePlan(args.sessionId)
        return `Plan approved for session ${args.sessionId}. Jules will continue working.`
      },
    }),

    jules_delete_session: tool({
      description: "Delete session permanently. Cleans up completed/failed sessions. Does NOT stop running sessions.",
      args: {
        sessionId: tool.schema.string().describe("Session ID to delete"),
      },
      async execute(args) {
        await jules!.deleteSession(args.sessionId)
        return `Session ${args.sessionId} deleted.`
      },
    }),

    jules_list_activities: tool({
      description:
        "Timeline of session events. Shows: planGenerated (plan steps), planApproved, userMessaged, agentMessaged, progressUpdated, sessionCompleted, sessionFailed. Artifacts may include changeSet (git patch), bashOutput, or media. Use createTime to filter events after a timestamp.",
      args: {
        sessionId: tool.schema.string().describe("Session ID"),
        pageSize: tool.schema.number().optional().describe("Max activities. Default: 20."),
        createTime: tool.schema.string().optional().describe("ISO timestamp — only return activities created after this time. Useful for polling new events."),
      },
      async execute(args) {
        const res = await jules!.listActivities(args.sessionId, args.pageSize ?? 20, {
          createTime: args.createTime,
        })
        if (!res.activities?.length) return `No activities for session ${args.sessionId}.`
        return `Activities for ${args.sessionId}:\n\n${res.activities.map(fmtActivity).join("\n\n")}`
      },
    }),

    jules_get_activity: tool({
      description:
        "Get single activity by ID. Use when you need full details of a specific event (e.g., full diff patch, complete agent message, bash output).",
      args: {
        sessionId: tool.schema.string().describe("Session ID"),
        activityId: tool.schema.string().describe("Activity ID from jules_list_activities"),
      },
      async execute(args) {
        const a = await jules!.getActivity(args.sessionId, args.activityId)
        return fmtActivity(a)
      },
    }),

    jules_list_sources: tool({
      description:
        "List GitHub repos connected to Jules. Returns source IDs (e.g. 'sources/github/myorg/myrepo') needed for jules_create_session's source param. Shows branches, visibility. Sources are configured at jules.google.com, not via API.",
      args: {
        pageSize: tool.schema.number().optional().describe("Max sources. Default: 10."),
        filter: tool.schema.string().optional().describe("Filter expression, e.g. 'name=sources/github/owner/repo'. Supports OR: 'name=sources/a OR name=sources/b'."),
      },
      async execute(args) {
        const res = await jules!.listSources(args.pageSize ?? 10, { filter: args.filter })
        if (!res.sources?.length) return "No sources found. Connect a GitHub repo at jules.google.com first."
        return `Found ${res.sources.length} source(s):\n\n${res.sources.map(fmtSource).join("\n\n")}`
      },
    }),

    jules_get_source: tool({
      description:
        "Get single source (repo) by ID. Shows full branch list and visibility. Use to inspect available branches before creating a session.",
      args: {
        sourceId: tool.schema.string().describe("Source ID, e.g. 'github/myorg/myrepo' — from jules_list_sources"),
      },
      async execute(args) {
        const s = await jules!.getSource(args.sourceId)
        return fmtSource(s)
      },
    }),
  } : {}

  // ── Suggestions playbook tool ──────────────────────────────────

  const __filename = fileURLToPath(import.meta.url)
  const __dirname = dirname(__filename)
  const defaultPlaybook = join(__dirname, "..", "playbooks", "web-ui.md")

  const suggestionsTool = {

    jules_web_ui_playbook: tool({
      description:
        "Get the playbook for interacting with the Jules Web UI (fetch suggestions, list recent/archived sessions, archive sessions). Use this tool to get instructions on how to use agent-browser to extract data or perform actions not available in the REST API.",
      args: {
        source: tool.schema.string().optional().describe("Source repo in 'owner/repo' format (e.g. 'dragon-Elec/Imbric'). Required for fetching suggestions."),
        playbookPath: tool.schema.string().optional().describe("Path to web UI playbook MD file. Default: ~/.config/opencode/plugins/jules/playbooks/web-ui.md"),
      },
      async execute(args) {
        // Resolve source
        const resolved = await resolveSource(args.source, config)
        if (!resolved.source) {
          return "Could not determine source repo. Provide source arg, set defaultSource in config, or run from a git directory."
        }

        // Load playbook
        const pbPath = args.playbookPath ?? config.suggestions?.playbookPath ?? defaultPlaybook
        if (!existsSync(pbPath)) {
          return `Playbook not found at ${pbPath}. Create it or provide playbookPath arg.`
        }

        const playbook = readFileSync(pbPath, "utf-8")

        // Build the agent instruction
        const browser = config.suggestions?.browser ?? "brave"
        const port = config.suggestions?.port ?? 9222
        const profile = config.suggestions?.useExistingProfile !== false ? "default" : "temp"

        const instruction = [
          `# Jules Suggestions Fetch Task`,
          ``,
          `## Config`,
          `- Source: ${resolved.source}`,
          `- Browser: ${browser}`,
          `- Port: ${port}`,
          `- Profile: ${profile}`,
          `- Playbook: ${pbPath}`,
          ``,
          `## Instructions`,
          `1. Ensure browser is running: launch ${browser} with --remote-debugging-port=${port}`,
          `2. Connect agent-browser to port ${port}`,
          `3. Read and follow the playbook at ${pbPath}`,
          `4. Replace {source} with ${resolved.source} in the playbook's API call`,
          `5. Execute the API extraction (primary) or DOM extraction (fallback)`,
          `6. Return the structured JSON array of suggestions`,
          ``,
          `## If extraction fails`,
          `- Inspect the page with agent-browser snapshot`,
          `- Identify what changed (selectors, API, page structure)`,
          `- Update the playbook at ${pbPath}`,
          `- Retry the extraction`,
          ``,
          `## Playbook Content`,
          ``,
          playbook,
        ].join("\n")

        return instruction
      },
    }),

  }

  // ── CLI-powered tools (only available if `jules` binary is installed) ──

  const cliTools = cliAvailable ? {

      jules_pull_diff: tool({
        description:
          "Pull git diff/patch from a completed Jules session. Outputs a unified diff that can be applied with git apply. Requires Jules CLI (`npm i -g @google/jules`). Use when you want to inspect or manually apply code changes locally.",
        args: {
          sessionId: tool.schema.string().describe("Completed session ID"),
        },
        async execute(args) {
          const res = await execJules(["remote", "pull", "--session", args.sessionId], { timeout: 30_000 })
          if (res.exitCode !== 0) {
            return `Failed to pull diff: ${res.stderr || res.stdout}`
          }
          if (!res.stdout) return "No diff returned — session may not have code changes."
          return `Git diff for session ${args.sessionId}:\n\n${res.stdout}`
        },
      }),

      jules_apply_changes: tool({
        description:
          "Pull and apply code changes from a completed Jules session directly to local working tree. Equivalent to `jules remote pull --session ID --apply`. Requires Jules CLI. Modifies local files — use when ready to integrate changes.",
        args: {
          sessionId: tool.schema.string().describe("Completed session ID"),
        },
        async execute(args) {
          const res = await execJules(["remote", "pull", "--session", args.sessionId, "--apply"], { timeout: 30_000 })
          if (res.exitCode !== 0) {
            return `Failed to apply changes: ${res.stderr || res.stdout}`
          }
          return `Changes from session ${args.sessionId} applied to working tree.\n${res.stdout || "Done."}`
        },
      }),

      jules_create_parallel: tool({
        description:
          "Create N parallel sessions for the same task. Jules runs the same prompt on separate VMs simultaneously. Compare results and pick the best. Requires Jules CLI. Max 5 parallel sessions.",
        args: {
          prompt: tool.schema.string().describe("Task description for all parallel sessions"),
          count: tool.schema.number().describe("Number of parallel sessions (1-5)"),
          repo: tool.schema.string().optional().describe("Repo in 'owner/repo' format. Auto-detected from git remote if omitted."),
        },
        async execute(args) {
          const count = Math.min(Math.max(args.count, 1), 5)
          const repo = args.repo ?? (await gatherGitContext())?.owner + "/" + (await gatherGitContext())?.repo
          if (!repo || repo.includes("undefined")) {
            return "Could not detect repo. Provide --repo or run from a git directory."
          }
          const res = await execJules([
            "remote", "new",
            "--repo", repo,
            "--session", args.prompt,
            "--parallel", String(count),
          ], { timeout: 15_000 })
          if (res.exitCode !== 0) {
            return `Failed to create parallel sessions: ${res.stderr || res.stdout}`
          }
          return `Created ${count} parallel sessions for: "${args.prompt.slice(0, 60)}..."\n${res.stdout}`
        },
      }),

      jules_cli_status: tool({
        description:
          "List all sessions via CLI (alternative to API). Shows table with ID, description, repo, last active, status. Requires Jules CLI. Useful as fallback if API key is not configured.",
        args: {},
        async execute() {
          const res = await execJules(["remote", "list", "--session"], { timeout: 10_000 })
          if (res.exitCode !== 0) {
            return `CLI error: ${res.stderr || res.stdout}`
          }
          return `Jules sessions (via CLI):\n\n${res.stdout}`
        },
      }),

    } : {}

  return { ...apiTools, ...suggestionsTool, ...cliTools }
}
