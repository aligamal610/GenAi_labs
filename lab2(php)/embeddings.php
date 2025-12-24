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

load_env_if_present();
$apiKey = getenv("OPENAI_API_KEY");
if (!$apiKey) {
  fwrite(STDERR, "❌ Missing OPENAI_API_KEY. Put it in .env or export it.\n");
  exit(1);
}

$text = $argv[1] ?? "hello embeddings";

[$code, $data] = http_post_json(
  "https://api.openai.com/v1/embeddings",
  [
    "Authorization: Bearer $apiKey",
    "Content-Type: application/json",
  ],
  [
    "model" => "text-embedding-3-small",
    "input" => $text,
  ]
);

if ($code < 200 || $code >= 300) {
  $msg = $data["error"]["message"] ?? ($data["raw"] ?? "Embeddings error ($code)");
  fwrite(STDERR, "❌ $msg\n");
  exit(1);
}

$emb = $data["data"][0]["embedding"] ?? [];
echo "dim = " . count($emb) . PHP_EOL;
echo "first 8 = " . json_encode(array_slice($emb, 0, 8)) . PHP_EOL;
