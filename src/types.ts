// Jules REST API Types

export interface JulesConfig {
  apiKey?: string
  baseUrl?: string
  logLevel?: "debug" | "info" | "warn" | "error"
  defaultSource?: string
  defaultBranch?: string
  requirePlanApproval?: boolean
  automationMode?: AutomationMode
  cliEnabled?: boolean
  suggestions?: SuggestionsConfig
}

export interface SuggestionsConfig {
  browser?: "brave" | "chrome" | "floorp"
  browserPath?: string
  port?: number
  useExistingProfile?: boolean
  playbookPath?: string
}

export type SessionState =
  | "STATE_UNSPECIFIED"
  | "QUEUED"
  | "PLANNING"
  | "AWAITING_PLAN_APPROVAL"
  | "AWAITING_USER_FEEDBACK"
  | "IN_PROGRESS"
  | "PAUSED"
  | "FAILED"
  | "COMPLETED"

export type AutomationMode =
  | "AUTOMATION_MODE_UNSPECIFIED"
  | "AUTO_CREATE_PR"

export type Originator = "system" | "user" | "agent"

export interface GitHubBranch {
  displayName: string
}

export interface GitHubRepo {
  owner: string
  repo: string
  isPrivate?: boolean
  defaultBranch?: GitHubBranch
  branches?: GitHubBranch[]
}

export interface Source {
  name: string
  id: string
  githubRepo?: GitHubRepo
}

export interface GitHubRepoContext {
  startingBranch?: string
}

export interface SourceContext {
  source: string
  githubRepoContext?: GitHubRepoContext
  environmentVariablesEnabled?: boolean
}

export interface PullRequest {
  url: string
  title?: string
  description?: string
  baseRef?: string
  headRef?: string
}

export interface SessionOutput {
  pullRequest?: PullRequest
  changeSet?: ChangeSet
}

export interface Session {
  name: string
  id: string
  title?: string
  prompt?: string
  state: SessionState
  url?: string
  createTime?: string
  updateTime?: string
  sourceContext?: SourceContext
  outputs?: SessionOutput[]
  automationMode?: AutomationMode
}

export interface PlanStep {
  id: string
  index?: number
  title: string
  description?: string
}

export interface Plan {
  id: string
  steps?: PlanStep[]
  createTime?: string
}

export interface PlanGenerated {
  plan: Plan
}

export interface PlanApproved {
  planId: string
}

export interface UserMessaged {
  userMessage: string
}

export interface AgentMessaged {
  agentMessage: string
}

export interface ProgressUpdated {
  title?: string
  description?: string
}

export interface SessionCompleted {}

export interface SessionFailed {
  reason?: string
}

export interface GitPatch {
  baseCommitId?: string
  unidiffPatch?: string
  suggestedCommitMessage?: string
}

export interface ChangeSet {
  source?: string
  gitPatch?: GitPatch
}

export interface BashOutput {
  command?: string
  output?: string
  exitCode?: number
}

export interface Media {
  mimeType?: string
  data?: string
}

export interface Artifact {
  changeSet?: ChangeSet
  bashOutput?: BashOutput
  media?: Media
}

export interface Activity {
  name: string
  id: string
  originator?: Originator
  description?: string
  createTime?: string
  planGenerated?: PlanGenerated
  planApproved?: PlanApproved
  userMessaged?: UserMessaged
  agentMessaged?: AgentMessaged
  progressUpdated?: ProgressUpdated
  sessionCompleted?: SessionCompleted
  sessionFailed?: SessionFailed
  artifacts?: Artifact[]
}

export interface ListSessionsResponse {
  sessions?: Session[]
  nextPageToken?: string
}

export interface ListActivitiesResponse {
  activities?: Activity[]
  nextPageToken?: string
}

export interface ListSourcesResponse {
  sources?: Source[]
  nextPageToken?: string
}

export interface CreateSessionRequest {
  prompt: string
  title?: string
  sourceContext?: SourceContext
  requirePlanApproval?: boolean
  automationMode?: AutomationMode
}

export interface SendMessageRequest {
  prompt: string
}
