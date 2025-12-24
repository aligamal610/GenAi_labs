import "dotenv/config";
import fs from "fs";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

function toDataUrl(path) {
  const ext = path.toLowerCase().endsWith(".png") ? "png" : "jpeg";
  const b64 = fs.readFileSync(path).toString("base64");
  return `data:image/${ext};base64,${b64}`;
}

async function main() {
  const imgPath = process.argv[2] || "./image.jpg";
  const question = process.argv.slice(3).join(" ") || "Describe this image in 1 paragraph.";

  const body = {
    model: "gpt-4o-mini",
    messages: [{
      role: "user",
      content: [
        { type: "text", text: question },
        { type: "image_url", image_url: { url: toDataUrl(imgPath) } }
      ]
    }]
  };

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await r.json();
  console.log(data.choices?.[0]?.message?.content || data);
}

main().catch(console.error);
