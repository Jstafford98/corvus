"use strict";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let currentSection = null;
let selectedItem = null;   // id of selected list item
let allSkills = [];
let convIndex = [];
let editingSkillId = null; // null = new skill

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

const activityBtns  = document.querySelectorAll(".activity-btn");
const sectionTitle  = document.getElementById("section-title");
const sectionAction = document.getElementById("section-action");
const sectionList   = document.getElementById("section-list");
const contentEmpty  = document.getElementById("content-empty");
const contentBody   = document.getElementById("content-body");

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function init() {
  activityBtns.forEach((btn) => {
    btn.addEventListener("click", () => navigate(btn.dataset.section));
  });

  const hash = location.hash.slice(1) || "chats";
  await navigate(hash);
}

async function navigate(section) {
  currentSection = section;
  selectedItem = null;

  activityBtns.forEach((b) => b.classList.toggle("active", b.dataset.section === section));

  showEmpty();
  sectionAction.classList.add("hidden");
  sectionAction.onclick = null;

  if (section === "chats")     await loadChatsSection();
  if (section === "skills")    await loadSkillsSection();
  if (section === "providers") await loadProvidersSection();
  if (section === "mcp")       await loadMcpServersSection();
  if (section === "tools")     await loadToolsSection();
  if (section === "usage")     await loadUsageSection();

  history.replaceState(null, "", `#${section}`);
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function showEmpty(msg = "Select an item from the panel.") {
  contentEmpty.querySelector("p").textContent = msg;
  contentEmpty.classList.remove("hidden");
  contentBody.classList.add("hidden");
  contentBody.innerHTML = "";
}

function showContent(el) {
  contentEmpty.classList.add("hidden");
  contentBody.classList.remove("hidden");
  contentBody.innerHTML = "";
  contentBody.appendChild(el);
}

// ---------------------------------------------------------------------------
// Chats section
// ---------------------------------------------------------------------------

async function loadChatsSection() {
  sectionTitle.textContent = "Chats";
  const stored = await browser.storage.local.get("convIndex");
  convIndex = stored.convIndex || [];
  renderChatList();
}

function renderChatList() {
  sectionList.innerHTML = "";

  if (!convIndex.length) {
    const el = document.createElement("div");
    el.className = "list-empty";
    el.textContent = "No saved conversations yet. Start chatting in the sidebar.";
    sectionList.appendChild(el);
    showEmpty("No conversations yet.");
    return;
  }

  for (const entry of convIndex) {
    const row = document.createElement("div");
    row.className = "list-item" + (entry.id === selectedItem ? " active" : "");
    row.innerHTML = `
      <div class="list-item-title">${escapeHtml(entry.title)}</div>
      <div class="list-item-meta">${formatRelativeTime(entry.ts)}</div>
    `;
    row.addEventListener("click", () => openChat(entry.id));
    sectionList.appendChild(row);
  }
}

async function openChat(id) {
  selectedItem = id;
  renderChatList();

  const stored = await browser.storage.local.get(id);
  const history = stored[id];
  const entry = convIndex.find((c) => c.id === id);
  if (!history || !entry) return;

  const wrap = document.createElement("div");
  wrap.id = "chat-view";

  // Header
  const header = document.createElement("div");
  header.id = "chat-view-header";
  header.innerHTML = `
    <div>
      <div id="chat-view-title">${escapeHtml(entry.title)}</div>
      <div id="chat-view-time">${new Date(entry.ts).toLocaleString()}</div>
    </div>
    <button id="chat-delete-btn" class="btn btn-danger">Delete</button>
  `;
  const chatDeleteBtn = header.querySelector("#chat-delete-btn");
  let deleteConfirming = false;
  chatDeleteBtn.addEventListener("click", async () => {
    if (!deleteConfirming) {
      deleteConfirming = true;
      chatDeleteBtn.textContent = "Confirm delete?";
      chatDeleteBtn.style.borderColor = "var(--error)";
      chatDeleteBtn.style.color = "var(--error)";
      setTimeout(() => {
        deleteConfirming = false;
        chatDeleteBtn.textContent = "Delete";
        chatDeleteBtn.style.borderColor = "";
        chatDeleteBtn.style.color = "";
      }, 3000);
    } else {
      await deleteChat(id);
    }
  });
  wrap.appendChild(header);

  // Messages
  const msgs = document.createElement("div");
  msgs.id = "chat-messages";

  for (const msg of history) {
    if (msg.role === "user") {
      const content = Array.isArray(msg.content) ? msg.content : [{ type: "text", text: msg.content }];
      const toolResults = content.filter((b) => b.type === "tool_result");
      if (toolResults.length) continue; // skip internal tool result messages

      const textBlocks = content.filter((b) => b.type === "text" && !b.text.startsWith("[Page content]"));
      const text = textBlocks.map((b) => b.text).join("\n").trim();
      if (!text) continue;

      const el = document.createElement("div");
      el.className = "chat-msg user";
      el.innerHTML = `<div class="chat-msg-role">You</div><div class="chat-msg-bubble">${escapeHtml(text)}</div>`;
      msgs.appendChild(el);

    } else if (msg.role === "assistant") {
      const content = Array.isArray(msg.content) ? msg.content : [{ type: "text", text: msg.content }];
      const textBlocks = content.filter((b) => b.type === "text");
      const toolUse = content.filter((b) => b.type === "tool_use");

      if (textBlocks.length) {
        const el = document.createElement("div");
        el.className = "chat-msg assistant";
        el.innerHTML = `<div class="chat-msg-role">Assistant</div><div class="chat-msg-bubble chat-msg-bubble-md">${renderMarkdown(textBlocks.map((b) => b.text).join("\n"))}</div>`;
        msgs.appendChild(el);

        if (msg._usage) {
          const tok = document.createElement("div");
          tok.className = "chat-msg-tokens";
          tok.textContent = `↑ ${msg._usage.input.toLocaleString()} · ↓ ${msg._usage.output.toLocaleString()}`;
          msgs.appendChild(tok);
        }
      }

      for (const block of toolUse) {
        const el = document.createElement("div");
        el.className = "chat-msg assistant";
        const pill = document.createElement("div");
        pill.className = "chat-msg-tool";
        const keyArg = block.input?.url || block.input?.selector || block.input?.code?.slice(0, 60) || "";
        pill.textContent = `${block.name}${keyArg ? ` — ${keyArg}` : ""}`;
        el.appendChild(pill);
        msgs.appendChild(el);
      }
    }
  }

  wrap.appendChild(msgs);
  showContent(wrap);
}

async function deleteChat(id) {
  convIndex = convIndex.filter((c) => c.id !== id);
  await browser.storage.local.set({ convIndex });
  await browser.storage.local.remove(id);
  selectedItem = null;
  renderChatList();
  showEmpty("Conversation deleted.");
}

// ---------------------------------------------------------------------------
// Skills section
// ---------------------------------------------------------------------------

async function loadSkillsSection() {
  sectionTitle.textContent = "Skills";
  sectionAction.textContent = "+";
  sectionAction.title = "New skill";
  sectionAction.classList.remove("hidden");
  sectionAction.onclick = () => openSkillEditor(null);

  const stored = await browser.storage.local.get("skills");
  allSkills = stored.skills || [];
  renderSkillList();
}

function renderSkillList() {
  sectionList.innerHTML = "";

  if (!allSkills.length) {
    const el = document.createElement("div");
    el.className = "list-empty";
    el.innerHTML = 'No skills yet.<br>Click <strong>+</strong> to create one.';
    sectionList.appendChild(el);
    showEmpty("Create a skill to get started.");
    return;
  }

  for (const skill of allSkills) {
    const row = document.createElement("div");
    row.className = "list-item" + (skill.id === selectedItem ? " active" : "");
    row.innerHTML = `
      <div class="list-item-title">${escapeHtml(skill.name || "Untitled")}</div>
      <div class="list-item-meta">${escapeHtml(skill.urlPattern || skill.description || "")}</div>
    `;
    row.addEventListener("click", () => openSkillEditor(skill.id));
    sectionList.appendChild(row);
  }
}

function openSkillEditor(id) {
  selectedItem = id;
  editingSkillId = id;
  renderSkillList();

  const skill = id ? allSkills.find((s) => s.id === id) : null;

  const wrap = document.createElement("div");
  wrap.id = "skill-editor";

  // Header
  const header = document.createElement("div");
  header.id = "skill-editor-header";
  header.innerHTML = `
    <div id="skill-editor-title">${skill ? escapeHtml(skill.name) : "New Skill"}</div>
    <div id="skill-editor-actions">
      <span id="skill-save-status"></span>
      ${skill ? '<button class="btn btn-danger" id="skill-delete-btn">Delete</button>' : ""}
      <button class="btn" id="skill-save-btn">Save</button>
    </div>
  `;
  wrap.appendChild(header);

  // Form
  const form = document.createElement("form");
  form.id = "skill-form";
  form.innerHTML = `
    <div class="field">
      <label>Name</label>
      <input id="skill-name" type="text" value="${escapeHtml(skill?.name ?? "")}" placeholder="YouTube Navigation" maxlength="80" />
    </div>
    <div class="field">
      <label>Description <span style="font-weight:400;text-transform:none">(shown in sidebar picker)</span></label>
      <input id="skill-desc" type="text" value="${escapeHtml(skill?.description ?? "")}" placeholder="How to find and play videos on YouTube" maxlength="160" />
    </div>
    <div class="field">
      <label>URL pattern <span style="font-weight:400;text-transform:none">(auto-activate on matching pages)</span></label>
      <input id="skill-pattern" type="text" value="${escapeHtml(skill?.urlPattern ?? "")}" placeholder="*youtube.com*" maxlength="200" />
      <span class="hint">Use <code>*</code> as a wildcard. Leave blank for manual activation only.</span>
    </div>
    <div class="field-grow">
      <label>Content</label>
      <textarea id="skill-content-textarea" placeholder="Write what the AI should know about this site — selectors, common tasks, gotchas…">${escapeHtml(skill?.content ?? "")}</textarea>
    </div>
  `;
  wrap.appendChild(form);

  showContent(wrap);

  const saveBtn   = header.querySelector("#skill-save-btn");
  const deleteBtn = header.querySelector("#skill-delete-btn");
  const status    = header.querySelector("#skill-save-status");

  saveBtn.addEventListener("click", async () => {
    const name    = form.querySelector("#skill-name").value.trim();
    const content = form.querySelector("#skill-content-textarea").value.trim();
    if (!name)    { flash(status, "Name required", "err"); return; }
    if (!content) { flash(status, "Content required", "err"); return; }

    if (editingSkillId) {
      const idx = allSkills.findIndex((s) => s.id === editingSkillId);
      if (idx >= 0) allSkills[idx] = { ...allSkills[idx], name, description: form.querySelector("#skill-desc").value.trim(), urlPattern: form.querySelector("#skill-pattern").value.trim(), content, updatedAt: Date.now() };
    } else {
      const newSkill = { id: `skill_${Date.now()}`, name, description: form.querySelector("#skill-desc").value.trim(), urlPattern: form.querySelector("#skill-pattern").value.trim(), content, createdAt: Date.now(), updatedAt: Date.now() };
      allSkills.unshift(newSkill);
      editingSkillId = newSkill.id;
      selectedItem = newSkill.id;
    }

    await browser.storage.local.set({ skills: allSkills });
    header.querySelector("#skill-editor-title").textContent = name;
    renderSkillList();
    flash(status, "Saved", "ok");
  });

  if (deleteBtn) {
    let skillDeleteConfirming = false;
    deleteBtn.addEventListener("click", async () => {
      if (!skillDeleteConfirming) {
        skillDeleteConfirming = true;
        deleteBtn.textContent = "Confirm delete?";
        setTimeout(() => {
          skillDeleteConfirming = false;
          deleteBtn.textContent = "Delete";
        }, 3000);
        return;
      }
      allSkills = allSkills.filter((s) => s.id !== editingSkillId);
      await browser.storage.local.set({ skills: allSkills });
      selectedItem = null;
      editingSkillId = null;
      renderSkillList();
      showEmpty("Skill deleted.");
    });
  }

  form.querySelector("#skill-name").focus();
}

function flash(el, msg, cls) {
  el.textContent = msg;
  el.className = cls;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.textContent = ""; el.className = ""; }, 3000);
}

