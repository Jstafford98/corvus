# Corvus

An AI sidebar assistant for Firefox with browser control tools, conversation history, a skills system, and MCP server support.

---

> **⚠️ Early development — use at your own risk**
>
> Corvus is a personal project I'm building in the open. It is **not available on addons.mozilla.org** and requires a manual install. Features may break between updates, data may not migrate cleanly, and the codebase is moving fast. If something is broken or you have an idea, **[open an issue](../../issues)** — I read every one.

---

## What it does

**AI sidebar** — a persistent panel in Firefox that connects to your AI provider of choice (Anthropic Claude, OpenAI, or any OpenAI-compatible endpoint like Ollama or LM Studio). Chat with it while you browse without switching tabs.

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

**MCP server support** — connect any local [MCP](https://modelcontextprotocol.io) server (Streamable HTTP transport) to expose custom deterministic tools. Add servers in the dashboard, test the connection, and the AI gains access to their tools automatically. Useful for building personal integrations like transcript fetchers, knowledge base queries, or anything you want a reliable single-step tool for.

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

> **Note:** Temporary add-ons are removed when Firefox restarts. You'll need to reload it each session until a signed release is available.

**Step 3 — Configure your AI provider**

1. Click the gear icon in the sidebar (or go to Settings in the toolbar menu)
2. Go to **Providers**
3. Select your provider, enter your API key, and choose a model
4. Click **Save**

Your API key is stored locally in `browser.storage.local` and is never sent anywhere except directly to your chosen provider.

---

## Optional: hide the duplicate sidebar header

Firefox adds its own title bar above extension sidebars. If it bothers you, you can hide it with `userChrome.css`:

1. Go to `about:profiles`, find your profile folder, and open or create `chrome/userChrome.css`
2. Add:

```css
#sidebar-header { display: none !important; }
```

3. In `about:config`, set `toolkit.legacyUserProfileCustomizations.stylesheets` to `true`
4. Restart Firefox

---

## MCP servers

Corvus supports the [MCP Streamable HTTP transport](https://spec.modelcontextprotocol.io) (protocol version `2024-11-05`). Your server needs to accept POST requests with JSON-RPC 2.0 bodies at a single endpoint and respond with either `application/json` or `text/event-stream`.

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
- **Temporary install** — removed on Firefox restart; must be reloaded at `about:debugging`
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
