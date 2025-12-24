import "dotenv/config";
import fs from "fs";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pdfParseModule = require("pdf-parse");
const pdfParse = pdfParseModule?.default ?? pdfParseModule;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const INDEX_PATH = "./rag_index.json";

if (!OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY. Put it in .env");
  process.exit(1);
}

if (typeof pdfParse !== "function") {
  console.error("pdfParse is not a function. Install: npm i pdf-parse@1.1.1");
  process.exit(1);
}

function cosineSimilarity(a, b) {
  let dot = 0, ma = 0, mb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    ma += a[i] * a[i];
    mb += b[i] * b[i];
  }
  const denom = Math.sqrt(ma) * Math.sqrt(mb);
  return denom ? dot / denom : 0;
}

async function embed(input) {
  // Embedding model
  const r = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "text-embedding-3-small", input }),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(data?.error?.message || `Embeddings error (${r.status})`);
  }
  return data.data[0].embedding;
}

async function chat(prompt) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
    }),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(data?.error?.message || `Chat error (${r.status})`);
  }
  return data.choices?.[0]?.message?.content ?? "";
}

async function buildIndex(pdfPath) {
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`PDF not found: ${pdfPath}`);
  }

  const pdfBuffer = fs.readFileSync(pdfPath);
  const pdfData = await pdfParse(pdfBuffer);
  const text = (pdfData?.text || "").trim();

  if (!text) {
    throw new Error("Could not extract text from PDF (empty text).");
  }

  // Split text into chunks
  const chunks = [];
  const chunkSize = 900;
  for (let i = 0; i < text.length; i += chunkSize) {
    const chunk = text.slice(i, i + chunkSize).trim();
    if (chunk) chunks.push(chunk);
  }

  const embeddings = [];
  for (const c of chunks) embeddings.push(await embed(c));

  const index = { chunks, embeddings };
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
  return index;
}

async function main() {
  const pdfPath = process.argv[2] || "./document.pdf";
  const question = process.argv.slice(3).join(" ") || "What is this document about?";

  const index = fs.existsSync(INDEX_PATH)
    ? JSON.parse(fs.readFileSync(INDEX_PATH, "utf-8"))
    : await buildIndex(pdfPath);

  // Get query embedding
  const qEmb = await embed(question);

  // Calculate cosine similarity and get top 3 most relevant chunks
  const scored = index.embeddings
    .map((e, i) => ({ i, score: cosineSimilarity(qEmb, e) }))
    .sort((a, b) => b.score - a.score);

  const topChunks = scored.slice(0, 3).map(s => index.chunks[s.i]);
  const context = topChunks.join("\n\n");

  const prompt = `Answer using ONLY the context.

Context:
${context}

Question: ${question}

Answer:`;

  const answer = await chat(prompt);

  console.log("\nQ:", question);
  console.log("A:", answer);
}

main().catch((err) => {
  console.error(err?.message || err);
});