// ---------------------------------------------------------------------------
// Providers section
// ---------------------------------------------------------------------------

async function loadProvidersSection(initialItem = "provider") {
  sectionTitle.textContent = "Providers";
  sectionList.innerHTML = "";

  const items = [
    { id: "provider",       title: "AI Provider",    meta: "API key & model" },
    { id: "system-prompt",  title: "System Prompt",  meta: "Customize assistant behavior" },
  ];

  function selectItem(id) {
    sectionList.querySelectorAll(".list-item").forEach((el) =>
      el.classList.toggle("active", el.dataset.id === id)
    );
    if (id === "provider") showProviderForm();
    if (id === "system-prompt") showSystemPromptForm();
  }

  for (const item of items) {
    const row = document.createElement("div");
    row.className = "list-item";
    row.dataset.id = item.id;
    row.innerHTML = `<div class="list-item-title">${item.title}</div><div class="list-item-meta">${item.meta}</div>`;
    row.addEventListener("click", () => selectItem(item.id));
    sectionList.appendChild(row);
  }

  selectItem(initialItem);
}

async function showProviderForm() {
  const stored = await browser.storage.local.get(["provider", "apiKey", "baseUrl", "model", "largeResultThreshold"]);

  const wrap = document.createElement("div");
  wrap.id = "provider-form";
  wrap.innerHTML = `
    <h2>AI Provider</h2>

    <div class="form-group">
      <label>Provider</label>
      <select id="prov-provider">
        <option value="anthropic">Anthropic (Claude)</option>
        <option value="openai">OpenAI</option>
        <option value="openai-compatible">OpenAI-compatible (custom URL)</option>
      </select>
    </div>

    <div class="form-group" id="prov-baseurl-group">
      <label>Base URL</label>
      <input id="prov-baseurl" type="url" placeholder="http://localhost:11434" />
      <span class="hint">For Ollama, LM Studio, or any OpenAI-compatible endpoint.</span>
    </div>

    <div class="form-group">
      <label>API Key</label>
      <input id="prov-apikey" type="password" placeholder="sk-…" autocomplete="off" />
      <span class="hint">Stored locally. Never sent anywhere except your chosen provider.</span>
    </div>

    <div class="form-group">
      <label>Default model <button type="button" id="prov-model-refresh" class="refresh-btn" title="Refresh model list">↻</button></label>
      <select id="prov-model">
        <option value="">— enter API key to load models —</option>
      </select>
      <span class="hint" id="prov-model-hint"></span>
    </div>

    <hr class="form-divider" />

    <div class="form-group">
      <label>Large result threshold <span class="label-note">(characters)</span></label>
      <input id="prov-threshold" type="number" min="1000" max="200000" step="1000" value="${stored.largeResultThreshold || 12000}" />
      <span class="hint">Tool results larger than this are offloaded from context and summarised. Default: 12,000.</span>
    </div>

    <div class="form-actions">
      <button class="btn" id="prov-save">Save</button>
      <button class="btn btn-secondary" id="prov-test">Test connection</button>
      <span id="provider-status"></span>
    </div>
  `;
  showContent(wrap);

  const provEl     = wrap.querySelector("#prov-provider");
  const baseUrlGrp = wrap.querySelector("#prov-baseurl-group");
  const baseUrlEl  = wrap.querySelector("#prov-baseurl");
  const apiKeyEl   = wrap.querySelector("#prov-apikey");
  const modelEl    = wrap.querySelector("#prov-model");
  const modelHint  = wrap.querySelector("#prov-model-hint");
  const refreshBtn   = wrap.querySelector("#prov-model-refresh");
  const thresholdEl  = wrap.querySelector("#prov-threshold");
  const saveBtn      = wrap.querySelector("#prov-save");
  const testBtn      = wrap.querySelector("#prov-test");
  const statusEl     = wrap.querySelector("#provider-status");

  // Populate basic fields
  provEl.value    = stored.provider || "anthropic";
  baseUrlEl.value = stored.baseUrl  || "";
  apiKeyEl.value  = stored.apiKey   || "";

  async function loadModelSelect(forceRefresh = false) {
    const p   = provEl.value;
    const key = apiKeyEl.value.trim();
    const url = baseUrlEl.value.trim();
    if (!key) {
      modelEl.innerHTML = '<option value="">— enter API key to load models —</option>';
      modelHint.textContent = "";
      return;
    }
    if (forceRefresh) {
      const { modelsCache = {} } = await browser.storage.local.get("modelsCache");
      delete modelsCache[`${p}__${url}`];
      await browser.storage.local.set({ modelsCache });
    }
    modelEl.disabled = true;
    modelHint.textContent = "Loading…";
    const models = await fetchProviderModels(p, key, url);
    modelEl.disabled = false;
    if (!models.length) {
      modelHint.textContent = "Could not load models — check your API key.";
      return;
    }
    modelHint.textContent = `${models.length} models available`;
    const current = stored.model || "";
    modelEl.innerHTML = "";
    for (const m of models) {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.label;
      modelEl.appendChild(opt);
    }
    if (current && models.some((m) => m.id === current)) {
      modelEl.value = current;
    }
  }

  function updateProviderUI() {
    baseUrlGrp.classList.toggle("hidden", provEl.value !== "openai-compatible");
  }

  provEl.addEventListener("change", () => { updateProviderUI(); loadModelSelect(); });
  apiKeyEl.addEventListener("blur", () => loadModelSelect());
  refreshBtn.addEventListener("click", () => loadModelSelect(true));

  updateProviderUI();
  loadModelSelect();

  saveBtn.addEventListener("click", async () => {
    const threshold = parseInt(thresholdEl.value, 10);
    await browser.storage.local.set({
      provider:             provEl.value,
      apiKey:               apiKeyEl.value.trim(),
      baseUrl:              baseUrlEl.value.trim(),
      model:                modelEl.value,
      largeResultThreshold: threshold > 0 ? threshold : 12000,
    });
    stored.model = modelEl.value;
    flashStatus(statusEl, "Saved.", "ok");
  });

  testBtn.addEventListener("click", async () => {
    testBtn.disabled = true;
    statusEl.textContent = "Testing…";
    statusEl.className = "";
    try {
      if (provEl.value === "anthropic") {
        await testAnthropic(apiKeyEl.value.trim(), modelEl.value);
      } else {
        await testOpenAI(apiKeyEl.value.trim(), baseUrlEl.value.trim(), modelEl.value);
      }
      flashStatus(statusEl, "Connection successful.", "ok");
    } catch (err) {
      flashStatus(statusEl, `Error: ${err.message}`, "err");
    } finally {
      testBtn.disabled = false;
    }
  });
}

