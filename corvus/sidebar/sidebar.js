"use strict";

// ---------------------------------------------------------------------------
// Tool definitions passed to the AI
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: "take_screenshot",
    description:
      "Captures a screenshot of the currently visible browser tab and returns it as a base64 PNG. Use this when the user asks what you can see, wants visual confirmation, or needs you to observe the current page state.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_page_content",
    description:
      "Returns the page title, URL, headings, links, and a body text excerpt from the active tab. By default truncates body text to 500 chars and returns 30 links — sufficient for navigation and structure. Only set truncate=false if you specifically need the full body text (e.g. reading an article). Prefer skills for site-specific knowledge rather than repeatedly fetching full content.",
    input_schema: {
      type: "object",
      properties: {
        truncate: {
          type: "boolean",
          description: "Default true. Set to false only when you need the full body text (up to 6000 chars and 80 links).",
        },
      },
      required: [],
    },
  },
  {
    name: "navigate",
    description: "Navigates the active tab to the given URL.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Fully-qualified URL to navigate to." },
      },
      required: ["url"],
    },
  },
  {
    name: "click_element",
    description: "Clicks a DOM element matching the given CSS selector on the active tab.",
    input_schema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "A CSS selector identifying the element to click.",
        },
      },
      required: ["selector"],
    },
  },
  {
    name: "type_text",
    description:
      "Sets the value of an input or textarea on the active tab and fires input/change events.",
    input_schema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector of the input element." },
        text: { type: "string", description: "Text to type into the element." },
      },
      required: ["selector", "text"],
    },
  },
  {
    name: "inspect_element",
    description:
      "Returns detailed information about a DOM element: all attributes, src/currentSrc/href, child <source> elements, text tracks, bounding rect, and a snippet of innerHTML/innerText. Use this to find where media is loaded from, inspect video sources, or understand element structure.",
    input_schema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector for the element to inspect." },
      },
      required: ["selector"],
    },
  },
  {
    name: "get_resource_urls",
    description:
      "Returns all network resources loaded by the page via the Performance API, plus all media element sources (video, audio, img). Includes URL, initiator type, duration, and transfer size. Use this to find CDN URLs, media stream origins, or any asset loaded by the page. Optionally filter by keyword.",
    input_schema: {
      type: "object",
      properties: {
        filter: {
          type: "string",
          description: "Optional keyword to filter results by URL or type (e.g. 'video', 'mp4', 'cdn', 'googlevideo').",
        },
      },
      required: [],
    },
  },
  {
    name: "execute_script",
    description:
      "Executes arbitrary JavaScript in the active tab's page context and returns the result. Use this for advanced inspection: reading JS variables, checking media state (video.currentSrc, video.readyState), inspecting window objects, or anything not covered by other tools. The result is JSON-serialized.",
    input_schema: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "JavaScript expression or statements to evaluate. The last expression value is returned.",
        },
      },
      required: ["code"],
    },
  },
];

function getEffectiveTools() {
  const builtIn = TOOLS
    .filter((t) => toolsConfig[t.name]?.enabled !== false)
    .map((t) => {
      const custom = toolsConfig[t.name]?.description;
      return custom ? { ...t, description: custom } : t;
    });
  const mcp = mcpTools.filter((t) => toolsConfig[t.name]?.enabled !== false);
  return [...builtIn, ...mcp];
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let config = {
  provider: "anthropic",
  apiKey: "",
  baseUrl: "",
  model: "",
};

let conversationHistory = [];
let isStreaming = false;
let abortController = null;
let currentConvId = null;
let allSkills = [];
let activeSkillIds = new Set();
let convTokens = { input: 0, output: 0 };
let allTimeTokens = { input: 0, output: 0 };
let customSystemPromptBase = null;
let toolsConfig = {};
let mcpTools = [];
let mcpToolMeta = {};

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const messagesEl = document.getElementById("messages");
const inputEl = document.getElementById("user-input");
const sendBtn = document.getElementById("send-btn");
const stopBtn = document.getElementById("stop-btn");
const inputForm = document.getElementById("input-form");
const noConfigBanner = document.getElementById("no-config-banner");
const toolsStatus = document.getElementById("tools-status");
const toolsStatusText = document.getElementById("tools-status-text");
const screenshotToggle = document.getElementById("screenshot-toggle");
const pageContentToggle = document.getElementById("page-content-toggle");
const settingsBtn = document.getElementById("settings-btn");
const openSettingsLink = document.getElementById("open-settings-link");
const historyList = document.getElementById("history-list");
const newChatBtn = document.getElementById("new-chat-btn");
const skillsBadge = document.getElementById("skills-badge");
const skillsListEl = document.getElementById("skills-list");
const manageSkillsLink = document.getElementById("manage-skills-link");
const generateSkillBtn = document.getElementById("generate-skill-btn");
const chatView = document.getElementById("chat-view");
const historyView = document.getElementById("history-view");
const skillsView = document.getElementById("skills-view");
const tabBtns = document.querySelectorAll(".tab-btn");
const tokenFooter = document.getElementById("token-footer");
const modelSelectEl = document.getElementById("model-select");

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init() {
  await Promise.all([loadConfig(), loadSkills(), loadAllTimeTokens(), loadMcpTools()]);
  checkConfig();

  settingsBtn.addEventListener("click", () => browser.tabs.create({ url: browser.runtime.getURL("dashboard/dashboard.html") }));
  openSettingsLink.addEventListener("click", (e) => {
    e.preventDefault();
    browser.tabs.create({ url: browser.runtime.getURL("dashboard/dashboard.html") });
  });

  tabBtns.forEach((btn) => {
    btn.addEventListener("click", async () => {
      const tab = btn.dataset.tab;
      if (tab === "history") await renderHistoryList();
      if (tab === "skills") await renderSkillsPanel();
      activateTab(tab);
    });
  });

  newChatBtn.addEventListener("click", () => {
    startNewConversation();
    activateTab("chat");
  });

  manageSkillsLink.addEventListener("click", (e) => {
    e.preventDefault();
    browser.tabs.create({ url: browser.runtime.getURL("dashboard/dashboard.html#skills") });
  });

  generateSkillBtn.addEventListener("click", async () => {
    activateTab("chat");
    // Delegate to the slash command handler so everything goes through the same flow
    appendUserMessage("/skills generate a skill for the current page based on its content and structure", null);
    generateSkillBtn.disabled = true;
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const pageResult = await browser.runtime.sendMessage({ type: "GET_PAGE_CONTENT" });
    const pageContext = pageResult?.content
      ? `The current page: title="${pageResult.content.title}", url="${pageResult.content.url}"\n\n${pageResult.content.text?.slice(0, 4000)}`
      : "";
    await runSkillsCommand(`Generate a skill for navigating and automating this website based on its content and structure.${pageContext ? "\n\n" + pageContext : ""}`);
    generateSkillBtn.disabled = false;
  });

  modelSelectEl.addEventListener("change", () => {
    config.model = modelSelectEl.value;
  });

  inputForm.addEventListener("submit", onSubmit);
  stopBtn.addEventListener("click", () => {
    abortController?.abort();
  });

  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      inputForm.requestSubmit();
    }
  });

  inputEl.addEventListener("input", autoResizeTextarea);

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local") {
      if (changes.provider || changes.apiKey || changes.baseUrl || changes.model || changes.largeResultThreshold || changes.systemPromptBase || changes.toolsConfig) {
        loadConfig().then(checkConfig);
      }
      if (changes.skills) {
        loadSkills();
      }
      if (changes.mcpServers) {
        setTimeout(() => loadMcpTools(), 600);
      }
    }
  });

  // Restore last active conversation from session (background clears on browser restart)
  const sessionState = await browser.runtime.sendMessage({ type: "GET_SIDEBAR_STATE" });
  if (sessionState?.convId) {
    await loadConversation(sessionState.convId);
  }
}

