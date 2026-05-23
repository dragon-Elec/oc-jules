// Jules OpenCode plugin — entry point
import type { Plugin } from "@opencode-ai/plugin"
import { loadConfig, resolveApiKey } from "./config"
import { Logger } from "./logger"
import { JulesClient } from "./client"
import { buildTools } from "./tools"

const DEFAULT_BASE = "https://jules.googleapis.com/v1alpha"

export const JulesPlugin: Plugin = async ({ client }) => {
  const config = loadConfig()
  const logger = new Logger(client, config.logLevel ?? "info")

  const apiKey = resolveApiKey(config)
  if (!apiKey) {
    logger.warn("No API key — API tools disabled. CLI tools may still work if jules CLI is installed.")
  }

  const jules = apiKey
    ? new JulesClient(apiKey, config.baseUrl ?? DEFAULT_BASE, logger, {
        timeoutMs: 30_000,
        maxRetries: 3,
      })
    : null

  logger.info("Jules plugin loading...", { base: config.baseUrl ?? DEFAULT_BASE })

  const tools = await buildTools(jules, config)

  const toolNames = Object.keys(tools)
  logger.info(`Jules plugin ready — ${toolNames.length} tools`, { tools: toolNames })

  return { tool: tools }
}

export default JulesPlugin
