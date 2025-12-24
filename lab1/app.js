// Mini Chat Studio — Vanilla JS
// NOTE: For real production apps, never expose API keys in client-side code.

const $ = (id) => document.getElementById(id);

const providerEl = $("provider");
const modeEl = $("mode");
const modelEl = $("model");
const endpointTextEl = $("endpointText");

const openaiKeyWrap = $("openaiKeyWrap");
const geminiKeyWrap = $("geminiKeyWrap");
const openaiKeyEl = $("openaiKey");
const geminiKeyEl = $("geminiKey");
const saveKeysEl = $("saveKeys");
const systemEl = $("system");

const resetChatEl = $("resetChat");
const testBtnEl = $("testBtn");

const statusEl = $("status");
const messagesEl = $("messages");
const inputEl = $("input");
const sendBtnEl = $("sendBtn");
const copyBtnEl = $("copyBtn");
const clearBtnEl = $("clearBtn");

// ---- Internal routing (NO endpoint input from user) ----
const ROUTES = {
  openai: {
    text: {
      endpoint: "https://api.openai.com/v1/chat/completions",
      models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1"]
    },
    image: {
      endpoint: "https://api.openai.com/v1/images/generations",
      models: ["dall-e-3", "dall-e-2"]
    }
  },
  gemini: {
    text: {
      endpoint: (model) =>
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      models: ["gemini-2.5-flash", "gemini-2.0-flash"]
    }
  }
};

// ---- Conversation state ----
let openaiMessages = []; // {role:"system"|"user"|"assistant", content:string}
let geminiContents = []; // {role:"user"|"model", parts:[{text:string}]}

function now() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function setStatus(text, kind = "") {
  statusEl.textContent = text;
  statusEl.style.color =
    kind === "ok" ? "var(--ok)" :
    kind === "err" ? "var(--bad)" :
    "var(--muted)";
}