function activateTab(name) {
  chatView.classList.toggle("hidden", name !== "chat");
  historyView.classList.toggle("hidden", name !== "history");
  skillsView.classList.toggle("hidden", name !== "skills");
  tabBtns.forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
}

async function loadConfig() {
  const stored = await browser.storage.local.get([
    "provider",
    "apiKey",
    "baseUrl",
    "model",
    "largeResultThreshold",
    "systemPromptBase",
    "toolsConfig",
  ]);
  config = {
    provider: stored.provider || "anthropic",
    apiKey: stored.apiKey || "",
    baseUrl: stored.baseUrl || "",
    model: stored.model || "",
  };
  if (stored.largeResultThreshold > 0) largeResultThreshold = stored.largeResultThreshold;
  customSystemPromptBase = stored.systemPromptBase || null;
  toolsConfig = stored.toolsConfig || {};
  await populateModelSelect();
}

async function loadMcpTools() {
  try {
    const payload = await browser.runtime.sendMessage({ type: "GET_MCP_TOOLS" });
    mcpTools = payload.tools || [];
    mcpToolMeta = payload.meta || {};
  } catch {
    mcpTools = [];
    mcpToolMeta = {};
  }
}

async function fetchModels() {
  if (!config.apiKey) return [];

  const cacheKey = `${config.provider}__${config.baseUrl || ""}`;
  const TTL = 24 * 60 * 60 * 1000;

  const { modelsCache = {} } = await browser.storage.local.get("modelsCache");
  const cached = modelsCache[cacheKey];
  if (cached && Date.now() - cached.ts < TTL) return cached.models;

  let models = [];
  try {
    if (config.provider === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
        headers: {
          "x-api-key": config.apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
      });
      if (res.ok) {
        const data = await res.json();
        models = (data.data || []).map((m) => ({ id: m.id, label: m.display_name || m.id }));
      }
    } else if (config.provider === "openai" || config.provider === "openai-compatible") {
      const baseUrl = (config.baseUrl || "https://api.openai.com").replace(/\/$/, "");
      const res = await fetch(`${baseUrl}/v1/models`, {
        headers: { authorization: `Bearer ${config.apiKey}` },
      });
      if (res.ok) {
        const data = await res.json();
        models = (data.data || []).map((m) => ({ id: m.id, label: m.id }));
        if (config.provider === "openai") {
          models = models.filter((m) =>
            /^(gpt-|o\d|chatgpt-)/.test(m.id) &&
            !/(realtime|audio|search|vision-preview)/.test(m.id)
          );
        }
        models.sort((a, b) => b.id.localeCompare(a.id));
      }
    }
  } catch {
    return cached?.models || [];
  }

  if (models.length) {
    modelsCache[cacheKey] = { models, ts: Date.now() };
    await browser.storage.local.set({ modelsCache });
  }

  return models.length ? models : (cached?.models || []);
}

async function populateModelSelect() {
  if (!config.apiKey) {
    modelSelectEl.classList.add("hidden");
    return;
  }

  modelSelectEl.classList.remove("hidden");
  modelSelectEl.disabled = true;
  modelSelectEl.innerHTML = "<option>Loading…</option>";

  const models = await fetchModels();

  modelSelectEl.disabled = false;
  modelSelectEl.innerHTML = "";

  if (!models.length) {
    modelSelectEl.classList.add("hidden");
    return;
  }

  for (const m of models) {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.label;
    modelSelectEl.appendChild(opt);
  }

  if (config.model && models.some((m) => m.id === config.model)) {
    modelSelectEl.value = config.model;
  } else {
    modelSelectEl.value = models[0].id;
    config.model = models[0].id;
  }
}

function checkConfig() {
  const hasKey = config.apiKey.trim().length > 0;
  const hasUrl = config.provider === "openai-compatible" ? config.baseUrl.trim().length > 0 : true;
  noConfigBanner.classList.toggle("hidden", hasKey && hasUrl);
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

async function loadSkills() {
  const stored = await browser.storage.local.get("skills");
  allSkills = stored.skills || [];
  await autoActivateSkillsForCurrentTab();
  updateSkillsBadge();
}

async function loadAllTimeTokens() {
  const stored = await browser.storage.local.get("allTimeTokens");
  const saved = stored.allTimeTokens || {};
  allTimeTokens = {
    input: saved.input || 0,
    output: saved.output || 0,
    byProvider: saved.byProvider || {},
  };
}

async function recordTokenUsage(usage) {
  convTokens.input  += usage.input;
  convTokens.output += usage.output;
  allTimeTokens.input  += usage.input;
  allTimeTokens.output += usage.output;
  const p = config.provider;
  if (!allTimeTokens.byProvider[p]) allTimeTokens.byProvider[p] = { input: 0, output: 0 };
  allTimeTokens.byProvider[p].input  += usage.input;
  allTimeTokens.byProvider[p].output += usage.output;
  updateTokenFooter();
  await browser.storage.local.set({ allTimeTokens });
}

function updateTokenFooter() {
  const total = convTokens.input + convTokens.output;
  if (total === 0) {
    tokenFooter.classList.add("hidden");
    return;
  }
  tokenFooter.classList.remove("hidden");
  tokenFooter.textContent = `↑ ${convTokens.input.toLocaleString()} · ↓ ${convTokens.output.toLocaleString()} tokens this conversation`;
}

async function autoActivateSkillsForCurrentTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const url = tabs[0]?.url ?? "";
  if (!url) return;
  for (const skill of allSkills) {
    if (skill.urlPattern && urlMatchesPattern(skill.urlPattern, url)) {
      if (!activeSkillIds.has(skill.id)) {
        activeSkillIds.add(skill.id);
        appendSkillLoadedIndicator(skill);
      }
    }
  }
}