async function showSystemPromptForm() {
  const { systemPromptBase } = await browser.storage.local.get("systemPromptBase");

  const wrap = document.createElement("div");
  wrap.id = "system-prompt-form";
  wrap.innerHTML = `
    <h2>System Prompt</h2>
    <div class="form-group">
      <label>Base instructions</label>
      <textarea id="sys-prompt-text" rows="12" spellcheck="true" style="resize:vertical;font-family:var(--mono);font-size:12px;">${escapeHtml(systemPromptBase || DEFAULT_SYSTEM_PROMPT)}</textarea>
      <span class="hint">This is the core instruction sent to the AI on every message. Skills are appended automatically after this.</span>
    </div>
    <div class="form-actions">
      <button class="btn" id="sys-prompt-save">Save</button>
      <button class="btn btn-secondary" id="sys-prompt-reset">Reset to default</button>
      <span id="sys-prompt-status"></span>
    </div>
  `;
  showContent(wrap);

  const textEl  = wrap.querySelector("#sys-prompt-text");
  const saveBtn = wrap.querySelector("#sys-prompt-save");
  const resetBtn = wrap.querySelector("#sys-prompt-reset");
  const statusEl = wrap.querySelector("#sys-prompt-status");

  saveBtn.addEventListener("click", async () => {
    await browser.storage.local.set({ systemPromptBase: textEl.value.trim() });
    flashStatus(statusEl, "Saved.", "ok");
  });

  resetBtn.addEventListener("click", async () => {
    textEl.value = DEFAULT_SYSTEM_PROMPT;
    await browser.storage.local.remove("systemPromptBase");
    flashStatus(statusEl, "Reset to default.", "ok");
  });
}

