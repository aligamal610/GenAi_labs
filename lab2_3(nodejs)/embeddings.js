import "dotenv/config";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

async function main() {
  const text = process.argv.slice(2).join(" ") || "hello embeddings";

  const r = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: text,
    }),
  });

  const data = await r.json();
  console.log("dim =", data.data?.[0]?.embedding?.length);
  console.log("first 8 =", data.data?.[0]?.embedding?.slice(0, 8));
}

main().catch(console.error);