function updateSkillsBadge() {
  const count = activeSkillIds.size;
  skillsBadge.textContent = count > 0 ? String(count) : "";
  skillsBadge.classList.toggle("hidden", count === 0);
}

function urlMatchesPattern(pattern, url) {
  if (!pattern || !url) return false;
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  try {
    return new RegExp(`^${escaped}$`).test(url);
  } catch {
    return false;
  }
}

async function renderSkillsPanel() {
  skillsListEl.innerHTML = "";

  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const currentUrl = tabs[0]?.url ?? "";

  if (!allSkills.length) {
    const empty = document.createElement("div");
    empty.className = "skills-empty";
    empty.innerHTML = `No skills yet. <a href="#" id="create-first-skill">Create one</a> to get started.`;
    empty.querySelector("#create-first-skill").addEventListener("click", (e) => {
      e.preventDefault();
      browser.tabs.create({ url: browser.runtime.getURL("dashboard/dashboard.html#skills") });
    });
    skillsListEl.appendChild(empty);
    return;
  }

  // Sort: URL-matching skills first
  const sorted = [...allSkills].sort((a, b) => {
    const am = urlMatchesPattern(a.urlPattern, currentUrl);
    const bm = urlMatchesPattern(b.urlPattern, currentUrl);
    return bm - am;
  });

  for (const skill of sorted) {
    const matches = urlMatchesPattern(skill.urlPattern, currentUrl);
    const isActive = activeSkillIds.has(skill.id);

    const row = document.createElement("label");
    row.className = "skill-toggle-row" + (matches ? " url-match" : "") + (isActive ? " is-active" : "");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = isActive;
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) activeSkillIds.add(skill.id);
      else activeSkillIds.delete(skill.id);
      row.classList.toggle("is-active", checkbox.checked);
      updateSkillsBadge();
    });

    const info = document.createElement("div");
    info.className = "skill-toggle-info";
    info.innerHTML = `
      <span class="skill-toggle-name">${escapeHtml(skill.name)}</span>
      ${matches ? '<span class="skill-url-badge">matches page</span>' : ""}
      ${skill.description ? `<span class="skill-toggle-desc">${escapeHtml(skill.description)}</span>` : ""}
    `;

    row.appendChild(checkbox);
    row.appendChild(info);
    skillsListEl.appendChild(row);
  }
}

const DEFAULT_SYSTEM_PROMPT_BASE =
  "You are a helpful AI browser assistant. You can see the user's screen, navigate pages, click elements, and type text. Be concise. When using tools, explain briefly what you're doing.";

function buildSystemPrompt() {
  const base = customSystemPromptBase || DEFAULT_SYSTEM_PROMPT_BASE;

  const parts = [base];

  // Token context so the AI can answer usage questions
  const convTotal = convTokens.input + convTokens.output;
  const allTotal  = allTimeTokens.input + allTimeTokens.output;
  if (convTotal > 0 || allTotal > 0) {
    parts.push(
      `[Token usage — this conversation: ${convTokens.input.toLocaleString()} input, ${convTokens.output.toLocaleString()} output` +
      (allTotal > 0 ? `; all-time: ${allTimeTokens.input.toLocaleString()} input, ${allTimeTokens.output.toLocaleString()} output` : "") +
      `]`
    );
  }

  const active = allSkills.filter((s) => activeSkillIds.has(s.id));
  if (active.length) {
    const skillsText = active
      .map((s) => `### Skill: ${s.name}\n${s.content}`)
      .join("\n\n");
    parts.push(`---\n\nThe following skills are loaded and provide site-specific knowledge you should use. If the user asks whether you have a skill for something, refer to this list.\n\n${skillsText}`);
  }

  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// Conversation persistence
// ---------------------------------------------------------------------------

function startNewConversation() {
  conversationHistory = [];
  currentConvId = null;
  browser.runtime.sendMessage({ type: "SET_SIDEBAR_STATE", state: { convId: null } });
  convTokens = { input: 0, output: 0 };
  messagesEl.innerHTML = "";
  updateTokenFooter();
  // Reset model to stored default
  browser.storage.local.get("model").then(({ model }) => {
    config.model = model || config.model;
    const opts = modelSelectEl.options;
    for (let i = 0; i < opts.length; i++) {
      if (opts[i].value === config.model) { modelSelectEl.value = config.model; break; }
    }
  });
}

async function saveConversation() {
  if (!conversationHistory.length) return;

  // Strip binary image data before storing to save space
  const stripped = conversationHistory.map((msg) => {
    if (typeof msg.content === "string") return msg;
    return {
      ...msg,
      content: msg.content.map((block) => {
        if (block.type === "image") return { type: "text", text: "[image]" };
        if (block.type === "tool_result" && Array.isArray(block.content)) {
          return {
            ...block,
            content: block.content.map((b) =>
              b.type === "image" ? { type: "text", text: "[screenshot]" } : b
            ),
          };
        }
        return block;
      }),
    };
  });

  const firstUserText = conversationHistory
    .find((m) => m.role === "user")
    ?.content?.find?.((b) => b.type === "text" && !b.text.startsWith("["))
    ?.text ?? "Conversation";

  const title = firstUserText.slice(0, 60);

  if (!currentConvId) {
    currentConvId = `conv_${Date.now()}`;
    browser.runtime.sendMessage({ type: "SET_SIDEBAR_STATE", state: { convId: currentConvId } });
  }

  const { convIndex = [] } = await browser.storage.local.get("convIndex");
  const existing = convIndex.findIndex((c) => c.id === currentConvId);
  const entry = { id: currentConvId, ts: Date.now(), title };

  if (existing >= 0) convIndex[existing] = entry;
  else convIndex.unshift(entry);

  // Keep at most 50 conversations
  const trimmed = convIndex.slice(0, 50);
  const removedIds = convIndex.slice(50).map((c) => c.id);

  await browser.storage.local.set({
    convIndex: trimmed,
    [currentConvId]: stripped,
  });

  if (removedIds.length) {
    await browser.storage.local.remove(removedIds);
  }
}

async function loadConversation(id) {
  const stored = await browser.storage.local.get(id);
  const history = stored[id];
  if (!history) return;

  conversationHistory = history;
  currentConvId = id;
  browser.runtime.sendMessage({ type: "SET_SIDEBAR_STATE", state: { convId: id } });
  messagesEl.innerHTML = "";

  for (const msg of history) {
    if (msg.role === "user") {
      const toolResults = Array.isArray(msg.content)
        ? msg.content.filter((b) => b.type === "tool_result")
        : [];
      if (toolResults.length) continue; // these are internal, skip rendering

      const textBlocks = Array.isArray(msg.content)
        ? msg.content.filter((b) => b.type === "text" && !b.text.startsWith("[Page content]"))
        : [];
      const text = typeof msg.content === "string"
        ? msg.content
        : textBlocks.map((b) => b.text).join("\n");
      if (text) appendUserMessage(text, null);
    } else if (msg.role === "assistant") {
      const textBlocks = Array.isArray(msg.content)
        ? msg.content.filter((b) => b.type === "text")
        : [];
      const toolUseBlocks = Array.isArray(msg.content)
        ? msg.content.filter((b) => b.type === "tool_use")
        : [];

      if (textBlocks.length) {
        appendAssistantMessage(textBlocks.map((b) => b.text).join("\n"));
      }
      for (const block of toolUseBlocks) {
        appendToolIndicator(block.name, block.input, { restored: true, success: true });
      }
    }
  }
  scrollToBottom();
}

async function renderHistoryList() {
  const { convIndex = [] } = await browser.storage.local.get("convIndex");
  historyList.innerHTML = "";

  if (!convIndex.length) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = "No saved conversations yet.";
    historyList.appendChild(empty);
    return;
  }

  for (const entry of convIndex) {
    const item = document.createElement("div");
    item.className = "history-item" + (entry.id === currentConvId ? " active" : "");

    const title = document.createElement("div");
    title.className = "history-item-title";
    title.textContent = entry.title;

    const time = document.createElement("div");
    time.className = "history-item-time";
    time.textContent = formatRelativeTime(entry.ts);

    item.appendChild(title);
    item.appendChild(time);
    item.addEventListener("click", () => {
      loadConversation(entry.id);
      activateTab("chat");
    });
    historyList.appendChild(item);
  }
}