function addTextBubble(text, who, meta = "") {
  const wrap = document.createElement("div");
  wrap.className = "bubbleWrap";

  const b = document.createElement("div");
  b.className = `bubble ${who}`;
  b.textContent = text;

  wrap.appendChild(b);

  if (meta) {
    const m = document.createElement("div");
    m.className = "meta";
    m.textContent = meta;
    wrap.appendChild(m);
  }

  messagesEl.appendChild(wrap);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addImageBubble(title, imgSrc, meta = "") {
  const wrap = document.createElement("div");
  wrap.className = "bubbleWrap";

  const b = document.createElement("div");
  b.className = "bubble ai";
  b.textContent = title;

  const img = document.createElement("img");
  img.className = "imgOut";
  img.src = imgSrc;
  img.alt = "generated image";
  b.appendChild(img);

  wrap.appendChild(b);

  if (meta) {
    const m = document.createElement("div");
    m.className = "meta";
    m.textContent = meta;
    wrap.appendChild(m);
  }

  messagesEl.appendChild(wrap);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function safeJsonParse(text) {
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function safeJson(res) {
  const text = await res.text();
  return safeJsonParse(text);
}

function getSelection() {
  const provider = providerEl.value;
  const mode = modeEl.value;

  const route = ROUTES?.[provider]?.[mode];
  if (!route) return null;

  const model = modelEl.value;
  const endpoint = (typeof route.endpoint === "function") ? route.endpoint(model) : route.endpoint;

  return { provider, mode, model, endpoint };
}

function refreshUI() {
  const provider = providerEl.value;

  // Gemini doesn't support "image" mode in this demo
  if (provider === "gemini" && modeEl.value === "image") {
    modeEl.value = "text";
  }

  const mode = modeEl.value;
  const route = ROUTES?.[provider]?.[mode];

  // models
  modelEl.innerHTML = "";
  (route?.models || []).forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    modelEl.appendChild(opt);
  });

  const sel = getSelection();
  endpointTextEl.textContent = sel ? sel.endpoint : "—";

  // keys visibility
  openaiKeyWrap.style.display = provider === "openai" ? "block" : "none";
  geminiKeyWrap.style.display = provider === "gemini" ? "block" : "none";

  // system instruction only meaningful for text
  systemEl.disabled = (modeEl.value !== "text");
}

function persist() {
  const payload = {
    provider: providerEl.value,
    mode: modeEl.value,
    model: modelEl.value,
    system: systemEl.value || "",
    saveKeys: saveKeysEl.checked,
    openaiKey: saveKeysEl.checked ? (openaiKeyEl.value || "") : "",
    geminiKey: saveKeysEl.checked ? (geminiKeyEl.value || "") : ""
  };
  localStorage.setItem("mini_chat_studio", JSON.stringify(payload));
}

function loadPersisted() {
  const raw = localStorage.getItem("mini_chat_studio");
  if (!raw) return;

  const data = safeJsonParse(raw);
  if (data?.provider) providerEl.value = data.provider;
  if (data?.mode) modeEl.value = data.mode;
  if (data?.system) systemEl.value = data.system;

  saveKeysEl.checked = !!data?.saveKeys;
  if (saveKeysEl.checked) {
    openaiKeyEl.value = data?.openaiKey || "";
    geminiKeyEl.value = data?.geminiKey || "";
  }
}

// ---------------- OpenAI: Chat Completions ----------------
async function callOpenAIChat(userText, sel) {
  const key = (openaiKeyEl.value || "").trim();
  if (!key) throw new Error("Missing OpenAI API key.");

  const sys = (systemEl.value || "").trim();
  const messages = [];

  if (sys) messages.push({ role: "system", content: sys });
  messages.push(...openaiMessages);
  messages.push({ role: "user", content: userText });

  const res = await fetch(sel.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`
    },
    body: JSON.stringify({
      model: sel.model,
      messages,
      temperature: 0.7
    })
  });

  const data = await safeJson(res);
  if (!res.ok) {
    throw new Error(data?.error?.message || data?.raw || `OpenAI error (${res.status})`);
  }

  const answer = data?.choices?.[0]?.message?.content ?? "";

  // update history
  openaiMessages.push({ role: "user", content: userText });
  openaiMessages.push({ role: "assistant", content: answer });

  return answer || "(empty)";
}

// ---------------- OpenAI: Images Generations ----------------
async function callOpenAIImage(prompt, sel) {
  const key = (openaiKeyEl.value || "").trim();
  if (!key) throw new Error("Missing OpenAI API key.");

  const body = {
    model: sel.model,
    prompt,
    n: 1,
    size: "1024x1024",
    response_format: "b64_json"
  };

  const res = await fetch(sel.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`
    },
    body: JSON.stringify(body)
  });

  const data = await safeJson(res);
  if (!res.ok) {
    throw new Error(data?.error?.message || data?.raw || `Images error (${res.status})`);
  }

  const item = data?.data?.[0];
  if (!item) throw new Error("No image returned.");

  if (item.b64_json) {
    return `data:image/png;base64,${item.b64_json}`;
  }
  if (item.url) {
    return item.url;
  }
  throw new Error("Unknown image response format.");
}

// ---------------- Gemini: generateContent ----------------
async function callGemini(userText, sel) {
  const key = (geminiKeyEl.value || "").trim();
  if (!key) throw new Error("Missing Gemini API key.");

  const sys = (systemEl.value || "").trim();

  // add user turn
  geminiContents.push({ role: "user", parts: [{ text: userText }] });

  const payload = { contents: geminiContents };

  // optional system instruction (works on many Gemini models)
  if (sys) payload.systemInstruction = { parts: [{ text: sys }] };

  const res = await fetch(sel.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": key
    },
    body: JSON.stringify(payload)
  });

  const data = await safeJson(res);
  if (!res.ok) {
    throw new Error(data?.error?.message || data?.raw || `Gemini error (${res.status})`);
  }

  const parts = data?.candidates?.[0]?.content?.parts || [];
  const answer = parts.map(p => p.text || "").join("").trim();

  // add model turn
  geminiContents.push({ role: "model", parts: [{ text: answer || "(empty)" }] });

  return answer || "(empty)";
}

