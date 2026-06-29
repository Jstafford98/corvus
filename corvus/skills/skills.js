"use strict";

let skills = [];
let selectedId = null;

const listEl      = document.getElementById("skill-list");
const newBtn      = document.getElementById("new-btn");
const editorEmpty = document.getElementById("editor-empty");
const editorForm  = document.getElementById("editor-form");
const nameEl      = document.getElementById("skill-name");
const descEl      = document.getElementById("skill-description");
const patternEl   = document.getElementById("skill-url-pattern");
const contentEl   = document.getElementById("skill-content");
const saveBtn     = document.getElementById("save-btn");
const deleteBtn   = document.getElementById("delete-btn");
const saveStatus  = document.getElementById("save-status");

async function load() {
  const stored = await browser.storage.local.get("skills");
  skills = stored.skills || [];
  renderList();
}

function renderList() {
  listEl.innerHTML = "";
  if (!skills.length) {
    const empty = document.createElement("div");
    empty.className = "skill-list-empty";
    empty.textContent = "No skills yet. Click + New to create one.";
    listEl.appendChild(empty);
    return;
  }
  for (const skill of skills) {
    const row = document.createElement("div");
    row.className = "skill-row" + (skill.id === selectedId ? " active" : "");
    row.innerHTML = `
      <div class="skill-row-name">${escapeHtml(skill.name || "Untitled")}</div>
      <div class="skill-row-meta">${escapeHtml(skill.urlPattern || skill.description || "")}</div>
    `;
    row.addEventListener("click", () => selectSkill(skill.id));
    listEl.appendChild(row);
  }
}

function selectSkill(id) {
  selectedId = id;
  const skill = skills.find((s) => s.id === id);
  if (!skill) return;

  nameEl.value      = skill.name || "";
  descEl.value      = skill.description || "";
  patternEl.value   = skill.urlPattern || "";
  contentEl.value   = skill.content || "";
  saveStatus.textContent = "";
  saveStatus.className = "";

  editorEmpty.classList.add("hidden");
  editorForm.classList.remove("hidden");
  deleteBtn.classList.remove("hidden");

  renderList();
  nameEl.focus();
}

function openNewSkill() {
  selectedId = null;
  nameEl.value      = "";
  descEl.value      = "";
  patternEl.value   = "";
  contentEl.value   = "";
  saveStatus.textContent = "";
  saveStatus.className = "";

  editorEmpty.classList.add("hidden");
  editorForm.classList.remove("hidden");
  deleteBtn.classList.add("hidden");

  renderList();
  nameEl.focus();
}

newBtn.addEventListener("click", openNewSkill);

editorForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name    = nameEl.value.trim();
  const content = contentEl.value.trim();
  if (!name) { flash("Name is required.", "err"); return; }
  if (!content) { flash("Content is required.", "err"); return; }

  if (selectedId) {
    const idx = skills.findIndex((s) => s.id === selectedId);
    if (idx >= 0) {
      skills[idx] = {
        ...skills[idx],
        name,
        description: descEl.value.trim(),
        urlPattern:  patternEl.value.trim(),
        content,
        updatedAt: Date.now(),
      };
    }
  } else {
    const newSkill = {
      id:          `skill_${Date.now()}`,
      name,
      description: descEl.value.trim(),
      urlPattern:  patternEl.value.trim(),
      content,
      createdAt:   Date.now(),
      updatedAt:   Date.now(),
    };
    skills.unshift(newSkill);
    selectedId = newSkill.id;
    deleteBtn.classList.remove("hidden");
  }

  await browser.storage.local.set({ skills });
  renderList();
  flash("Saved.", "ok");
});

deleteBtn.addEventListener("click", async () => {
  if (!selectedId) return;
  if (!confirm("Delete this skill?")) return;
  skills = skills.filter((s) => s.id !== selectedId);
  await browser.storage.local.set({ skills });
  selectedId = null;
  editorEmpty.classList.remove("hidden");
  editorForm.classList.add("hidden");
  renderList();
});

function flash(msg, type) {
  saveStatus.textContent = msg;
  saveStatus.className = type;
  setTimeout(() => {
    if (saveStatus.textContent === msg) {
      saveStatus.textContent = "";
      saveStatus.className = "";
    }
  }, 3000);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

load();