// ---------------------------------------------------------------------------
// MCP Servers section
// ---------------------------------------------------------------------------

async function testMcpConnection(url) {
  let sessionId = null;

  async function post(method, params, id) {
    const body = { jsonrpc: "2.0", method, params: params ?? {} };
    if (id != null) body.id = id;
    const headers = { "content-type": "application/json", "accept": "application/json, text/event-stream" };
    if (sessionId) headers["mcp-session-id"] = sessionId;
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const returned = res.headers.get("mcp-session-id");
    if (returned) sessionId = returned;
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("text/event-stream")) {
      const text = await res.text();
      for (const line of text.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        try {
          const msg = JSON.parse(line.slice(6));
          if (msg.id == null || msg.id === id) {
            if (msg.error) throw new Error(msg.error.message || "MCP error");
            return msg;
          }
        } catch (e) { if (e.message) throw e; }
      }
      throw new Error("No response in SSE stream");
    }
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || "MCP error");
    return data;
  }

  await post("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "Corvus", version: "1.0" } }, 1);
  post("notifications/initialized", {}, null).catch(() => {});
  const resp = await post("tools/list", {}, 2);
  return resp.result?.tools || [];
}

function renderMcpToolList(container, tools) {
  if (!tools.length) {
    container.innerHTML = `<p class="mcp-empty">No tools exposed by this server.</p>`;
    return;
  }
  container.innerHTML = tools.map((t) => `
    <div class="mcp-tool-row">
      <code class="mcp-tool-name">${escapeHtml(t.name)}</code>
      <span class="mcp-tool-desc">${escapeHtml(t.description || "")}</span>
    </div>
  `).join("");
}

