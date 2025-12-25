<?php
// PHP Native Fine-tune: upload train.jsonl then create job
// Usage: php fine_tune.php

function load_env($path = ".env"): void {
  if (!file_exists($path)) return;
  foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
    $line = trim($line);
    if ($line === "" || str_starts_with($line, "#")) continue;
    $p = strpos($line, "=");
    if ($p === false) continue;
    $k = trim(substr($line, 0, $p));
    $v = trim(substr($line, $p + 1));
    $v = trim($v, "\"'");
    if (getenv($k) === false) putenv("$k=$v");
  }
}

function post_json(string $url, string $apiKey, array $payload): array {
  $ch = curl_init($url);
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => [
      "Authorization: Bearer $apiKey",
      "Content-Type: application/json"
    ],
    CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
  ]);
  $res = curl_exec($ch);
  $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);
  $json = json_decode($res, true);
  return [$code, $json ?: ["raw" => $res]];
}

load_env();

$apiKey = getenv("OPENAI_API_KEY");
$baseModel = getenv("FT_BASE_MODEL") ?: "gpt-4o-mini-2024-07-18"; // ✅ versioned by default
$trainPath = "./train.jsonl";

if (!$apiKey) { fwrite(STDERR, "❌ Missing OPENAI_API_KEY\n"); exit(1); }
if (!file_exists($trainPath)) { fwrite(STDERR, "❌ train.jsonl not found in current folder\n"); exit(1); }

// 1) Upload file (purpose = fine-tune)
$ch = curl_init("https://api.openai.com/v1/files");
curl_setopt_array($ch, [
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_POST => true,
  CURLOPT_HTTPHEADER => ["Authorization: Bearer $apiKey"],
  CURLOPT_POSTFIELDS => [
    "purpose" => "fine-tune",
    "file" => new CURLFile($trainPath, "text/plain", "train.jsonl"),
  ],
]);
$uploadRes = curl_exec($ch);
$uploadCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

$upload = json_decode($uploadRes, true) ?: ["raw" => $uploadRes];
if ($uploadCode < 200 || $uploadCode >= 300) {
  $msg = $upload["error"]["message"] ?? "Upload failed ($uploadCode)";
  fwrite(STDERR, "❌ $msg\n");
  exit(1);
}

$fileId = $upload["id"];
echo "✅ Uploaded file: $fileId\n";

// 2) Create fine-tuning job
[$jobCode, $job] = post_json("https://api.openai.com/v1/fine_tuning/jobs", $apiKey, [
  "model" => $baseModel,
  "training_file" => $fileId,
]);

if ($jobCode < 200 || $jobCode >= 300) {
  $msg = $job["error"]["message"] ?? "Create job failed ($jobCode)";
  fwrite(STDERR, "❌ $msg\n");
  exit(1);
}

echo "✅ Job: " . $job["id"] . " status: " . $job["status"] . "\n";
echo "ℹ️ When done, fine_tuned_model will appear in job.fine_tuned_model\n";
