// Jules REST API client — with retry, timeout, error handling
import { Logger } from "./logger"
import type {
  Session,
  ListSessionsResponse,
  Activity,
  ListActivitiesResponse,
  Source,
  ListSourcesResponse,
  CreateSessionRequest,
  AutomationMode,
} from "./types"

// ─── error classes ───────────────────────────────────────────────

export class JulesApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public rawError?: string,
  ) {
    super(message)
    this.name = "JulesApiError"
  }
}

// ─── error message map ──────────────────────────────────────────

const ERROR_MAP: Record<number, string> = {
  400: "Invalid request. Check session ID or parameters.",
  401: "Authentication failed. Verify your API key in jules.jsonc.",
  403: "Access denied. Check Jules permissions for this repo.",
  404: "Resource not found. For repos, install the Jules GitHub App at jules.google.com/settings/repositories",
  408: "Request timed out. Jules API may be slow.",
  429: "Rate limit exceeded. Backing off and retrying.",
  500: "Jules internal server error.",
  503: "Jules service temporarily unavailable.",
}

function sanitizeError(status: number, raw: string): string {
  if (status === 404 && raw.includes("Requested entity was not found")) {
    return "Repository not found in Jules. Install the GitHub App at jules.google.com/settings/repositories"
  }
  return ERROR_MAP[status] ?? `Jules API error (${status})`
}

// ─── client ──────────────────────────────────────────────────────

export class JulesClient {
  private apiKey: string
  private baseUrl: string
  private log: Logger
  private timeoutMs: number
  private maxRetries: number

  constructor(
    apiKey: string,
    baseUrl: string,
    logger: Logger,
    opts?: { timeoutMs?: number; maxRetries?: number },
  ) {
    this.apiKey = apiKey
    this.baseUrl = baseUrl
    this.log = logger
    this.timeoutMs = opts?.timeoutMs ?? 30_000
    this.maxRetries = opts?.maxRetries ?? 3
  }

  // ─── low-level fetch with retry + timeout ──────────────────────

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    return this.withRetry(async () => {
      const url = `${this.baseUrl}${path}`
      this.log.debug(`→ ${method} ${url}`, body)

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.timeoutMs)

      try {
        const res = await fetch(url, {
          method,
          headers: {
            "x-goog-api-key": this.apiKey,
            "Content-Type": "application/json",
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        })

        clearTimeout(timer)
        const text = await res.text()
        this.log.debug(`← ${res.status}`, text)

        if (!res.ok) {
          const msg = sanitizeError(res.status, text)
          throw new JulesApiError(msg, res.status, text)
        }

        try { return JSON.parse(text) as T } catch { return text as T }
      } catch (err: any) {
        clearTimeout(timer)
        if (err.name === "AbortError") {
          throw new JulesApiError("Request timed out", 408)
        }
        if (err instanceof JulesApiError) throw err
        throw new JulesApiError(`Network error: ${err.message}`)
      }
    })
  }

  /**
   * Retry with exponential backoff + jitter on 429/503/timeout.
   */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastErr: unknown
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn()
      } catch (err: any) {
        lastErr = err
        const retryable =
          err instanceof JulesApiError &&
          (err.statusCode === 429 || err.statusCode === 503 || err.statusCode === 408)

        if (!retryable || attempt === this.maxRetries) throw err

        const delay = 1000 * Math.pow(2, attempt) + Math.random() * 1000
        this.log.warn(`Retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${this.maxRetries})`, {
          status: err.statusCode,
        })
        await new Promise(r => setTimeout(r, delay))
      }
    }
    throw lastErr
  }

  // ─── sessions ──────────────────────────────────────────────────

  async createSession(params: {
    prompt: string
    title?: string
    source?: string
    startingBranch?: string
    requirePlanApproval?: boolean
    automationMode?: AutomationMode
  }): Promise<Session> {
    this.log.info("createSession", { prompt: params.prompt.slice(0, 80) })

    const body: CreateSessionRequest = {
      prompt: params.prompt,
      title: params.title ?? params.prompt.slice(0, 50),
    }

    if (params.source) {
      body.sourceContext = {
        source: params.source,
        githubRepoContext: { startingBranch: params.startingBranch ?? "main" },
      }
    }

    if (params.requirePlanApproval !== undefined) {
      body.requirePlanApproval = params.requirePlanApproval
    }

    if (params.automationMode) {
      body.automationMode = params.automationMode
    }

    return this.req<Session>("POST", "/sessions", body)
  }

  async listSessions(pageSize = 10, pageToken?: string): Promise<ListSessionsResponse> {
    const qs = new URLSearchParams({ pageSize: String(pageSize) })
    if (pageToken) qs.set("pageToken", pageToken)
    return this.req<ListSessionsResponse>("GET", `/sessions?${qs}`)
  }

  async getSession(id: string): Promise<Session> {
    return this.req<Session>("GET", `/sessions/${id}`)
  }

  async deleteSession(id: string): Promise<void> {
    await this.req<any>("DELETE", `/sessions/${id}`)
  }

  async sendMessage(id: string, prompt: string): Promise<void> {
    this.log.info("sendMessage", { id, len: prompt.length })
    await this.req<any>("POST", `/sessions/${id}:sendMessage`, { prompt })
  }

  async approvePlan(id: string): Promise<void> {
    this.log.info("approvePlan", { id })
    await this.req<any>("POST", `/sessions/${id}:approvePlan`, {})
  }

  // ─── activities ────────────────────────────────────────────────

  async listActivities(
    sessionId: string,
    pageSize = 20,
    opts?: { pageToken?: string; createTime?: string },
  ): Promise<ListActivitiesResponse> {
    const qs = new URLSearchParams({ pageSize: String(pageSize) })
    if (opts?.pageToken) qs.set("pageToken", opts.pageToken)
    if (opts?.createTime) qs.set("createTime", opts.createTime)
    return this.req<ListActivitiesResponse>("GET", `/sessions/${sessionId}/activities?${qs}`)
  }

  async getActivity(sessionId: string, activityId: string): Promise<Activity> {
    return this.req<Activity>("GET", `/sessions/${sessionId}/activities/${activityId}`)
  }

  // ─── sources ───────────────────────────────────────────────────

  async listSources(pageSize = 10, opts?: { pageToken?: string; filter?: string }): Promise<ListSourcesResponse> {
    const qs = new URLSearchParams({ pageSize: String(pageSize) })
    if (opts?.pageToken) qs.set("pageToken", opts.pageToken)
    if (opts?.filter) qs.set("filter", opts.filter)
    return this.req<ListSourcesResponse>("GET", `/sources?${qs}`)
  }

  async getSource(sourceId: string): Promise<Source> {
    return this.req<Source>("GET", `/sources/${sourceId}`)
  }
}