async function loadMcpServersSection() {
  sectionTitle.textContent = "MCP Servers";
  sectionList.innerHTML = "";
  showEmpty("Select a server to view details.");

  sectionAction.textContent = "Add";
  sectionAction.classList.remove("hidden");
  sectionAction.onclick = () => {
    sectionList.querySelectorAll(".list-item").forEach((el) => el.classList.remove("active"));
    showAddMcpServerForm();
  };

  const { mcpServers = [] } = await browser.storage.local.get("mcpServers");

  function renderList() {
    sectionList.innerHTML = "";
    if (!mcpServers.length) {
      showEmpty("No MCP servers configured. Click Add to connect one.");
      return;
    }
    for (const server of mcpServers) {
      const enabled = server.enabled !== false;
      const row = document.createElement("div");
      row.className = "list-item";
      row.dataset.id = server.id;
      row.innerHTML = `
        <div class="list-item-title" style="display:flex;align-items:center;gap:6px;">
          <span style="width:6px;height:6px;border-radius:50%;flex-shrink:0;background:${enabled ? "var(--success)" : "var(--border)"};"></span>
          ${escapeHtml(server.name)}
        </div>
        <div class="list-item-meta">${escapeHtml(server.url)}</div>
      `;
      row.addEventListener("click", () => {
        sectionList.querySelectorAll(".list-item").forEach((el) =>
          el.classList.toggle("active", el.dataset.id === server.id)
        );
        showMcpServerDetail(server);
      });
      sectionList.appendChild(row);
    }
  }

  async function showAddMcpServerForm() {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <h2>Add MCP Server</h2>
      <div class="form-group">
        <label>Name</label>
        <input id="mcp-name" type="text" placeholder="YouTube Tools" />
      </div>
      <div class="form-group">
        <label>URL</label>
        <input id="mcp-url" type="url" placeholder="http://localhost:3000/mcp" />
        <span class="hint">Streamable HTTP transport — the extension POSTs JSON-RPC 2.0 to this endpoint.</span>
      </div>
      <div class="form-actions">
        <button class="btn" id="mcp-add-save">Add Server</button>
        <button class="btn btn-secondary" id="mcp-add-test">Test connection</button>
        <span id="mcp-add-status"></span>
      </div>
      <div id="mcp-add-tools" class="mcp-tool-list hidden"></div>
    `;
    showContent(wrap);

    const nameEl    = wrap.querySelector("#mcp-name");
    const urlEl     = wrap.querySelector("#mcp-url");
    const saveBtn   = wrap.querySelector("#mcp-add-save");
    const testBtn   = wrap.querySelector("#mcp-add-test");
    const statusEl  = wrap.querySelector("#mcp-add-status");
    const toolsEl   = wrap.querySelector("#mcp-add-tools");

    testBtn.addEventListener("click", async () => {
      const url = urlEl.value.trim();
      if (!url) { flashStatus(statusEl, "Enter a URL first.", "err"); return; }
      testBtn.disabled = true;
      flashStatus(statusEl, "Connecting…", "");
      toolsEl.classList.add("hidden");
      try {
        const tools = await testMcpConnection(url);
        flashStatus(statusEl, `${tools.length} tool${tools.length !== 1 ? "s" : ""} found.`, "ok");
        renderMcpToolList(toolsEl, tools);
        toolsEl.classList.remove("hidden");
      } catch (err) {
        flashStatus(statusEl, `Error: ${err.message}`, "err");
      } finally {
        testBtn.disabled = false;
      }
    });

    saveBtn.addEventListener("click", async () => {
      const name = nameEl.value.trim();
      const url  = urlEl.value.trim();
      if (!name || !url) { flashStatus(statusEl, "Name and URL are required.", "err"); return; }
      const { mcpServers: existing = [] } = await browser.storage.local.get("mcpServers");
      const newServer = { id: crypto.randomUUID(), name, url, enabled: true };
      await browser.storage.local.set({ mcpServers: [...existing, newServer] });
      mcpServers.push(newServer);
      renderList();
      flashStatus(statusEl, "Server added.", "ok");
    });
  }

  async function showMcpServerDetail(server) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <h2>${escapeHtml(server.name)}</h2>
      <div class="form-group">
        <label>Name</label>
        <input id="sd-name" type="text" value="${escapeHtml(server.name)}" />
      </div>
      <div class="form-group">
        <label>URL</label>
        <input id="sd-url" type="url" value="${escapeHtml(server.url)}" />
      </div>
      <div class="form-group" style="flex-direction:row;align-items:center;gap:10px;">
        <label style="margin:0;flex:0 0 auto;">Enabled</label>
        <label class="toggle-switch">
          <input type="checkbox" id="sd-enabled" ${server.enabled !== false ? "checked" : ""} />
          <span class="toggle-track"></span>
        </label>
      </div>
      <div class="form-actions">
        <button class="btn" id="sd-save">Save</button>
        <button class="btn btn-secondary" id="sd-refresh">Refresh tools</button>
        <button class="btn btn-danger" id="sd-delete">Remove</button>
        <span id="sd-status"></span>
      </div>
      <div class="mcp-tool-list-header">Tools</div>
      <div id="sd-tools" class="mcp-tool-list"><p class="mcp-empty">Loading…</p></div>
    `;
    showContent(wrap);

    const nameEl    = wrap.querySelector("#sd-name");
    const urlEl     = wrap.querySelector("#sd-url");
    const enabledEl = wrap.querySelector("#sd-enabled");
    const saveBtn   = wrap.querySelector("#sd-save");
    const refreshBtn = wrap.querySelector("#sd-refresh");
    const deleteBtn = wrap.querySelector("#sd-delete");
    const statusEl  = wrap.querySelector("#sd-status");
    const toolsEl   = wrap.querySelector("#sd-tools");

    async function loadTools() {
      try {
        const tools = await testMcpConnection(urlEl.value.trim() || server.url);
        renderMcpToolList(toolsEl, tools);
      } catch (err) {
        toolsEl.innerHTML = `<p class="mcp-empty" style="color:var(--error);">Could not connect: ${escapeHtml(err.message)}</p>`;
      }
    }

    loadTools();

    saveBtn.addEventListener("click", async () => {
      const { mcpServers: latest = [] } = await browser.storage.local.get("mcpServers");
      const idx = latest.findIndex((s) => s.id === server.id);
      if (idx === -1) return;
      latest[idx] = { ...latest[idx], name: nameEl.value.trim(), url: urlEl.value.trim(), enabled: enabledEl.checked };
      await browser.storage.local.set({ mcpServers: latest });
      Object.assign(mcpServers.find((s) => s.id === server.id) ?? {}, latest[idx]);
      renderList();
      sectionList.querySelectorAll(".list-item").forEach((el) =>
        el.classList.toggle("active", el.dataset.id === server.id)
      );
      flashStatus(statusEl, "Saved.", "ok");
    });

    refreshBtn.addEventListener("click", () => {
      toolsEl.innerHTML = `<p class="mcp-empty">Loading…</p>`;
      loadTools();
    });

    deleteBtn.addEventListener("click", async () => {
      if (!confirm(`Remove "${server.name}"?`)) return;
      const { mcpServers: latest = [] } = await browser.storage.local.get("mcpServers");
      await browser.storage.local.set({ mcpServers: latest.filter((s) => s.id !== server.id) });
      const idx = mcpServers.findIndex((s) => s.id === server.id);
      if (idx !== -1) mcpServers.splice(idx, 1);
      renderList();
      showEmpty("Server removed.");
    });
  }

  renderList();
}

