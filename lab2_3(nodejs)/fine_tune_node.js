import "dotenv/config";
import fs from "fs";

const KEY = process.env.OPENAI_API_KEY;
if (!KEY) throw new Error("Missing OPENAI_API_KEY");

async function uploadTrainingFile(path) {
  const form = new FormData();
  const blob = new Blob([fs.readFileSync(path)], { type: "text/jsonl" });
  form.append("file", blob, "train.jsonl");
  form.append("purpose", "fine-tune"); // required :contentReference[oaicite:5]{index=5}

  const r = await fetch("https://api.openai.com/v1/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}` },
    body: form,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || "Upload failed");
  return data.id;
}

async function createFineTuneJob(fileId) {
  const r = await fetch("https://api.openai.com/v1/fine_tuning/jobs", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
    model: "gpt-4o-mini-2024-07-18",
      training_file: fileId, // required :contentReference[oaicite:6]{index=6}
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || "Create job failed");
  return data;
}

async function main() {
  const fileId = await uploadTrainingFile("./train.jsonl");
  console.log("Uploaded file:", fileId);

  const job = await createFineTuneJob(fileId);
  console.log("Job:", job.id, "status:", job.status);
  console.log("When done, fine_tuned_model will appear in job.fine_tuned_model");
}

main().catch(console.error);