function formatRelativeTime(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

// ---------------------------------------------------------------------------
// Slash commands
// ---------------------------------------------------------------------------

const SLASH_COMMANDS = {
  skills: "Generate or manage skills  —  /skills <instruction>",
};

async function handleSlashCommand(raw) {
  const spaceIdx = raw.indexOf(" ");
  const cmd = (spaceIdx === -1 ? raw.slice(1) : raw.slice(1, spaceIdx)).toLowerCase();
  const args = spaceIdx === -1 ? "" : raw.slice(spaceIdx + 1).trim();

  appendUserMessage(raw, null);

  if (cmd === "skills") {
    await runSkillsCommand(args);
  } else {
    appendErrorMessage(`Unknown command: /${cmd}\n\nAvailable: ${Object.keys(SLASH_COMMANDS).map(c => `/${c}`).join(", ")}`);
  }
}

async function runSkillsCommand(instruction) {
  if (!instruction) {
    appendErrorMessage('/skills needs an instruction, e.g:\n  /skills create a skill for YouTube navigation based on this conversation');
    return;
  }

  const thinkingEl = appendThinkingMessage("Generating skill…");

  // Build a text-only summary of the conversation for context
  const conversationText = conversationHistory
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => {
      const role = m.role === "user" ? "User" : "Assistant";
      const textBlocks = Array.isArray(m.content)
        ? m.content.filter((b) => b.type === "text").map((b) => b.text)
        : [String(m.content)];
      const text = textBlocks.join("\n").trim();
      return text ? `${role}: ${text}` : null;
    })
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 12000);

  const systemPrompt = `You are a skill generator for an AI browser assistant called "Corvus".
Skills are markdown documents injected into the assistant's system prompt to give it site-specific knowledge.
A good skill documents: key CSS selectors, step-by-step task instructions, URL patterns, and any page-specific gotchas.

Return ONLY a valid JSON object — no prose, no code fences — with exactly these fields:
{
  "name": "Short descriptive name (max 60 chars)",
  "description": "One sentence shown in the skill picker (max 120 chars)",
  "urlPattern": "Glob pattern like *youtube.com* or empty string if not site-specific",
  "content": "Full skill content in markdown"
}`;

  const messages = [
    {
      role: "user",
      content: `${conversationText ? `## Conversation so far\n\n${conversationText}\n\n---\n\n` : ""}## Instruction\n\n${instruction}`,
    },
  ];

  const response = await callAIOnce(systemPrompt, messages);
  thinkingEl.remove();

  if (response.error) {
    appendErrorMessage(`Skill generation failed: ${response.error}`);
    return;
  }

  const rawText = response.content?.find((b) => b.type === "text")?.text ?? "";
  let skill;
  try {
    // Strip possible markdown fences the model adds despite instructions
    const jsonStr = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    skill = JSON.parse(jsonStr);
  } catch {
    appendErrorMessage(`Couldn't parse the generated skill. Raw output:\n\n${rawText}`);
    return;
  }

  showSkillPreviewCard(skill);
}

function appendThinkingMessage(label) {
  const el = document.createElement("div");
  el.className = "message assistant";
  el.innerHTML = `
    <div class="message-role">Assistant</div>
    <div class="message-bubble" style="color:var(--text-muted)">
      <span class="thinking-dots"><span></span><span></span><span></span></span>
      ${escapeHtml(label)}
    </div>`;
  messagesEl.appendChild(el);
  scrollToBottom();
  return el;
}