// ---------------------------------------------------------------------------
// Tools section
// ---------------------------------------------------------------------------

const TOOLS_DEFAULTS = [
  { name: "take_screenshot",  label: "Take Screenshot",   description: "Captures a screenshot of the currently visible browser tab and returns it as a base64 PNG. Use this when the user asks what you can see, wants visual confirmation, or needs you to observe the current page state." },
  { name: "get_page_content", label: "Get Page Content",  description: "Returns the page title, URL, headings, links, and a body text excerpt from the active tab. By default truncates body text to 500 chars and returns 30 links — sufficient for navigation and structure. Only set truncate=false if you specifically need the full body text (e.g. reading an article). Prefer skills for site-specific knowledge rather than repeatedly fetching full content." },
  { name: "navigate",         label: "Navigate",          description: "Navigates the active tab to the given URL." },
  { name: "click_element",    label: "Click Element",     description: "Clicks a DOM element matching the given CSS selector on the active tab." },
  { name: "type_text",        label: "Type Text",         description: "Sets the value of an input or textarea on the active tab and fires input/change events." },
  { name: "inspect_element",  label: "Inspect Element",   description: "Returns detailed information about a DOM element: all attributes, src/currentSrc/href, child <source> elements, text tracks, bounding rect, and a snippet of innerHTML/innerText. Use this to find where media is loaded from, inspect video sources, or understand element structure." },
  { name: "get_resource_urls",label: "Get Resource URLs", description: "Returns all network resources loaded by the page via the Performance API, plus all media element sources (video, audio, img). Includes URL, initiator type, duration, and transfer size. Use this to find CDN URLs, media stream origins, or any asset loaded by the page. Optionally filter by keyword." },
  { name: "execute_script",   label: "Execute Script",    description: "Executes arbitrary JavaScript in the active tab's page context and returns the result. Use this for advanced inspection: reading JS variables, checking media state (video.currentSrc, video.readyState), inspecting window objects, or anything not covered by other tools. The result is JSON-serialized." },
  { name: "list_mcp_servers", label: "List MCP Servers",  description: "Returns all configured MCP servers with their connection status, tool count, and any connection error. Use this to check which external tool servers are available." },
  { name: "list_mcp_tools",   label: "List MCP Tools",    description: "Returns every tool exposed by connected MCP servers — their exact call names, descriptions, and input schemas. The name field in each result is directly callable as a tool — no special syntax needed." },
];