// ---------------- Send handler ----------------
async function send() {
  const text = (inputEl.value || "").trim();
  if (!text) return;

  const sel = getSelection();
  if (!sel) {
    addTextBubble("Invalid selection.", "ai", `Error • ${now()}`);
    return;
  }

  inputEl.value = "";
  autoResize();

  addTextBubble(text, "user", `${sel.provider.toUpperCase()} • ${sel.mode} • ${sel.model} • ${now()}`);

  sendBtnEl.disabled = true;
  setStatus("Thinking...");

  try {
    if (sel.provider === "openai" && sel.mode === "text") {
      const ans = await callOpenAIChat(text, sel);
      addTextBubble(ans, "ai", `OpenAI Chat • ${now()}`);
    } else if (sel.provider === "openai" && sel.mode === "image") {
      const imgSrc = await callOpenAIImage(text, sel);
      addImageBubble("Generated image ✅", imgSrc, `OpenAI Images • ${now()}`);
    } else if (sel.provider === "gemini" && sel.mode === "text") {
      const ans = await callGemini(text, sel);
      addTextBubble(ans, "ai", `Gemini • ${now()}`);
    } else {
      addTextBubble("This mode is not enabled.", "ai", `Error • ${now()}`);
    }

    setStatus("Ready", "ok");
    persist();
  } catch (e) {
    addTextBubble(String(e.message || e), "ai", `Error • ${now()}`);
    setStatus("Error", "err");
    persist();
  } finally {
    sendBtnEl.disabled = false;
    inputEl.focus();
  }
}

function resetChat() {
  openaiMessages = [];
  geminiContents = [];
  messagesEl.innerHTML = "";
  setStatus("Ready");
}

function clearChatUI() {
  messagesEl.innerHTML = "";
  setStatus("Cleared");
}

function copyTranscript() {
  const bubbles = [...messagesEl.querySelectorAll(".bubble")].map(b => b.textContent || "");
  const text = bubbles.join("\n\n---\n\n");
  navigator.clipboard.writeText(text).then(() => {
    setStatus("Copied", "ok");
    setTimeout(() => setStatus("Ready"), 900);
  }).catch(() => setStatus("Copy failed", "err"));
}

function autoResize() {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(180, inputEl.scrollHeight) + "px";
}

// ---------------- Events ----------------
providerEl.addEventListener("change", () => { refreshUI(); persist(); });
modeEl.addEventListener("change", () => { refreshUI(); persist(); });
modelEl.addEventListener("change", persist);
systemEl.addEventListener("input", persist);

saveKeysEl.addEventListener("change", persist);
openaiKeyEl.addEventListener("input", persist);
geminiKeyEl.addEventListener("input", persist);

resetChatEl.addEventListener("click", resetChat);
clearBtnEl.addEventListener("click", clearChatUI);
copyBtnEl.addEventListener("click", copyTranscript);

sendBtnEl.addEventListener("click", send);

inputEl.addEventListener("input", autoResize);
inputEl.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" && !ev.shiftKey) {
    ev.preventDefault();
    send();
  }
});

testBtnEl.addEventListener("click", async () => {
  const sel = getSelection();
  if (!sel) return;

  setStatus("Testing...");
  sendBtnEl.disabled = true;

  try {
    if (sel.provider === "openai") {
      if (sel.mode === "image") {
        const imgSrc = await callOpenAIImage("A simple cute icon of a cat, flat design", sel);
        addImageBubble("Test image ✅", imgSrc, `Test • ${now()}`);
      } else {
        const ans = await callOpenAIChat("Say only: pong", sel);
        addTextBubble(ans, "ai", `Test • ${now()}`);
      }
    } else {
      const ans = await callGemini("Say only: pong", sel);
      addTextBubble(ans, "ai", `Test • ${now()}`);
    }
    setStatus("Test OK", "ok");
  } catch (e) {
    addTextBubble(String(e.message || e), "ai", `Test Error • ${now()}`);
    setStatus("Test Failed", "err");
  } finally {
    sendBtnEl.disabled = false;
    setTimeout(() => setStatus("Ready"), 900);
  }
});

// ---------------- Init ----------------
loadPersisted();
refreshUI();
autoResize();
setStatus("Ready");

// Welcome message
addTextBubble(
  "Welcome! Choose Provider + Mode + Model, add the correct API key, then start chatting.\n\n• OpenAI: Text + Image\n• Gemini: Text",
  "ai",
  `System • ${now()}`
);