function showSkillPreviewCard(skill) {
  const card = document.createElement("div");
  card.className = "skill-preview-card";

  card.innerHTML = `
    <div class="skill-preview-header">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="skill-preview-icon">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
      </svg>
      <span>Generated skill</span>
    </div>
    <div class="skill-preview-fields">
      <label>Name<input class="skill-preview-name" value="${escapeHtml(skill.name ?? "")}"/></label>
      <label>URL pattern<input class="skill-preview-pattern" value="${escapeHtml(skill.urlPattern ?? "")}"/></label>
      <label>Description<input class="skill-preview-description" value="${escapeHtml(skill.description ?? "")}"/></label>
      <label>Content<textarea class="skill-preview-content">${escapeHtml(skill.content ?? "")}</textarea></label>
    </div>
    <div class="skill-preview-actions">
      <button class="skill-preview-discard">Discard</button>
      <button class="skill-preview-save">Save skill</button>
    </div>
  `;

  card.querySelector(".skill-preview-save").addEventListener("click", async () => {
    const newSkill = {
      id: `skill_${Date.now()}`,
      name: card.querySelector(".skill-preview-name").value.trim() || "Untitled",
      description: card.querySelector(".skill-preview-description").value.trim(),
      urlPattern: card.querySelector(".skill-preview-pattern").value.trim(),
      content: card.querySelector(".skill-preview-content").value.trim(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const { skills: existing = [] } = await browser.storage.local.get("skills");
    await browser.storage.local.set({ skills: [newSkill, ...existing] });
    await loadSkills();

    card.querySelector(".skill-preview-actions").remove();
    card.querySelector(".skill-preview-fields").remove();
    const saved = document.createElement("div");
    saved.className = "skill-preview-saved";
    saved.textContent = `Skill "${newSkill.name}" saved.`;
    card.appendChild(saved);
  });

  card.querySelector(".skill-preview-discard").addEventListener("click", () => {
    card.remove();
  });

  messagesEl.appendChild(card);
  scrollToBottom();
}

// One-off AI call that doesn't touch conversationHistory
async function callAIOnce(systemPrompt, messages) {
  const provider = config.provider;
  if (provider === "anthropic") {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": config.apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: config.model || "claude-sonnet-4-6",
          max_tokens: 2048,
          system: systemPrompt,
          messages,
        }),
      });
      const data = await res.json();
      if (!res.ok) return { error: data?.error?.message || `HTTP ${res.status}` };
      return { content: data.content };
    } catch (err) {
      return { error: err.message };
    }
  } else {
    const baseUrl = config.baseUrl || "https://api.openai.com";
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model || "gpt-4o",
          max_tokens: 2048,
          messages: [{ role: "system", content: systemPrompt }, ...messages],
        }),
      });
      const data = await res.json();
      if (!res.ok) return { error: data?.error?.message || `HTTP ${res.status}` };
      const text = data.choices?.[0]?.message?.content ?? "";
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return { error: err.message };
    }
  }
}

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

async function onSubmit(e) {
  e.preventDefault();
  if (isStreaming) return;

  const text = inputEl.value.trim();
  if (!text) return;

  inputEl.value = "";
  autoResizeTextarea();

  if (text.startsWith("/")) {
    await handleSlashCommand(text);
    return;
  }

  await autoActivateSkillsForCurrentTab();

  const userContent = [];

  // Inline screenshot if toggle is on
  if (screenshotToggle.checked) {
    screenshotToggle.checked = false;
    const result = await browser.runtime.sendMessage({ type: "TAKE_SCREENSHOT" });
    if (result && result.dataUrl) {
      userContent.push({
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: result.dataUrl.replace(/^data:image\/png;base64,/, ""),
        },
      });
    }
  }

  // Inline page content if toggle is on
  if (pageContentToggle.checked) {
    pageContentToggle.checked = false;
    const result = await browser.runtime.sendMessage({ type: "GET_PAGE_CONTENT" });
    if (result && result.content) {
      const { title, url, text: pageText } = result.content;
      userContent.push({
        type: "text",
        text: `[Page content]\nTitle: ${title}\nURL: ${url}\n\n${pageText}`,
      });
    }
  }

  userContent.push({ type: "text", text });

  const userMessage = { role: "user", content: userContent };
  conversationHistory.push(userMessage);

  // Render user turn
  const displayText = userContent
    .filter((c) => c.type === "text" && !c.text.startsWith("[Page content]"))
    .map((c) => c.text)
    .join("\n");

  const hasImage = userContent.some((c) => c.type === "image");
  const imageData = hasImage
    ? userContent.find((c) => c.type === "image")?.source?.data
    : null;

  appendUserMessage(displayText, imageData);

  await runAgentLoop();
}

// ---------------------------------------------------------------------------
// Agent loop (handles tool calls)
// ---------------------------------------------------------------------------

async function runAgentLoop() {
  isStreaming = true;
  abortController = new AbortController();
  setStopMode(true);

  try {
    while (true) {
      const response = await callAI(conversationHistory, abortController.signal);

      if (response.aborted) break;

      if (response.error) {
        appendErrorMessage(response.error);
        break;
      }

      if (response.usage) await recordTokenUsage(response.usage);

      conversationHistory.push({ role: "assistant", content: response.content, _usage: response.usage || null });

      // Compact tool results from the preceding user turn — they've been consumed
      const prevMsg = conversationHistory[conversationHistory.length - 2];
      if (prevMsg?.role === "user" && Array.isArray(prevMsg.content) &&
          prevMsg.content.some((b) => b.type === "tool_result")) {
        prevMsg.content = prevMsg.content.map((b) =>
          b.type === "tool_result"
            ? { type: "tool_result", tool_use_id: b.tool_use_id, content: "[consumed]" }
            : b
        );
      }

      // Render text blocks
      const textBlocks = response.content.filter((b) => b.type === "text");
      if (textBlocks.length) {
        const fullText = textBlocks.map((b) => b.text).join("\n");
        appendAssistantMessage(fullText);
        if (response.usage) appendTokenIndicator(response.usage);
      }

      // Handle tool use
      const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");
      if (!toolUseBlocks.length) break;

      // Execute tools sequentially and collect results
      const toolResults = [];
      for (const block of toolUseBlocks) {
        if (abortController.signal.aborted) break;

        // Show pending indicator before approval card appears
        const indicatorEl = appendToolIndicator(block.name, block.input, null);

        // decision: true = allow, false = deny+abort, string = deny with instruction
        const decision = await awaitApproval(block.name, block.input, abortController.signal);

        if (decision === false) {
          resolveToolIndicator(indicatorEl, "denied", null);
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: "User denied this tool call.",
            is_error: true,
          });
          abortController.abort();
          break;
        }

        if (typeof decision === "string") {
          resolveToolIndicator(indicatorEl, "denied", null);
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: `User declined and provided guidance: "${decision}"`,
            is_error: true,
          });
          continue;
        }

        showToolStatus(`Running: ${block.name}…`);
        const result = await executeTool(block.name, block.input);
        resolveToolIndicator(indicatorEl, result?.error ? "error" : "success", result);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: formatToolResult(block.name, result),
        });
      }

      hideToolStatus();

      // Fill stubs for any tool_use blocks that never got a result (e.g. aborted mid-loop)
      for (const block of toolUseBlocks) {
        if (!toolResults.some((r) => r.tool_use_id === block.id)) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: "Cancelled.",
            is_error: true,
          });
        }
      }

      conversationHistory.push({ role: "user", content: toolResults });

      if (abortController.signal.aborted) break;
    }
  } finally {
    isStreaming = false;
    abortController = null;
    setStopMode(false);
    saveConversation();
  }
}

