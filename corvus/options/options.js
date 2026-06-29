"use strict";

const providerEl = document.getElementById("provider");
const baseUrlField = document.getElementById("base-url-field");
const baseUrlEl = document.getElementById("base-url");
const apiKeyEl = document.getElementById("api-key");
const modelEl = document.getElementById("model");
const modelHint = document.getElementById("model-hint");
const saveBtn = document.getElementById("save-btn");
const testBtn = document.getElementById("test-btn");
const statusEl = document.getElementById("status");

const MODEL_DEFAULTS = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-4o",
  "openai-compatible": "your-model-name",
};

async function load() {
  const stored = await browser.storage.local.get([
    "provider",
    "apiKey",
    "baseUrl",
    "model",
  ]);
  providerEl.value = stored.provider || "anthropic";
  apiKeyEl.value = stored.apiKey || "";
  baseUrlEl.value = stored.baseUrl || "";
  modelEl.value = stored.model || "";
  updateProviderUI();
}

function updateProviderUI() {
  const p = providerEl.value;
  baseUrlField.classList.toggle("hidden", p !== "openai-compatible");
  modelHint.textContent = `Default: ${MODEL_DEFAULTS[p] || ""}`;
}

providerEl.addEventListener("change", updateProviderUI);

saveBtn.addEventListener("click", async () => {
  await browser.storage.local.set({
    provider: providerEl.value,
    apiKey: apiKeyEl.value.trim(),
    baseUrl: baseUrlEl.value.trim(),
    model: modelEl.value.trim(),
  });
  showStatus("Saved.", "success");
});

testBtn.addEventListener("click", async () => {
  testBtn.disabled = true;
  hideStatus();

  const provider = providerEl.value;
  const apiKey = apiKeyEl.value.trim();
  const baseUrl = baseUrlEl.value.trim();
  const model = modelEl.value.trim();

  try {
    if (provider === "anthropic") {
      await testAnthropic(apiKey, model);
    } else {
      await testOpenAI(apiKey, baseUrl, model);
    }
    showStatus("Connection successful.", "success");
  } catch (err) {
    showStatus(`Error: ${err.message}`, "error");
  } finally {
    testBtn.disabled = false;
  }
});

async function testAnthropic(apiKey, model) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: model || "claude-haiku-4-5-20251001",
      max_tokens: 10,
      messages: [{ role: "user", content: "Hi" }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
}

async function testOpenAI(apiKey, baseUrl, model) {
  const url = `${(baseUrl || "https://api.openai.com").replace(/\/$/, "")}/v1/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || "gpt-4o-mini",
      max_tokens: 10,
      messages: [{ role: "user", content: "Hi" }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
}

function showStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className = type;
  statusEl.classList.remove("hidden");
  setTimeout(hideStatus, 4000);
}

function hideStatus() {
  statusEl.classList.add("hidden");
}

load();
