"use strict";

// Session state — lives in memory, clears on browser restart
let sidebarState = { convId: null };

// MCP server cache: id → { name, url, tools[], error? }
let mcpCache = {};

browser.browserAction.onClicked.addListener(() => {
  browser.sidebarAction.toggle();
});

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_SIDEBAR_STATE")   return Promise.resolve(sidebarState);
  if (message.type === "SET_SIDEBAR_STATE") {
    Object.assign(sidebarState, message.state);
    return Promise.resolve({ ok: true });
  }
  if (message.type === "TAKE_SCREENSHOT")     return handleScreenshot(message);
  if (message.type === "GET_PAGE_CONTENT")    return handleGetPageContent(message);
  if (message.type === "NAVIGATE")            return handleNavigate(message);
  if (message.type === "CLICK_ELEMENT")       return handleClickElement(message);
  if (message.type === "TYPE_TEXT")           return handleTypeText(message);
  if (message.type === "INSPECT_ELEMENT")     return handleInspectElement(message);
  if (message.type === "GET_RESOURCE_URLS")   return handleGetResourceUrls(message);
  if (message.type === "EXECUTE_SCRIPT")      return handleExecuteScript(message);
  if (message.type === "GET_MCP_TOOLS")       return Promise.resolve(getMcpToolsPayload());
  if (message.type === "REFRESH_MCP_SERVERS") return initMcpServers().then(() => getMcpToolsPayload());
  if (message.type === "CALL_MCP_TOOL")       return callMcpTool(message.serverId, message.toolName, message.input);
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.mcpServers) initMcpServers();
});

initMcpServers();

// ---------------------------------------------------------------------------
// MCP — Streamable HTTP transport (2024-11-05 protocol version)
// ---------------------------------------------------------------------------

async function mcpPost(url, method, params, id) {
  const body = { jsonrpc: "2.0", method, params: params ?? {} };
  if (id != null) body.id = id;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "accept": "application/json, text/event-stream" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("text/event-stream")
    ? parseMcpSse(await res.text(), id)
    : await res.json();
  if (data?.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data;
}

function parseMcpSse(text, id) {
  for (const line of text.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    try {
      const msg = JSON.parse(line.slice(6));
      if (msg.id == null || msg.id === id) {
        if (msg.error) throw new Error(msg.error.message || JSON.stringify(msg.error));
        return msg;
      }
    } catch (e) {
      if (e.message) throw e;
    }
  }
  throw new Error("No matching response in SSE stream");
}

async function discoverMcpTools(url) {
  await mcpPost(url, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "Corvus", version: "1.0" },
  }, 1);
  mcpPost(url, "notifications/initialized", {}, null).catch(() => {});
  const resp = await mcpPost(url, "tools/list", {}, 2);
  return resp.result?.tools || [];
}

async function initMcpServers() {
  const { mcpServers = [] } = await browser.storage.local.get("mcpServers");
  mcpCache = {};
  await Promise.allSettled(
    mcpServers
      .filter((s) => s.enabled !== false)
      .map(async (server) => {
        try {
          const tools = await discoverMcpTools(server.url);
          mcpCache[server.id] = { name: server.name, url: server.url, tools };
        } catch (err) {
          mcpCache[server.id] = { name: server.name, url: server.url, tools: [], error: err.message };
        }
      })
  );
}

function getMcpToolsPayload() {
  const tools = [];
  const meta = {};
  for (const [serverId, server] of Object.entries(mcpCache)) {
    for (const t of server.tools) {
      const prefixed = `mcp__${serverId}__${t.name}`;
      tools.push({
        name: prefixed,
        description: `[${server.name}] ${t.description || t.name}`,
        input_schema: t.inputSchema || { type: "object", properties: {}, required: [] },
      });
      meta[prefixed] = {
        label: t.name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        serverName: server.name,
        serverId,
        originalName: t.name,
      };
    }
  }
  return { tools, meta };
}

async function callMcpTool(serverId, toolName, input) {
  const server = mcpCache[serverId];
  if (!server) return { error: "MCP server not connected — check server config and reload." };
  try {
    const resp = await mcpPost(server.url, "tools/call", {
      name: toolName,
      arguments: input ?? {},
    }, Date.now());
    const content = resp.result?.content || [];
    const text = content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
    if (resp.result?.isError) return { error: text || "Tool returned an error" };
    return { result: text || JSON.stringify(resp.result) };
  } catch (err) {
    return { error: err.message };
  }
}

async function handleScreenshot() {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tabs.length) return { error: "No active tab" };
    const dataUrl = await browser.tabs.captureVisibleTab(tabs[0].windowId, {
      format: "png",
    });
    return { dataUrl };
  } catch (err) {
    return { error: err.message };
  }
}