async function loadToolsSection() {
  sectionTitle.textContent = "Tools";
  sectionList.innerHTML = "";
  showEmpty("Select a tool to view or edit it.");

  let { toolsConfig = {} } = await browser.storage.local.get("toolsConfig");

  function selectTool(name) {
    sectionList.querySelectorAll(".list-item").forEach((el) =>
      el.classList.toggle("active", el.dataset.id === name)
    );
    showToolDetail(name, toolsConfig);
  }

  function renderList() {
    sectionList.innerHTML = "";
    for (const tool of TOOLS_DEFAULTS) {
      const cfg = toolsConfig[tool.name] || {};
      const enabled = cfg.enabled !== false;
      const row = document.createElement("div");
      row.className = "list-item";
      row.dataset.id = tool.name;
      row.innerHTML = `
        <div class="list-item-title" style="display:flex;align-items:center;gap:6px;">
          <span class="tool-status-dot" style="flex-shrink:0;width:6px;height:6px;border-radius:50%;background:${enabled ? "var(--success)" : "var(--border)"};"></span>
          ${tool.label}
        </div>
        <div class="list-item-meta">${tool.name}</div>
      `;
      row.addEventListener("click", () => selectTool(tool.name));
      sectionList.appendChild(row);
    }
  }

  async function showToolDetail(name, cfg) {
    const tool = TOOLS_DEFAULTS.find((t) => t.name === name);
    const toolCfg = cfg[name] || {};
    const enabled = toolCfg.enabled !== false;
    const currentDesc = toolCfg.description || tool.description;

    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <h2>${tool.label}</h2>
      <p style="font-family:var(--mono);font-size:11px;color:var(--text-muted);margin:0 0 16px;">${tool.name}</p>

      <div class="form-group" style="flex-direction:row;align-items:center;gap:10px;">
        <label style="margin:0;flex:0 0 auto;">Enabled</label>
        <label class="toggle-switch">
          <input type="checkbox" id="tool-enabled" ${enabled ? "checked" : ""} />
          <span class="toggle-track"></span>
        </label>
        <span id="tool-enabled-label" style="color:var(--text-muted);font-size:12px;">${enabled ? "Active" : "Disabled — AI cannot use this tool"}</span>
      </div>

      <div class="form-group">
        <label>Description <span class="label-note">(sent to the AI)</span></label>
        <textarea id="tool-desc" rows="6" spellcheck="true" style="resize:vertical;font-size:13px;">${escapeHtml(currentDesc)}</textarea>
        <span class="hint">Controls how the AI decides when and how to use this tool.</span>
      </div>

      <div class="form-actions">
        <button class="btn" id="tool-save">Save</button>
        <button class="btn btn-secondary" id="tool-reset">Reset to default</button>
        <span id="tool-status"></span>
      </div>
    `;
    showContent(wrap);

    const enabledEl  = wrap.querySelector("#tool-enabled");
    const enabledLbl = wrap.querySelector("#tool-enabled-label");
    const descEl     = wrap.querySelector("#tool-desc");
    const saveBtn    = wrap.querySelector("#tool-save");
    const resetBtn   = wrap.querySelector("#tool-reset");
    const statusEl   = wrap.querySelector("#tool-status");

    enabledEl.addEventListener("change", () => {
      enabledLbl.textContent = enabledEl.checked ? "Active" : "Disabled — AI cannot use this tool";
    });

    saveBtn.addEventListener("click", async () => {
      const { toolsConfig: latest = {} } = await browser.storage.local.get("toolsConfig");
      latest[name] = {
        enabled: enabledEl.checked,
        description: descEl.value.trim() || tool.description,
      };
      await browser.storage.local.set({ toolsConfig: latest });
      toolsConfig = latest;
      renderList();
      sectionList.querySelectorAll(".list-item").forEach((el) =>
        el.classList.toggle("active", el.dataset.id === name)
      );
      flashStatus(statusEl, "Saved.", "ok");
    });

    resetBtn.addEventListener("click", async () => {
      const { toolsConfig: latest = {} } = await browser.storage.local.get("toolsConfig");
      delete latest[name];
      await browser.storage.local.set({ toolsConfig: latest });
      toolsConfig = latest;
      descEl.value = tool.description;
      enabledEl.checked = true;
      enabledLbl.textContent = "Active";
      renderList();
      sectionList.querySelectorAll(".list-item").forEach((el) =>
        el.classList.toggle("active", el.dataset.id === name)
      );
      flashStatus(statusEl, "Reset to default.", "ok");
    });
  }

  renderList();
}

async function testAnthropic(apiKey, model) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({ model: model || "claude-haiku-4-5-20251001", max_tokens: 10, messages: [{ role: "user", content: "Hi" }] }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
}

async function testOpenAI(apiKey, baseUrl, model) {
  const url = `${(baseUrl || "https://api.openai.com").replace(/\/$/, "")}/v1/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: model || "gpt-4o-mini", max_tokens: 10, messages: [{ role: "user", content: "Hi" }] }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
}

