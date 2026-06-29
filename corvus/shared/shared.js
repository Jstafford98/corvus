"use strict";

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

    const hm = line.match(/^(#{1,6})\s+(.+)/);
    if (hm) {
      parts.push(`<h${hm[1].length}>${inlineMarkdown(hm[2])}</h${hm[1].length}>`);
      i++;
      continue;
    }

    if (/^[-*_]{3,}\s*$/.test(line)) {
      parts.push("<hr>");
      i++;
      continue;
    }

    if (/^[-*+]\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*+]\s/.test(lines[i])) {
        items.push(`<li>${inlineMarkdown(lines[i].replace(/^[-*+]\s+/, ""))}</li>`);
        i++;
      }
      parts.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    if (/^\d+\.\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(`<li>${inlineMarkdown(lines[i].replace(/^\d+\.\s+/, ""))}</li>`);
        i++;
      }
      parts.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    if (line.trim() === "") {
      i++;
      continue;
    }

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

const DEFAULT_SYSTEM_PROMPT =
  "You are a helpful AI browser assistant. You can see the user's screen, navigate pages, click elements, and type text. Be concise. When using tools, explain briefly what you're doing.";

async function fetchProviderModels(provider, apiKey, baseUrl) {
  if (!apiKey) return [];

  const cacheKey = `${provider}__${baseUrl || ""}`;
  const TTL = 24 * 60 * 60 * 1000;

  const { modelsCache = {} } = await browser.storage.local.get("modelsCache");
  const cached = modelsCache[cacheKey];
  if (cached && Date.now() - cached.ts < TTL) return cached.models;

  let models = [];
  try {
    if (provider === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
      });
      if (res.ok) {
        const data = await res.json();
        models = (data.data || []).map((m) => ({ id: m.id, label: m.display_name || m.id }));
      }
    } else if (provider === "openai" || provider === "openai-compatible") {
      const base = (baseUrl || "https://api.openai.com").replace(/\/$/, "");
      const res = await fetch(`${base}/v1/models`, {
        headers: { authorization: `Bearer ${apiKey}` },
      });
      if (res.ok) {
        const data = await res.json();
        models = (data.data || []).map((m) => ({ id: m.id, label: m.id }));
        if (provider === "openai") {
          models = models.filter(
            (m) => /^(gpt-|o\d|chatgpt-)/.test(m.id) && !/(realtime|audio|search|vision-preview)/.test(m.id)
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