// ---------------------------------------------------------------------------
// AI call (Anthropic Messages API or OpenAI-compatible)
// ---------------------------------------------------------------------------

async function callAI(messages, signal) {
  const provider = config.provider;

  if (provider === "anthropic") {
    return callAnthropic(messages, signal);
  } else if (provider === "openai" || provider === "openai-compatible") {
    return callOpenAI(messages, signal);
  } else {
    return { error: `Unknown provider: ${provider}` };
  }
}

async function callAnthropic(messages, signal) {
  const model = config.model || "claude-sonnet-4-6";
  const url = "https://api.anthropic.com/v1/messages";

  try {
    const res = await fetch(url, {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        system: buildSystemPrompt(),
        messages: messages.map(({ _usage, ...m }) => m),
        tools: getEffectiveTools(),
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      return { error: data?.error?.message || `HTTP ${res.status}` };
    }

    const usage = data.usage
      ? { input: data.usage.input_tokens, output: data.usage.output_tokens }
      : null;
    return { content: data.content, stop_reason: data.stop_reason, usage };
  } catch (err) {
    if (err.name === "AbortError") return { aborted: true };
    return { error: err.message };
  }
}

async function callOpenAI(messages, signal) {
  const model = config.model || "gpt-4o";
  const baseUrl = config.baseUrl || "https://api.openai.com";
  const url = `${baseUrl.replace(/\/$/, "")}/v1/chat/completions`;

  // Convert Anthropic-style messages → OpenAI format (flatten arrays from tool result conversion)
  const oaiMessages = [
    {
      role: "system",
      content: buildSystemPrompt(),
    },
    ...messages.map(({ _usage, ...m }) => m).flatMap(convertMessageToOAI),
  ];

  // Convert tools
  const oaiTools = getEffectiveTools().map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));

  try {
    const res = await fetch(url, {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        messages: oaiMessages,
        tools: oaiTools,
        tool_choice: "auto",
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      return { error: data?.error?.message || `HTTP ${res.status}` };
    }

    const choice = data.choices?.[0];
    if (!choice) return { error: "No choices returned" };

    // Convert back to Anthropic-style content array
    const content = [];
    if (choice.message.content) {
      content.push({ type: "text", text: choice.message.content });
    }
    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        content.push({
          type: "tool_use",
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments || "{}"),
        });
      }
    }

    const usage = data.usage
      ? { input: data.usage.prompt_tokens, output: data.usage.completion_tokens }
      : null;
    return { content, stop_reason: choice.finish_reason, usage };
  } catch (err) {
    if (err.name === "AbortError") return { aborted: true };
    return { error: err.message };
  }
}

// Returns array of OAI messages (tool results expand to multiple messages)
function convertMessageToOAI(msg) {
  if (typeof msg.content === "string") {
    return [{ role: msg.role, content: msg.content }];
  }

  // user or assistant with content array
  if (msg.role === "user") {
    // Check for tool_result blocks
    const toolResults = msg.content.filter((b) => b.type === "tool_result");
    if (toolResults.length) {
      return toolResults.map((tr) => ({
        role: "tool",
        tool_call_id: tr.tool_use_id,
        content:
          typeof tr.content === "string"
            ? tr.content
            : JSON.stringify(tr.content),
      }));
    }

    // Regular user message with possible images
    const parts = msg.content.map((block) => {
      if (block.type === "text") return { type: "text", text: block.text };
      if (block.type === "image") {
        return {
          type: "image_url",
          image_url: {
            url: `data:${block.source.media_type};base64,${block.source.data}`,
          },
        };
      }
      return { type: "text", text: JSON.stringify(block) };
    });
    return [{ role: "user", content: parts }];
  }

  if (msg.role === "assistant") {
    const textBlocks = msg.content.filter((b) => b.type === "text");
    const toolUseBlocks = msg.content.filter((b) => b.type === "tool_use");
    return [{
      role: "assistant",
      content: textBlocks.map((b) => b.text).join("\n") || null,
      tool_calls: toolUseBlocks.length
        ? toolUseBlocks.map((b) => ({
            id: b.id,
            type: "function",
            function: { name: b.name, arguments: JSON.stringify(b.input) },
          }))
        : undefined,
    }];
  }

  return [{ role: msg.role, content: JSON.stringify(msg.content) }];
}

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

async function executeTool(name, input) {
  switch (name) {
    case "take_screenshot":
      return browser.runtime.sendMessage({ type: "TAKE_SCREENSHOT" });
    case "get_page_content":
      return browser.runtime.sendMessage({ type: "GET_PAGE_CONTENT", truncate: input.truncate !== false });
    case "navigate":
      return browser.runtime.sendMessage({ type: "NAVIGATE", url: input.url });
    case "click_element":
      return browser.runtime.sendMessage({ type: "CLICK_ELEMENT", selector: input.selector });
    case "type_text":
      return browser.runtime.sendMessage({ type: "TYPE_TEXT", selector: input.selector, text: input.text });
    case "inspect_element":
      return browser.runtime.sendMessage({ type: "INSPECT_ELEMENT", selector: input.selector });
    case "get_resource_urls":
      return browser.runtime.sendMessage({ type: "GET_RESOURCE_URLS", filter: input.filter || "" });
    case "execute_script":
      return browser.runtime.sendMessage({ type: "EXECUTE_SCRIPT", code: input.code });
    default:
      if (name.startsWith("mcp__")) {
        const parts = name.split("__");
        const serverId = parts[1];
        const toolName = parts.slice(2).join("__");
        return browser.runtime.sendMessage({ type: "CALL_MCP_TOOL", serverId, toolName, input });
      }
      return { error: `Unknown tool: ${name}` };
  }
}

