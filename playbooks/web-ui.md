# Jules Web UI Playbook

## Purpose
Interact with the Jules web UI to fetch suggestions, list recent/archived sessions, and archive sessions.

## Prerequisites
- Browser running on CDP port {port} (default: `9222`)
- Logged into jules.google.com in that browser
- Source repo must have suggestions enabled at jules.google.com

**Defaults:** `{port}=9222`, `{browserPath}=/usr/bin/brave-browser` (or `google-chrome`). Override in the script calling this playbook.

## Step 1: Connect to Browser
Check if browser is already running on the port:
```bash
curl -s http://localhost:{port}/json/version >/dev/null 2>&1 && echo "Browser already running" || {
  nohup {browserPath} --remote-debugging-port={port} </dev/null >/dev/null 2>&1 &
  sleep 2
}
```
Then connect:
```bash
agent-browser connect {port}
```
If connection fails after launch, report: "Could not connect to browser on port {port}. Check if browser launched correctly."

## Step 2: Navigate to Suggestions
```bash
agent-browser open "https://jules.google.com/repo/github/{source}/suggestions"
```
Wait for page to load. If redirected to login page, report: "Browser not logged into jules.google.com. Please log in manually and retry."

## Step 3: Extract via API (Primary)
Only use `agent-browser` CLI — do NOT try other browser automation tools. They won't connect.

```bash
agent-browser eval "(async () => {
  const at = window.WIZ_global_data?.SNlM0e;
  if (!at) return { error: 'No AT token - not on jules.google.com' };

  const resp = await fetch('/_/Swebot/data/batchexecute?rpcids=p1Takd', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'f.req=' + encodeURIComponent(JSON.stringify([[['p1Takd', '[\"source_id={source}\",4]', null, 'generic']]])) + '&at=' + encodeURIComponent(at)
  });

  const text = await resp.text();
  // Use indexOf('[') not regex — regex gets mangled by shell escaping
  const idx = text.indexOf('[');
  const outer = JSON.parse(text.substring(idx));
  const suggestions = JSON.parse(outer[0][2])[0];

  return suggestions.map(s => {
    const plan = s[10];
    const steps = plan ? plan[1].map(step => ({
      id: step[0], title: step[1], description: step[2], order: step[3]
    })) : [];

    const modelCfg = s[21];
    const flags = modelCfg?.[10]?.reduce((acc, f) => { acc[f[0]] = f[1]; return acc; }, {}) || {};

    return {
      id: s[0],
      title: s[26],
      prompt: s[2],
      source: s[4],
      state: s[5],
      state2: s[25],
      active: s[12],
      version: s[13],
      branches: s[15]?.[1] || [],
      userId: s[30],
      plan: { planId: plan?.[0], steps },
      model: {
        name: modelCfg?.[0],
        version: modelCfg?.[1],
        timeout: modelCfg?.[9]?.[0],
        flags
      }
    };
  });
})()"
```

## Step 4: Extract via DOM (Fallback)
If API extraction returns an error or empty array, use DOM scraping:
```bash
agent-browser eval "(() => {
  const items = document.querySelectorAll('.suggestion-item');
  return Array.from(items).map(item => ({
    title: item.querySelector('.suggestion-title')?.textContent?.trim(),
    category: item.querySelector('.suggestion-info mat-icon[data-mat-icon-type=\"font\"]')?.textContent?.trim(),
    type: item.querySelector('.start-button.primary') ? 'review' : 'start',
    confidence: item.querySelector('.confidence-indicator.confidence-high') ? 'high'
      : item.querySelector('.confidence-indicator.confidence-medium') ? 'medium' : null,
    status: item.querySelector('.task-icon')?.getAttribute('svgicon'),
    sessionId: item.querySelector('a.start-button.primary')?.getAttribute('href')?.replace('/session/', '') || null
  }));
})()"
```

## Step 5: Expand a Suggestion & Extract Structured Fields
To get full details (description, location, rationale, code context), expand all items then extract structured fields:
```bash
agent-browser eval "(() => {
  // Expand all collapsible suggestion items
  document.querySelectorAll('.expand-button').forEach(b => b.click());
  return 'Expanded ' + document.querySelectorAll('.expand-button').length + ' items';
})()"
```
Then extract structured fields:
```bash
agent-browser eval "(() => {
  const items = document.querySelectorAll('.suggestion-item');
  return Array.from(items).map((item, i) => {
    const title = item.querySelector('.suggestion-title')?.textContent?.trim();
    const fields = {};
    // Expanded details use h4 heading
    item.querySelectorAll('h4').forEach(h4 => {
      const label = h4.textContent.trim();
      let next = h4.nextElementSibling;
      let content = '';
      while (next && next.tagName !== 'H4') {
        content += next.textContent + ' ';
        next = next.nextElementSibling;
      }
      fields[label] = content.trim();
    });
    return { index: i, title, ...fields };
  });
})()"
```

**Note: Code context in suggestions is based on a snapshot taken when the suggestion was generated. It may be stale if the file has changed since then. Always verify against actual file contents.**

## Step 6: Fetch Recent Sessions (Active & Archived)
To fetch the user's recent sessions across all repos, use the `p1Takd` API.
For active sessions, use payload `[null,4]`. For archived sessions, use `["is_archived=true",4]`.

