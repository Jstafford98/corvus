<div align="center">
  <img src="corvus/icons/corvus.svg" width="80" height="80" alt="Corvus" />
  <h1>Corvus</h1>
  <p>An AI sidebar assistant for Firefox with browser control tools, conversation history, a skills system, and MCP server support.</p>
</div>

---

> **⚠️ Early development — use at your own risk**
>
> Corvus is a personal project I'm building in the open. It is **not available on addons.mozilla.org** and requires a manual install. Features may break between updates, data may not migrate cleanly, and the codebase is moving fast. If something is broken or you have an idea, **[open an issue](../../issues)**.

---

## What it does

**AI sidebar** — a persistent panel in Firefox that connects to your AI provider. Currently tested and supported with **Anthropic Claude** only. OpenAI and OpenAI-compatible endpoints (Ollama, LM Studio, etc.) are wired up but untested — use at your own risk and open an issue if something is off.

**Browser control tools** — the AI can interact with the page you're on, with your approval for each action:

| Tool | What it does |
|---|---|
| Screenshot | Captures the visible tab so the AI can see what you see |
| Read page | Extracts title, headings, links, and body text |
| Navigate | Goes to a URL |
| Click element | Clicks a DOM element by CSS selector |
| Type text | Fills an input or textarea |
| Inspect element | Returns attributes, sources, layout, and inner content of any element |
| Resource URLs | Lists all network resources and media sources loaded by the page |
| Execute script | Runs arbitrary JavaScript in the page context |

Every tool call shows an approval card before execution — you can allow, deny, or redirect the AI with feedback.

**Skills** — markdown documents injected into the AI's context to give it site-specific knowledge. Generate them automatically for the current page, edit them, enable/disable per session. The AI can also generate skills on demand with `/skills`.

**MCP server support** — connect any local MCP server (Streamable HTTP transport) to expose custom deterministic tools. Add servers in the dashboard, test the connection, and the AI gains access to their tools automatically. Useful for building personal integrations like transcript fetchers, knowledge base queries, or anything you want a reliable single-step tool for.

**Conversation history** — conversations persist locally in `browser.storage`. Resume any past session from the History tab.

**Dashboard** — a VS Code-style settings page (Settings gear → opens in a new tab) with sections for:
- **Chats** — browse and delete past conversations
- **Skills** — create, edit, and manage skills
- **MCP Servers** — add and configure MCP endpoints
- **Tools** — enable/disable individual tools, edit their descriptions
- **Providers** — set your API key, model, provider, and result thresholds
- **Usage** — token usage across conversations

---

## Install (Firefox only)

Corvus is a Firefox MV2 extension. It does not work in Chrome.

**Step 1 — Get the code**

```bash
git clone https://github.com/Jstafford98/corvus.git
cd corvus
```

Or download the ZIP from GitHub and unzip it.

**Step 2 — Load the extension**

1. Open Firefox and go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Navigate to the `corvus/` folder inside the repo and select `manifest.json`

The Corvus icon will appear in your toolbar. Click it to toggle the sidebar.

> **Note:** Temporary add-ons are removed when Firefox fully quits. On macOS, closing the window is not the same as quitting — use **Cmd+Q** to actually exit. After a full quit and relaunch you'll need to reload the extension at `about:debugging`.

**Step 3 — Configure your AI provider**

1. Click the gear icon in the sidebar (or go to Settings in the toolbar menu)
2. Go to **Providers**
3. Select **Anthropic** (recommended — other providers are untested), enter your API key, and choose a model
4. Click **Save**

Your API key is stored locally in `browser.storage.local` and is never sent anywhere except directly to your chosen provider.

---

## API key security

**Where it's stored:** `browser.storage.local` — a sandboxed store that only this extension can read. Websites and other extensions cannot access it.

**Where it goes:** Directly from your browser to Anthropic's API over HTTPS. It does not pass through any server I control. There is no backend.

**What the AI cannot do:** The `execute_script` tool (which lets the AI run JavaScript on a page) explicitly blocks access to `browser` and `chrome` extension APIs, so the AI cannot read your key out of storage — accidentally or otherwise.

**What to know:** The key is stored as plain text on disk inside your Firefox profile. Anyone with access to your filesystem and your Firefox profile directory could read it. For a personal machine this is an acceptable tradeoff; if you're on a shared machine, be aware of that.

**What gets sent to your provider:** Every tool result — screenshots, page text, element content, script output — is included in the message sent to your AI provider. If a tool runs while sensitive information is visible on the page (a password field that has been filled, an API key shown in a settings panel, a login form, a private document), that content may be captured and sent. You are shown an approval card before each tool executes, so you can deny any call that you think would capture something you don't want to share. As a general rule: if you wouldn't be comfortable with your AI provider seeing what's on screen, deny the tool call or navigate away first.

---

## MCP servers

To add a server:
1. Open the dashboard → **MCP Servers**
2. Click **Add**, enter a name and URL (e.g. `http://localhost:3000/mcp`)
3. Click **Test connection** to verify and see discovered tools
4. Click **Add Server**

The extension discovers tools on startup and whenever you save server config. Discovered tools appear in the AI's tool list automatically, namespaced as `ServerName: Tool Name` in the approval UI.

---

## Limitations and known issues

- **Firefox only** — MV2 sidebar APIs are not available in Chrome
- **No automatic updates** — you pull and reload manually
- **Temporary install** — removed when Firefox fully quits (Cmd+Q on Mac); must be reloaded at `about:debugging`
- **MCP transport** — only Streamable HTTP is supported; stdio and legacy HTTP+SSE are not
- **No extension signing** — Firefox may warn about unsigned extensions

---

## Bugs and feature requests

This is early software. If something breaks or you have an idea:

**[Open an issue →](../../issues)**

Please include:
- What you were trying to do
- What happened instead
- Your Firefox version and OS
- Any errors from the browser console (`Ctrl+Shift+J`)

---

## License

MIT
