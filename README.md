# OpenCode Jules Plugin (`oc-jules`)

An advanced, hybrid integration of Google's autonomous AI coding agent (Jules) into OpenCode. 

This plugin bridges the gap between the Jules REST API, the Jules CLI, and the Jules Web UI, providing OpenCode agents with complete orchestration capabilities over your cloud-based coding sessions.

## Features

- **REST API Orchestration:** Create, monitor, and manage Jules sessions directly via the `v1alpha` REST API.
- **CLI Fallback:** Automatically detects the `@google/jules` CLI to enable local diff pulling, applying changes, and parallel session creation.
- **Web UI Playbook:** Uses a hybrid Browser + Internal API approach (via `agent-browser`) to fetch AI-generated suggestions, list active/archived recent sessions, and archive sessions directly from `jules.google.com`.
- **Auto-Context:** Automatically detects your current Git repository and branch to seamlessly link local work with cloud sessions.

## Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/YOUR_USERNAME/oc-jules.git
   cd oc-jules
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Link the plugin to OpenCode:
   ```bash
   ln -s "$(pwd)/src/index.ts" ~/.config/opencode/plugins/oc-jules.ts
   ```

## Configuration

On first run, the plugin will automatically generate a configuration file at `~/.config/opencode/jules.jsonc`. 

You must add your Jules API key to this file. You can generate an API key at [jules.google.com/settings](https://jules.google.com/settings).

See [`jules.example.jsonc`](./jules.example.jsonc) for all available configuration options, including browser settings for the Web UI playbook.

## Available Tools

The plugin exposes 15 tools to OpenCode agents:

### Session Management (REST API)
- `jules_create_session`: Create a new async coding session.
- `jules_list_sessions`: List all sessions.
- `jules_session_status`: Get the current state and outputs of a session.
- `jules_send_message`: Send feedback or instructions to an active session.
- `jules_approve_plan`: Approve an execution plan.
- `jules_delete_session`: Permanently delete a session.
- `jules_list_activities`: View the timeline of events for a session.
- `jules_get_activity`: Get full details of a specific event.

### Source Management (REST API)
- `jules_list_sources`: List connected GitHub repositories.
- `jules_get_source`: Inspect available branches for a repository.

### Local Integration (CLI)
*(Requires `npm i -g @google/jules`)*
- `jules_pull_diff`: Pull a git patch from a completed session.
- `jules_apply_changes`: Apply session changes directly to your local working tree.
- `jules_create_parallel`: Run multiple parallel sessions for the same prompt.
- `jules_cli_status`: Fallback session status viewer.

### Web UI Integration (Browser + Internal API)
- `jules_web_ui_playbook`: Provides the agent with instructions to fetch suggestions, list recent/archived sessions, and archive sessions using `agent-browser`.

## Architecture

This plugin uses a modular architecture:
- `src/client.ts`: Handles REST API communication with exponential backoff and retry logic.
- `src/cli.ts`: Manages local CLI execution and binary detection.
- `src/tools.ts`: Defines the Zod schemas and tool interfaces for OpenCode.
- `playbooks/web-ui.md`: A self-healing markdown playbook that instructs the agent on how to interact with the undocumented Jules internal APIs.