async function handleGetPageContent({ truncate = true } = {}) {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tabs.length) return { error: "No active tab" };
    const results = await browser.tabs.executeScript(tabs[0].id, {
      code: `(function() {
        const truncate = ${JSON.stringify(truncate)};
        const textLimit = truncate ? 500 : 6000;
        const linkLimit = truncate ? 30 : 80;

        const links = Array.from(document.querySelectorAll("a[href]"))
          .map(a => ({ text: a.innerText.trim().slice(0, 80), href: a.href }))
          .filter(l => l.href && !l.href.startsWith("javascript:") && l.text)
          .slice(0, linkLimit);

        const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6"))
          .map(h => ({ level: h.tagName, text: h.innerText.trim().slice(0, 120) }))
          .slice(0, 40);

        return {
          title: document.title,
          url: document.location.href,
          text: document.body ? document.body.innerText.slice(0, textLimit) : "",
          links,
          headings,
          truncated: truncate,
        };
      })()`,
    });
    return { content: results[0] };
  } catch (err) {
    return { error: err.message };
  }
}

async function handleNavigate({ url }) {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tabs.length) return { error: "No active tab" };
    await browser.tabs.update(tabs[0].id, { url });
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
}

async function handleClickElement({ selector }) {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tabs.length) return { error: "No active tab" };
    const results = await browser.tabs.executeScript(tabs[0].id, {
      code: `
        (function() {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return { error: "Element not found" };
          el.click();
          return { success: true, tag: el.tagName, text: el.innerText?.slice(0, 100) };
        })()
      `,
    });
    return results[0];
  } catch (err) {
    return { error: err.message };
  }
}

async function handleInspectElement({ selector }) {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tabs.length) return { error: "No active tab" };
    const results = await browser.tabs.executeScript(tabs[0].id, {
      code: `(function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return { error: "Element not found: " + ${JSON.stringify(selector)} };

        const attrs = {};
        for (const a of el.attributes) attrs[a.name] = a.value;

        const cs = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();

        // Collect source-related properties across element types
        const sources = {
          src:        el.src        || undefined,
          currentSrc: el.currentSrc || undefined,
          href:       el.href       || undefined,
          action:     el.action     || undefined,
          data:       el.data       || undefined,
        };
        // <source> / <track> children
        const childSources = Array.from(el.querySelectorAll("source,track"))
          .map(s => ({ tag: s.tagName, src: s.src, type: s.type, label: s.label }));

        // <video>/<audio> text tracks
        const textTracks = el.textTracks
          ? Array.from(el.textTracks).map(t => ({ kind: t.kind, label: t.label, src: t.id }))
          : undefined;

        return {
          tag: el.tagName,
          id: el.id || undefined,
          classes: el.className ? el.className.split(/\\s+/).filter(Boolean) : [],
          attributes: attrs,
          sources: Object.fromEntries(Object.entries(sources).filter(([,v]) => v)),
          childSources: childSources.length ? childSources : undefined,
          textTracks: textTracks?.length ? textTracks : undefined,
          innerText: el.innerText?.slice(0, 400) || undefined,
          innerHTML: el.innerHTML?.slice(0, 600) || undefined,
          rect: { top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width), height: Math.round(rect.height) },
          display: cs.display,
          visibility: cs.visibility,
        };
      })()`,
    });
    return results[0];
  } catch (err) {
    return { error: err.message };
  }
}

async function handleGetResourceUrls({ filter }) {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tabs.length) return { error: "No active tab" };
    const results = await browser.tabs.executeScript(tabs[0].id, {
      code: `(function() {
        const filter = ${JSON.stringify(filter || "")};
        const entries = performance.getEntriesByType("resource");
        const resources = entries.map(e => ({
          url:  e.name,
          type: e.initiatorType,
          ms:   Math.round(e.duration),
          kb:   e.transferSize ? Math.round(e.transferSize / 1024) : undefined,
        }));

        // Also grab media elements directly from DOM (catches blob: and stream URLs)
        const mediaEls = Array.from(document.querySelectorAll("video,audio,img,source")).map(el => ({
          url:  el.currentSrc || el.src || el.srcset || "",
          type: el.tagName.toLowerCase(),
        })).filter(m => m.url);

        const all = [...resources, ...mediaEls];
        const filtered = filter
          ? all.filter(r => r.url.toLowerCase().includes(filter.toLowerCase()) || r.type.toLowerCase().includes(filter.toLowerCase()))
          : all;

        // Deduplicate by URL
        const seen = new Set();
        return filtered.filter(r => { if (seen.has(r.url)) return false; seen.add(r.url); return true; }).slice(0, 120);
      })()`,
    });
    return { resources: results[0] };
  } catch (err) {
    return { error: err.message };
  }
}

async function handleExecuteScript({ code }) {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tabs.length) return { error: "No active tab" };
    const results = await browser.tabs.executeScript(tabs[0].id, {
      code: `(function() {
        try {
          const __result = eval(${JSON.stringify(code)});
          if (__result === undefined) return { result: "undefined" };
          try { return { result: JSON.parse(JSON.stringify(__result)) }; }
          catch { return { result: String(__result).slice(0, 4000) }; }
        } catch(e) {
          return { error: e.message };
        }
      })()`,
    });
    return results[0];
  } catch (err) {
    return { error: err.message };
  }
}


async function handleTypeText({ selector, text }) {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tabs.length) return { error: "No active tab" };
    const results = await browser.tabs.executeScript(tabs[0].id, {
      code: `
        (function() {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return { error: "Element not found" };
          el.focus();
          el.value = ${JSON.stringify(text)};
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return { success: true };
        })()
      `,
    });
    return results[0];
  } catch (err) {
    return { error: err.message };
  }
}