// ---------------------------------------------------------------------------
// Usage section
// ---------------------------------------------------------------------------

const PROVIDER_NAMES = {
  anthropic:          "Anthropic (Claude)",
  openai:             "OpenAI",
  "openai-compatible": "OpenAI-compatible",
};

async function loadUsageSection() {
  sectionTitle.textContent = "Usage";
  sectionList.innerHTML = `
    <div class="list-item active">
      <div class="list-item-title">Token usage</div>
      <div class="list-item-meta">All-time statistics</div>
    </div>
  `;

  const stored = await browser.storage.local.get("allTimeTokens");
  const stats = stored.allTimeTokens || { input: 0, output: 0, byProvider: {} };
  const totalIn  = stats.input  || 0;
  const totalOut = stats.output || 0;
  const byProvider = stats.byProvider || {};

  const wrap = document.createElement("div");
  wrap.id = "usage-view";

  const header = document.createElement("div");
  header.className = "usage-header";
  header.innerHTML = `<h2>Token usage</h2>`;
  wrap.appendChild(header);

  // Grand total card
  const totalCard = document.createElement("div");
  totalCard.className = "usage-total-card";
  totalCard.innerHTML = `
    <div class="usage-total-label">All-time total</div>
    <div class="usage-total-value">${(totalIn + totalOut).toLocaleString()}</div>
    <div class="usage-total-breakdown">
      <span class="usage-in-badge">↑ ${totalIn.toLocaleString()} input</span>
      <span class="usage-out-badge">↓ ${totalOut.toLocaleString()} output</span>
    </div>
  `;
  wrap.appendChild(totalCard);

  // Per-provider section
  const provTitle = document.createElement("div");
  provTitle.className = "usage-sub-title";
  provTitle.textContent = "By provider";
  wrap.appendChild(provTitle);

  const provGrid = document.createElement("div");
  provGrid.className = "usage-provider-grid";

  const knownProviders = ["anthropic", "openai", "openai-compatible"];
  const allProviders = [...new Set([...knownProviders, ...Object.keys(byProvider)])];

  for (const p of allProviders) {
    const pStats = byProvider[p] || { input: 0, output: 0 };
    const pTotal = pStats.input + pStats.output;
    const card = document.createElement("div");
    card.className = "usage-provider-card" + (pTotal === 0 ? " usage-provider-empty" : "");
    card.innerHTML = `
      <div class="usage-provider-name">${escapeHtml(PROVIDER_NAMES[p] || p)}</div>
      <div class="usage-provider-total">${pTotal.toLocaleString()}</div>
      <div class="usage-provider-breakdown">
        <span class="usage-in-badge">↑ ${pStats.input.toLocaleString()}</span>
        <span class="usage-out-badge">↓ ${pStats.output.toLocaleString()}</span>
      </div>
    `;
    provGrid.appendChild(card);
  }
  wrap.appendChild(provGrid);

  // Reset button
  const actions = document.createElement("div");
  actions.className = "usage-actions";
  const resetBtn = document.createElement("button");
  resetBtn.className = "btn btn-secondary";
  resetBtn.textContent = "Reset all-time stats";
  resetBtn.addEventListener("click", async () => {
    if (!confirm("Reset all token usage statistics? This cannot be undone.")) return;
    await browser.storage.local.set({ allTimeTokens: { input: 0, output: 0, byProvider: {} } });
    await loadUsageSection();
  });
  actions.appendChild(resetBtn);
  wrap.appendChild(actions);

  showContent(wrap);
}

function flashStatus(el, msg, cls) {
  el.textContent = msg;
  el.className = cls;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.textContent = ""; el.className = ""; }, 4000);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

init();