let largeResultThreshold = 12000; // chars of JSON, configurable
const largeResultStore = new Map();

function formatToolResult(name, result) {
  if (name === "take_screenshot" && result?.dataUrl) {
    return [
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: result.dataUrl.replace(/^data:image\/png;base64,/, ""),
        },
      },
    ];
  }
  if (result?.error) return `Error: ${result.error}`;

  const json = JSON.stringify(result, null, 2);
  if (json.length > largeResultThreshold) {
    const key = `tool_result_${Date.now()}`;
    largeResultStore.set(key, result);
    const kb = Math.round(json.length / 1024);
    return (
      `[Large result — ${kb}KB, stored as "${key}"]\n\n` +
      `This result is too large to include in context directly. Use more targeted tools ` +
      `(execute_script with a specific expression, get_resource_urls with a filter, etc.) ` +
      `to access only the data you need.\n\nPreview:\n${json.slice(0, 600)}…`
    );
  }

  return json;
}

// ---------------------------------------------------------------------------
// Tool approval
// ---------------------------------------------------------------------------

function describeToolCall(name, input) {
  switch (name) {
    case "take_screenshot":   return "Capture a screenshot of the current tab";
    case "get_page_content":  return "Read the text and links from the current page";
    case "navigate":          return `Navigate to:\n${input?.url ?? ""}`;
    case "click_element":     return `Click element:\n${input?.selector ?? ""}`;
    case "type_text":         return `Type into ${input?.selector ?? ""}:\n"${(input?.text ?? "").slice(0, 120)}"`;
    case "inspect_element":   return `Inspect element:\n${input?.selector ?? ""}`;
    case "get_resource_urls": return `List all network resources loaded by this page${input?.filter ? `\nFilter: "${input.filter}"` : ""}`;
    case "execute_script":    return `Run JavaScript:\n${(input?.code ?? "").slice(0, 300)}`;
    default: {
      const m = mcpToolMeta[name];
      const header = m ? `${m.serverName} — ${m.label}` : name;
      const args = Object.keys(input ?? {}).length ? `\n${JSON.stringify(input, null, 2)}` : "";
      return header + args;
    }
  }
}

function awaitApproval(name, input, signal) {
  return new Promise((resolve) => {
    const meta = getToolMeta(name);

    const card = document.createElement("div");
    card.className = "approval-card";

    card.innerHTML = `
      <div class="approval-header">
        <svg class="approval-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="${meta.icon}"/>
        </svg>
        <span class="approval-tool-name">${escapeHtml(meta.label)}</span>
      </div>
      <div class="approval-desc">${escapeHtml(describeToolCall(name, input))}</div>
      <div class="approval-instruction-row">
        <input class="approval-instruction" type="text" placeholder="Redirect the AI (leave empty to just stop)…" />
      </div>
      <div class="approval-actions">
        <button class="approval-deny">Deny</button>
        <button class="approval-allow">Allow</button>
      </div>
    `;

    // result: true = allow, false = deny+abort, string = deny with instruction
    function decide(result) {
      signal?.removeEventListener("abort", onAbort);
      card.querySelector(".approval-actions").remove();
      card.querySelector(".approval-instruction-row").remove();
      const badge = document.createElement("div");
      const allowed = result === true;
      const instructed = typeof result === "string";
      badge.className = "approval-badge " + (allowed ? "approval-badge-allow" : "approval-badge-deny");
      badge.textContent = allowed ? "Allowed" : instructed ? `Denied — "${result}"` : "Denied";
      card.appendChild(badge);
      card.classList.add(allowed ? "resolved-allow" : "resolved-deny");
      resolve(result);
    }

    function onAbort() { decide(false); }

    const instructionEl = card.querySelector(".approval-instruction");

    card.querySelector(".approval-allow").addEventListener("click", () => decide(true));
    card.querySelector(".approval-deny").addEventListener("click", () => {
      const instruction = instructionEl.value.trim();
      decide(instruction || false);
    });
    instructionEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const instruction = instructionEl.value.trim();
        decide(instruction || false);
      }
    });
    signal?.addEventListener("abort", onAbort, { once: true });

    messagesEl.appendChild(card);
    scrollToBottom();
  });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const COPY_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
