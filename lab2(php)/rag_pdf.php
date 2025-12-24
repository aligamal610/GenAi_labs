<?php
function load_env_if_present(string $path = ".env"): void {
  if (!file_exists($path)) return;
  $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
  foreach ($lines as $line) {
    $line = trim($line);
    if ($line === "" || str_starts_with($line, "#")) continue;
    $pos = strpos($line, "=");
    if ($pos === false) continue;
    $k = trim(substr($line, 0, $pos));
    $v = trim(substr($line, $pos + 1));
    $v = trim($v, "\"'");
    if (getenv($k) === false) putenv("$k=$v");
  }
}

function http_post_json(string $url, array $headers, array $payload): array {
  $ch = curl_init($url);
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => $headers,
    CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
  ]);
  $res = curl_exec($ch);
  $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
  $err = curl_error($ch);
  curl_close($ch);

  if ($res === false) {
    return [$code ?: 0, ["error" => ["message" => $err ?: "Unknown cURL error"]]];
  }
  $json = json_decode($res, true);
  if (!is_array($json)) $json = ["raw" => $res];
  return [$code, $json];
}

function require_pdftotext(): void {
  $out = trim((string) shell_exec("command -v pdftotext 2>/dev/null"));
  if ($out === "") {
    throw new RuntimeException("pdftotext not found. Install: sudo apt-get install poppler-utils");
  }
}

function pdf_to_text(string $pdfPath): string {
  require_pdftotext();
  if (!file_exists($pdfPath)) throw new RuntimeException("PDF not found: $pdfPath");
  $cmd = "pdftotext " . escapeshellarg($pdfPath) . " - 2>/dev/null";
  $text = (string) shell_exec($cmd);
  $text = trim($text);
  if ($text === "") throw new RuntimeException("PDF text is empty (maybe scanned PDF).");
  return $text;
}

function cosine_similarity(array $a, array $b): float {
  $dot = 0.0; $ma = 0.0; $mb = 0.0;
  $n = min(count($a), count($b));
  for ($i = 0; $i < $n; $i++) {
    $dot += $a[$i] * $b[$i];
    $ma += $a[$i] * $a[$i];
    $mb += $b[$i] * $b[$i];
  }
  $den = sqrt($ma) * sqrt($mb);
  return $den > 0 ? ($dot / $den) : 0.0;
}

load_env_if_present();
$apiKey = getenv("OPENAI_API_KEY");
if (!$apiKey) {
  fwrite(STDERR, "❌ Missing OPENAI_API_KEY. Put it in .env or export it.\n");
  exit(1);
}

$INDEX_PATH = "./rag_index.json";

function embed(string $input, string $apiKey): array {
  // Embedding model
  [$code, $data] = http_post_json(
    "https://api.openai.com/v1/embeddings",
    [
      "Authorization: Bearer $apiKey",
      "Content-Type: application/json",
    ],
    [
      "model" => "text-embedding-3-small",
      "input" => $input,
    ]
  );

  if ($code < 200 || $code >= 300) {
    $msg = $data["error"]["message"] ?? ($data["raw"] ?? "Embeddings error ($code)");
    throw new RuntimeException($msg);
  }
  return $data["data"][0]["embedding"] ?? [];
}

function chat(string $prompt, string $apiKey): string {
  [$code, $data] = http_post_json(
    "https://api.openai.com/v1/chat/completions",
    [
      "Authorization: Bearer $apiKey",
      "Content-Type: application/json",
    ],
    [
      "model" => "gpt-4o-mini",
      "messages" => [
        ["role" => "user", "content" => $prompt]
      ],
      "temperature" => 0.2,
    ]
  );

  if ($code < 200 || $code >= 300) {
    $msg = $data["error"]["message"] ?? ($data["raw"] ?? "Chat error ($code)");
    throw new RuntimeException($msg);
  }
  return $data["choices"][0]["message"]["content"] ?? "";
}

function build_index(string $pdfPath, string $apiKey, string $indexPath): array {
  $text = pdf_to_text($pdfPath);

  // Split text into chunks
  $chunks = [];
  $chunkSize = 900;
  $len = strlen($text);
  for ($i = 0; $i < $len; $i += $chunkSize) {
    $chunk = trim(substr($text, $i, $chunkSize));
    if ($chunk !== "") $chunks[] = $chunk;
  }

  $embeddings = [];
  foreach ($chunks as $c) $embeddings[] = embed($c, $apiKey);

  $index = ["chunks" => $chunks, "embeddings" => $embeddings];
  file_put_contents($indexPath, json_encode($index, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
  return $index;
}

try {
  $pdfPath = $argv[1] ?? "./document.pdf";
  $question = $argv[2] ?? "What is this document about?";

  $index = file_exists($INDEX_PATH)
    ? json_decode(file_get_contents($INDEX_PATH), true)
    : build_index($pdfPath, $apiKey, $INDEX_PATH);

  // Get query embedding
  $qEmb = embed($question, $apiKey);

  // Calculate cosine similarity and get top 3 most relevant chunks
  $scored = [];
  foreach ($index["embeddings"] as $i => $e) {
    $scored[] = ["i" => $i, "score" => cosine_similarity($qEmb, $e)];
  }
  usort($scored, fn($x, $y) => $y["score"] <=> $x["score"]);

  $top = array_slice($scored, 0, 3);
  $ctxParts = [];
  foreach ($top as $t) $ctxParts[] = $index["chunks"][$t["i"]];
  $context = implode("\n\n", $ctxParts);

  $prompt = "Answer using ONLY the context.\n\nContext:\n$context\n\nQuestion: $question\nAnswer:";
  $answer = chat($prompt, $apiKey);

  echo "\nQ: $question\n";
  echo "A: $answer\n";
} catch (Throwable $e) {
  fwrite(STDERR, "❌ " . $e->getMessage() . "\n");
  exit(1);
}
