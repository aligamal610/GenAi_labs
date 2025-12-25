<?php
// PHP Native Reminder Agent (no frameworks)
// Usage examples:
//   php reminder_agent.php --in 5 "submit the lab"
//   php reminder_agent.php "Please remind me in 5 minutes to submit the lab."

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

function smtp_read($fp): string {
  $data = "";
  while (!feof($fp)) {
    $line = fgets($fp, 515);
    if ($line === false) break;
    $data .= $line;
    // multi-line ends when 4th char is space
    if (strlen($line) >= 4 && $line[3] === ' ') break;
  }
  return $data;
}

function smtp_send($fp, string $cmd): void {
  fwrite($fp, $cmd . "\r\n");
}

function smtp_expect_ok(string $resp, array $okPrefixes): void {
  foreach ($okPrefixes as $pfx) {
    if (str_starts_with($resp, $pfx)) return;
  }
  throw new Exception("SMTP unexpected response: " . trim($resp));
}

function smtp_send_mail_starttls(
  string $host,
  int $port,
  string $user,
  string $pass,
  string $to,
  string $subject,
  string $body
): void {
  $fp = stream_socket_client("tcp://{$host}:{$port}", $errno, $errstr, 20);
  if (!$fp) throw new Exception("SMTP connect failed: $errstr");

  $banner = smtp_read($fp);
  smtp_expect_ok($banner, ["220"]);

  smtp_send($fp, "EHLO localhost");
  $ehlo = smtp_read($fp);
  smtp_expect_ok($ehlo, ["250"]);

  // STARTTLS
  smtp_send($fp, "STARTTLS");
  $st = smtp_read($fp);
  smtp_expect_ok($st, ["220"]);

  $cryptoOk = stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT);
  if ($cryptoOk !== true) throw new Exception("Failed to enable TLS.");

  // EHLO again after TLS
  smtp_send($fp, "EHLO localhost");
  $ehlo2 = smtp_read($fp);
  smtp_expect_ok($ehlo2, ["250"]);

  // AUTH LOGIN
  smtp_send($fp, "AUTH LOGIN");
  smtp_expect_ok(smtp_read($fp), ["334"]);

  smtp_send($fp, base64_encode($user));
  smtp_expect_ok(smtp_read($fp), ["334"]);

  smtp_send($fp, base64_encode($pass));
  $authResp = smtp_read($fp);
  smtp_expect_ok($authResp, ["235"]);

  smtp_send($fp, "MAIL FROM:<$user>");
  smtp_expect_ok(smtp_read($fp), ["250"]);

  smtp_send($fp, "RCPT TO:<$to>");
  smtp_expect_ok(smtp_read($fp), ["250", "251"]);

  smtp_send($fp, "DATA");
  smtp_expect_ok(smtp_read($fp), ["354"]);

  $msg =
    "From: <$user>\r\n" .
    "To: <$to>\r\n" .
    "Subject: $subject\r\n" .
    "MIME-Version: 1.0\r\n" .
    "Content-Type: text/plain; charset=utf-8\r\n\r\n" .
    $body . "\r\n.\r\n";

  fwrite($fp, $msg);
  smtp_expect_ok(smtp_read($fp), ["250"]);

  smtp_send($fp, "QUIT");
  fclose($fp);
}

function parse_minutes_from_text(string $text): ?int {
  // supports: "in 5 minutes", "in 1 minute", "after 10 min", "5 mins"
  if (preg_match('/\bin\s+(\d+)\s*(minute|minutes|min|mins)\b/i', $text, $m)) return (int)$m[1];
  if (preg_match('/\bafter\s+(\d+)\s*(minute|minutes|min|mins)\b/i', $text, $m)) return (int)$m[1];
  return null;
}

function extract_task(string $text): string {
  // try: "... to <task>"
  if (preg_match('/\bto\s+(.+)$/i', $text, $m)) return trim($m[1]);
  return trim($text);
}

load_env();

$apiKey = getenv("OPENAI_API_KEY");
$host  = getenv("SMTP_HOST");
$port  = (int)(getenv("SMTP_PORT") ?: 587);
$user  = getenv("SMTP_USER");
$pass  = getenv("SMTP_PASS");
$to    = getenv("REMINDER_TO") ?: $user;

if (!$apiKey) { fwrite(STDERR, "❌ Missing OPENAI_API_KEY\n"); exit(1); }
if (!$host || !$user || !$pass || !$to) { fwrite(STDERR, "❌ Missing SMTP_* or REMINDER_TO in .env\n"); exit(1); }

$args = $argv;
array_shift($args);

$minutes = null;
$rawText = "";

if (count($args) >= 2 && $args[0] === "--in") {
  $minutes = (int)$args[1];
  $rawText = implode(" ", array_slice($args, 2));
} else {
  $rawText = implode(" ", $args);
  $minutes = parse_minutes_from_text($rawText);
}

if ($minutes === null) $minutes = 5; // default to 5 minutes (so it always works)

$task = extract_task($rawText ?: "submit the lab");
$sendAt = time() + ($minutes * 60);
$sendAtISO = gmdate("Y-m-d\TH:i:s\Z", $sendAt);

echo "✅ Reminder prepared\n";
echo "To: $to\n";
echo "In: {$minutes} minute(s)\n";
echo "SendAt(UTC): $sendAtISO\n";
echo "Task: $task\n\n";

$subject = "Reminder";
$body = "Task: $task\nTime(UTC): $sendAtISO\n";

sleep($minutes * 60);

try {
  smtp_send_mail_starttls($host, $port, $user, $pass, $to, $subject, $body);
  echo "✅ Email sent to $to\n";
} catch (Throwable $e) {
  fwrite(STDERR, "❌ Email failed: " . $e->getMessage() . "\n");
  exit(1);
}
