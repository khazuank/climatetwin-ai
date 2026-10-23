#include <WiFi.h>
#include <HTTPClient.h>

#include "secrets.h"  // Local file; copy secrets.h.example and fill in the password.

// These are arbitrary test values, not measurements from attached sensors.
struct SimulatedReading {
  const char* sensorId;
  float distanceCm;
};

const SimulatedReading kReadings[] = {
  {"D1", 12.3f},
  {"D2", 18.4f},
  {"POND", 25.0f},
};

const char* kHealthUrl = "http://10.170.154.37:8000/health";
const char* kTelemetryUrl = "http://10.170.154.37:8000/api/telemetry";

const unsigned long kSendIntervalMs = 10000;
const unsigned long kWiFiConnectTimeoutMs = 12000;
const int kHttpConnectTimeoutMs = 3000;
const int kHttpReadTimeoutMs = 5000;

unsigned long lastCycleStartedMs = 0;
bool firstCycle = true;

bool ensureWiFiConnected() {
  if (WiFi.status() == WL_CONNECTED) {
    return true;
  }

  Serial.print("Wi-Fi disconnected. Connecting to ");
  Serial.println(WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  const unsigned long startedMs = millis();
  while (WiFi.status() != WL_CONNECTED &&
         millis() - startedMs < kWiFiConnectTimeoutMs) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Wi-Fi connection timed out; will retry next cycle.");
    return false;
  }

  Serial.println("Wi-Fi connected.");
  Serial.print("ESP32 IP address: ");
  Serial.println(WiFi.localIP());
  return true;
}

bool checkBackendHealth() {
  WiFiClient client;
  HTTPClient http;
  if (!http.begin(client, kHealthUrl)) {
    Serial.println("GET /health: could not start HTTP request.");
    return false;
  }

  http.setConnectTimeout(kHttpConnectTimeoutMs);
  http.setTimeout(kHttpReadTimeoutMs);
  const int statusCode = http.GET();
  Serial.print("GET /health -> HTTP status: ");
  Serial.println(statusCode);
  if (statusCode > 0) {
    Serial.print("Response body: ");
    Serial.println(http.getString());
  } else {
    Serial.print("HTTP error: ");
    Serial.println(http.errorToString(statusCode));
  }
  http.end();
  return statusCode == 200;
}

void postSimulatedReading(const SimulatedReading& reading) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Wi-Fi lost; skipping remaining telemetry this cycle.");
    return;
  }

  char payload[96];
  const int payloadLength = snprintf(
      payload, sizeof(payload),
      "{\"sensor_id\":\"%s\",\"distance_cm\":%.1f,\"simulated\":true}",
      reading.sensorId, reading.distanceCm);
  if (payloadLength < 0 || payloadLength >= static_cast<int>(sizeof(payload))) {
    Serial.println("Could not format telemetry JSON.");
    return;
  }

  WiFiClient client;
  HTTPClient http;
  if (!http.begin(client, kTelemetryUrl)) {
    Serial.println("POST /api/telemetry: could not start HTTP request.");
    return;
  }

  http.setConnectTimeout(kHttpConnectTimeoutMs);
  http.setTimeout(kHttpReadTimeoutMs);
  http.addHeader("Content-Type", "application/json");

  Serial.print("SIMULATED POST payload: ");
  Serial.println(payload);
  const int statusCode = http.POST(String(payload));
  Serial.print("POST ");
  Serial.print(reading.sensorId);
  Serial.print(" -> HTTP status: ");
  Serial.println(statusCode);
  if (statusCode > 0) {
    Serial.print("Response body: ");
    Serial.println(http.getString());
  } else {
    Serial.print("HTTP error: ");
    Serial.println(http.errorToString(statusCode));
  }
  http.end();
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println();
  Serial.println("ClimateTwin AI ESP32 #1 - SIMULATED telemetry test");
  Serial.println("No physical ultrasonic sensors are connected.");

  if (String(WIFI_PASSWORD) == "REPLACE_WITH_YOUR_HOTSPOT_PASSWORD") {
    Serial.println("Set WIFI_PASSWORD in the local secrets.h file first.");
    while (true) {
      delay(1000);
    }
  }

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
}

void loop() {
  const unsigned long nowMs = millis();
  if (!firstCycle && nowMs - lastCycleStartedMs < kSendIntervalMs) {
    delay(50);
    return;
  }
  firstCycle = false;
  lastCycleStartedMs = nowMs;

  if (!ensureWiFiConnected()) {
    return;
  }
  if (!checkBackendHealth()) {
    Serial.println("Backend health check failed; telemetry will retry next cycle.");
    return;
  }

  for (const SimulatedReading& reading : kReadings) {
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("Wi-Fi lost; remaining readings will retry next cycle.");
      break;
    }
    postSimulatedReading(reading);
  }
}