```bash
agent-browser eval "(async () => {
  const at = window.WIZ_global_data?.SNlM0e;
  if (!at) return { error: 'No AT token' };

  // Change payload here: '[null,4]' for active, '[\"is_archived=true\",4]' for archived
  const payload = '[null,4]'; 
  
  const resp = await fetch('/_/Swebot/data/batchexecute?rpcids=p1Takd', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'f.req=' + encodeURIComponent(JSON.stringify([[['p1Takd', payload, null, 'generic']]])) + '&at=' + encodeURIComponent(at)
  });

  const text = await resp.text();
  // Use indexOf('[') — regex gets mangled by shell escaping
  const idx = text.indexOf('[');
  const outer = JSON.parse(text.substring(idx));
  const data = JSON.parse(outer[0][2]);
  
  // data[0] contains the sessions array if there are any
  const sessionsArray = Array.isArray(data[0]) ? data[0] : data;

  return sessionsArray.map(s => ({
    id: s[0],
    title: s[26] || (s[10] && s[10][1] && s[10][1][0] ? s[10][1][0][1] : 'Untitled'),
    state: s[5],
    isArchived: s[12] === false
  }));
})()"
```

## Step 7: Archive a Session (DOM)
Since the API payload for archiving is unknown, use the DOM to archive a session.
1. Navigate to the Jules home page:
```bash
agent-browser open "https://jules.google.com"
```
2. Ensure the sidebar is open (if on mobile/narrow screen):
```bash
agent-browser eval "(() => {
  const menuBtn = document.querySelector('button[aria-label=\"Main menu\"]') || document.querySelector('mat-icon[svgicon=\"menu\"]')?.closest('button');
  const sidebar = document.querySelector('mat-sidenav');
  if (menuBtn && sidebar && !sidebar.classList.contains('mat-drawer-opened')) {
    menuBtn.click();
    return 'Opened sidebar';
  }
  return 'Sidebar already open or menu button not found';
})()"
```
3. Find the session in the recent sessions list and click its "Task options" button:
```bash
agent-browser eval "(() => {
  const links = Array.from(document.querySelectorAll('a'));
  // Replace SESSION_TITLE_HERE with the actual title or ID
  const sessionLink = links.find(a => a.textContent.includes('SESSION_TITLE_HERE') || a.href.includes('SESSION_ID_HERE'));
  if (!sessionLink) return 'Session not found';
  
  const container = sessionLink.parentElement;
  const optionsBtn = container.querySelector('button[aria-label=\"Task options\"]') || container.nextElementSibling;
  
  if (optionsBtn) {
    optionsBtn.click();
    return 'Clicked Task options';
  }
  return 'Options button not found';
})()"
```
4. Wait a moment, then click "Archive" in the menu:
```bash
agent-browser eval "(() => {
  const archiveBtn = Array.from(document.querySelectorAll('[role=\"menuitem\"]')).find(el => el.textContent.includes('Archive'));
  if (archiveBtn) {
    archiveBtn.click();
    return 'Clicked Archive';
  }
  return 'Archive button not found';
})()"
```

## Step 8: Start a Suggestion (DOM)
To start a session directly from a suggestion (uses daily limit):
```bash
agent-browser eval "(() => {
  const items = Array.from(document.querySelectorAll('.suggestion-item'));
  // Replace SUGGESTION_TITLE_HERE with the actual title
  const item = items.find(el => el.textContent.includes('SUGGESTION_TITLE_HERE'));
  if (!item) return 'Suggestion not found';
  
  const startBtn = item.querySelector('.start-button.secondary');
  if (startBtn) {
    startBtn.click();
    return 'Clicked Start';
  }
  return 'Start button not found (might already be started)';
})()"
```

## Step 9: Dismiss a Suggestion (DOM)
To dismiss a suggestion from the list. There's a confirmation dialog after clicking close:
```bash
agent-browser eval "(() => {
  const items = Array.from(document.querySelectorAll('.suggestion-item'));
  // Replace SUGGESTION_TITLE_HERE with the actual title
  const item = items.find(el => el.textContent.includes('SUGGESTION_TITLE_HERE'));
  if (!item) return 'Suggestion not found';
  
  const closeBtn = item.querySelector('.action-button.close');
  if (!closeBtn) return 'Close button not found';
  closeBtn.click();
  return 'Clicked close — now confirm dialog';
})()"
```
Then confirm the dialog:
```bash
agent-browser click ".delete-button.primary"
```

## Field Map (API Response)
| Index | Field | Type |
|---|---|---|
| s[0] | Session ID | string |
| s[2] | Full prompt template | string |
| s[4] | Source repo | string |
| s[5] | State (2=planning, 3=active, 4=completed) | number |
| s[6] | Created timestamp [epoch, nanos] | array |
| s[7] | Updated timestamp [epoch, nanos] | array |
| s[10] | Plan [planId, [[stepId, title, desc, order], ...]] | array |
| s[12] | Active | boolean |
| s[13] | Version | number |
| s[15] | Repo + branches [repo, ["main"], true] | array |
| s[21] | Model config | array |
| s[25] | State2 (5=in-progress, 6=suggestion, 7=completed) | number |
| s[26] | Title | string |
| s[30] | User ID | string |

## Category Mapping
| Icon | Category |
|---|---|
| speed | Performance |
| healing | Code Health |
| science | Testing |

## Known rpcids
| rpcid | Function |
|---|---|
| p1Takd | Suggestions list |
| cFjlx | Codebase list |
| xJny7c | Repo config |
| o30O0e | User profile |
| YqkSHd | Source status |

## Maintenance
- **CRITICAL:** Do NOT edit this playbook to perform one-off tasks (like replacing `SESSION_TITLE_HERE` or `SUGGESTION_TITLE_HERE`). This file is a template. You must copy the commands, replace the placeholders in your own execution context, and run them.
- ONLY edit this playbook if the underlying UI, selectors, or API have permanently changed.
- If API extraction fails, fall back to DOM extraction
- If selectors change, inspect the page and update this playbook
- If a new rpcid is needed, capture it with `agent-browser network requests`
- Do not switch from API-first to DOM-first unless API is broken for 3+ consecutive attempts