const CHECK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`;

function addCopyButton(messageEl) {
  const btn = document.createElement("button");
  btn.className = "copy-btn";
  btn.title = "Copy";
  btn.innerHTML = COPY_ICON;
  btn.addEventListener("click", async () => {
    const bubble = messageEl.querySelector(".message-bubble");
    const text = (bubble.innerText || bubble.textContent || "").trim();
    try {
      await navigator.clipboard.writeText(text);
      btn.innerHTML = CHECK_ICON;
      btn.classList.add("copied");
      setTimeout(() => { btn.innerHTML = COPY_ICON; btn.classList.remove("copied"); }, 1500);
    } catch { /* clipboard unavailable */ }
  });
  messageEl.appendChild(btn);
}

function appendUserMessage(text, imageDataUrl) {
  const el = createMessageEl("user", "You");
  const bubble = el.querySelector(".message-bubble");

  if (imageDataUrl) {
    const img = document.createElement("img");
    img.className = "screenshot-thumb";
    img.src = `data:image/png;base64,${imageDataUrl}`;
    img.alt = "Screenshot";
    img.addEventListener("click", () => {
      const win = window.open();
      win.document.write(`<img src="${img.src}" style="max-width:100%">`);
    });
    bubble.appendChild(img);
  }

  if (text) {
    const textEl = document.createElement("span");
    textEl.textContent = text;
    bubble.appendChild(textEl);
  }

  addCopyButton(el);
  messagesEl.appendChild(el);
  scrollToBottom();
}

function appendAssistantMessage(text) {
  const el = createMessageEl("assistant", "Assistant");
  el.querySelector(".message-bubble").innerHTML = renderMarkdown(text);
  addCopyButton(el);
  messagesEl.appendChild(el);
  scrollToBottom();
}

const MCP_ICON = "M12 5v14 M5 12h14 M4.93 4.93l4.24 4.24 M14.83 9.17l4.24-4.24 M4.93 19.07l4.24-4.24 M14.83 14.83l4.24 4.24";

function getToolMeta(name) {
  if (TOOL_META[name]) return TOOL_META[name];
  const m = mcpToolMeta[name];
  if (m) return { label: `${m.serverName}: ${m.label}`, icon: MCP_ICON };
  return { label: name, icon: MCP_ICON };
}

const TOOL_META = {
  take_screenshot:   { label: "Screenshot",      icon: "M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" },
  get_page_content:  { label: "Read page",       icon: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8" },
  navigate:          { label: "Navigate",         icon: "M5 12h14 M12 5l7 7-7 7" },
  click_element:     { label: "Click",            icon: "M4 4l7.07 17 2.51-7.39L21 11.07z" },
  type_text:         { label: "Type",             icon: "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7 M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" },
  inspect_element:   { label: "Inspect element",  icon: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" },
  get_resource_urls: { label: "Resource URLs",    icon: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" },
  execute_script:    { label: "Execute script",   icon: "M8 6l6 6-6 6" },
};

// result=null → pending; result.restored → history; otherwise success/error
function appendToolIndicator(name, input, result) {
  const isPending  = result === null;
  const isRestored = result?.restored;
  const isError    = !isPending && !isRestored && result?.error;

  const meta = getToolMeta(name);

  let detail = "";
  if (name === "navigate" && input?.url) detail = ` → ${input.url}`;
  else if (name === "click_element" && input?.selector) detail = ` → ${input.selector}`;
  else if (name === "type_text" && input?.selector) detail = ` → ${input.selector}`;
  else if (name === "get_page_content" && result?.content?.title) detail = `: ${result.content.title}`;

  const details = document.createElement("details");
  details.className = "tool-call" + (isPending ? "" : isError ? " tool-error" : " tool-success");

  const summary = document.createElement("summary");
  const chevron = `<svg class="tool-call-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>`;
  summary.innerHTML = `<span class="tool-dot"></span><span class="tool-call-label">${escapeHtml(meta.label + detail)}</span>${chevron}`;
  details.appendChild(summary);

  if (!isPending && !isRestored) {
    const body = document.createElement("div");
    body.className = "tool-call-body";
    if (name === "take_screenshot" && result?.dataUrl) {
      const img = document.createElement("img");
      img.className = "screenshot-thumb";
      img.src = result.dataUrl;
      img.alt = "Screenshot";
      img.addEventListener("click", () => {
        const win = window.open();
        win.document.write(`<img src="${img.src}" style="max-width:100%">`);
      });
      body.appendChild(img);
    } else if (isError) {
      body.textContent = result.error;
    } else if (result) {
      body.textContent = JSON.stringify(result, null, 2);
    }
    details.appendChild(body);
  }

  messagesEl.appendChild(details);
  scrollToBottom();
  return details;
}

function resolveToolIndicator(el, state /* "success" | "error" | "denied" */, result) {
  el.classList.remove("tool-success", "tool-error", "tool-denied");
  el.classList.add(`tool-${state}`);

  if (result && !result.restored) {
    const body = document.createElement("div");
    body.className = "tool-call-body";
    if (state === "error" || state === "denied") {
      body.textContent = result?.error || "Denied.";
    } else if (result) {
      body.textContent = JSON.stringify(result, null, 2);
    }
    el.appendChild(body);
  }
}

function appendErrorMessage(text) {
  const el = createMessageEl("error", "Error");
  el.querySelector(".message-bubble").textContent = text;
  messagesEl.appendChild(el);
  scrollToBottom();
}

function appendTokenIndicator(usage) {
  const el = document.createElement("div");
  el.className = "token-indicator";
  el.textContent = `↑ ${usage.input.toLocaleString()} · ↓ ${usage.output.toLocaleString()}`;
  messagesEl.appendChild(el);
  // No scroll — it's a trailing line under the message, already visible
}

function appendSkillLoadedIndicator(skill) {
  const el = document.createElement("div");
  el.className = "skill-loaded-indicator";
  el.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
    </svg>
    Skill loaded: <strong>${escapeHtml(skill.name)}</strong>
    <span class="skill-loaded-reason">matched <code>${escapeHtml(skill.urlPattern)}</code></span>
  `;
  messagesEl.appendChild(el);
  scrollToBottom();
}

function createMessageEl(role, label) {
  const el = document.createElement("div");
  el.className = `message ${role}`;

  const roleEl = document.createElement("div");
  roleEl.className = "message-role";
  roleEl.textContent = label;

  const bubble = document.createElement("div");
  bubble.className = "message-bubble";

  el.appendChild(roleEl);
  el.appendChild(bubble);
  return el;
}

function setStopMode(active) {
  sendBtn.classList.toggle("hidden", active);
  stopBtn.classList.toggle("hidden", !active);
}

function showToolStatus(text) {
  toolsStatusText.textContent = text;
  toolsStatus.classList.remove("hidden");
}

function hideToolStatus() {
  toolsStatus.classList.add("hidden");
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function inlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

function renderMarkdown(raw) {
  const lines = raw.split("\n");
  const parts = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.startsWith("```")) {
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      parts.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      i++;
      continue;
    }

    // Heading
    const hm = line.match(/^(#{1,6})\s+(.+)/);
    if (hm) {
      parts.push(`<h${hm[1].length}>${inlineMarkdown(hm[2])}</h${hm[1].length}>`);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}\s*$/.test(line)) {
      parts.push("<hr>");
      i++;
      continue;
    }

    // Unordered list — collect consecutive items
    if (/^[-*+]\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*+]\s/.test(lines[i])) {
        items.push(`<li>${inlineMarkdown(lines[i].replace(/^[-*+]\s+/, ""))}</li>`);
        i++;
      }
      parts.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    // Ordered list — collect consecutive items
    if (/^\d+\.\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(`<li>${inlineMarkdown(lines[i].replace(/^\d+\.\s+/, ""))}</li>`);
        i++;
      }
      parts.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    // Empty line — paragraph break (skip)
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph — collect consecutive plain lines
    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("#") &&
      !lines[i].startsWith("```") &&
      !/^[-*+]\s/.test(lines[i]) &&
      !/^\d+\.\s/.test(lines[i]) &&
      !/^[-*_]{3,}\s*$/.test(lines[i])
    ) {
      paraLines.push(inlineMarkdown(lines[i]));
      i++;
    }
    if (paraLines.length) parts.push(`<p>${paraLines.join("<br>")}</p>`);
  }

  return parts.join("\n");
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function autoResizeTextarea() {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + "px";
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

init();
