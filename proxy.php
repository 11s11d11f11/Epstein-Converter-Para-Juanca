<?php
// proxy.php - Proxy stealth simplificado
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");
header("Content-Type: application/json");

// Manejar preflight OPTIONS
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// Recibimos los datos del index.html
$input = json_decode(file_get_contents("php://input"), true);

if (!isset($input['url'])) {
    http_response_code(400);
    echo json_encode(["status" => "error", "text" => "No URL provided"]);
    exit;
}

// Instancias abiertas - sin la oficial que banea
$cobalt_instances = [
    'https://cobalt.perennialte.ch/api/json',
    'https://cobalt.hypert.net/api/json',
    'https://co.e96.one/api/json'
];

$payload = json_encode([
    'url' => $input['url'],
    'videoQuality' => '720',
    'downloadMode' => $input['downloadMode'] ?? 'auto',
    'audioFormat' => 'mp3',
    'filenamePattern' => 'basic'
]);

// User-Agent simple (sin cosas raras)
$userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];
$randomUA = $userAgents[array_rand($userAgents)];

$lastError = null;

// Intentar cada instancia
foreach ($cobalt_instances as $cobalt_api) {
    $ch = curl_init($cobalt_api);
    
    // SOLO headers basicos - sin Sec-Fetch que delatan servidor
    $headers = [
        'Accept: application/json',
        'Content-Type: application/json',
        'User-Agent: ' . $randomUA,
        'Origin: https://cobalt.tools',
        'Referer: https://cobalt.tools/'
    ];
    
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $payload,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    // Si funciono, devolver respuesta
    if ($httpCode >= 200 && $httpCode < 300 && $response) {
        echo $response;
        exit;
    }
    
    $lastError = "$cobalt_api -> HTTP $httpCode";
}

// Si ninguna funciono
http_response_code(503);
echo json_encode([
    "status" => "error", 
    "text" => "All instances blocked. Try again or use different hosting."
]);
?>
