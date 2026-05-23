// Jules config loader — reads JSONC config from standard locations
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs"
import { join, dirname } from "path"
import { homedir } from "os"
import type { JulesConfig } from "./types"

// Strip comments + trailing commas, then JSON.parse
function parseJSONC(text: string): any {
  const noSingleLine = text.replace(/\/\/.*$/gm, "")
  const noComments = noSingleLine.replace(/\/\*[\s\S]*?\*\//g, "")
  const noTrailingCommas = noComments.replace(/,\s*([\]}])/g, "$1")
  return JSON.parse(noTrailingCommas)
}

const CONFIG_FILENAMES = ["jules.jsonc", "jules.json"]

function candidatePaths(): string[] {
  const cwd = process.cwd()
  const home = homedir()
  return [
    ...CONFIG_FILENAMES.map(f => join(cwd, ".opencode", f)),
    ...CONFIG_FILENAMES.map(f => join(home, ".config", "opencode", f)),
  ]
}

const DEFAULT_CONFIG = `{
  // Jules API key
  "apiKey": "",
  
  // Log level for debugging
  "logLevel": "info",
  
  // Default settings
  "defaultBranch": "main",
  "requirePlanApproval": false,

  // Suggestions browser config
  "suggestions": {
    "browser": "brave",
    "browserPath": "/usr/bin/brave-browser",
    "port": 9222,
    "useExistingProfile": true
  }
}`

export function loadConfig(): JulesConfig {
  const paths = candidatePaths()
  for (const p of paths) {
    if (!existsSync(p)) continue
    try {
      return parseJSONC(readFileSync(p, "utf-8"))
    } catch {
      // skip malformed config
    }
  }
  
  // If no config found, create default in ~/.config/opencode/jules.jsonc
  const defaultConfigPath = join(homedir(), ".config", "opencode", "jules.jsonc")
  try {
    mkdirSync(dirname(defaultConfigPath), { recursive: true })
    writeFileSync(defaultConfigPath, DEFAULT_CONFIG, "utf-8")
  } catch {
    // ignore write errors
  }
  
  return {}
}

export function resolveApiKey(config: JulesConfig): string | undefined {
  return config.apiKey || process.env.JULES_API_KEY
}
