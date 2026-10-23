#include <WiFi.h>
#include <HTTPClient.h>
#include <math.h>
#include <string.h>

#include "secrets.h"  // Local credentials; copy secrets.h.example first.

// Verify the exact JSN-SR04T hardware revision and mounting before changing
// these conservative prototype limits. These are distances, not water depths.
const float kMinDistanceCm = 25.0f;
const float kMaxDistanceCm = 450.0f;
const float kSoundSpeedCmPerUs = 0.0343f;  // Approximate speed at 20 C.
const unsigned long kEchoTimeoutUs = 30000UL;
const unsigned long kQuietTimeMs = 70UL;  // After every trigger/echo attempt.
const uint8_t kRequiredValidSamples = 3;
const uint8_t kMaxSampleAttempts = 5;

const unsigned long kSendIntervalMs = 2000UL;  // Target start-to-start cycle interval.
const unsigned long kWiFiConnectTimeoutMs = 12000UL;
const unsigned long kWiFiRetryIntervalMs = 2000UL;
const int kHttpConnectTimeoutMs = 2000;
const int kHttpReadTimeoutMs = 3000;

// Update this URL if the laptop's Android-hotspot IPv4 address changes.
const char* kTelemetryUrl = "http://10.170.154.37:8000/api/telemetry";

struct SensorConfig {
  const char* id;
  uint8_t trigPin;
  uint8_t echoPin;
};

struct SensorState {
  SensorConfig config;
  float latestValidDistanceCm;  // Retained for diagnostics only; never resent.
  bool hasLatestValid;
  bool currentValid;
  const char* error;
  uint8_t validSamples;
};

SensorState sensors[] = {
  {{"D1", 25, 26}, NAN, false, false, "NOT MEASURED", 0},
  {{"D2", 33, 32}, NAN, false, false, "NOT MEASURED", 0},
  {{"POND", 14, 27}, NAN, false, false, "NOT MEASURED", 0},
};

unsigned long lastCycleStartedMs = 0;
unsigned long lastTriggerFinishedMs = 0;
bool firstCycle = true;
bool hasTriggered = false;
bool wifiWasConnected = false;
bool credentialsConfigured = false;
bool wifiAttemptInProgress = false;
bool wifiEverAttempted = false;
unsigned long wifiAttemptStartedMs = 0;
unsigned long lastWiFiAttemptEndedMs = 0;

struct SampleResult {
  bool valid;
  float distanceCm;
  const char* error;
};

void waitForAcousticQuiet() {
  if (!hasTriggered) return;
  while (millis() - lastTriggerFinishedMs < kQuietTimeMs) {
    delay(1);
  }
}

SampleResult readSingleSample(const SensorConfig& sensor) {
  waitForAcousticQuiet();
  if (digitalRead(sensor.echoPin) == HIGH) {
    return {false, NAN, "ECHO STUCK HIGH"};
  }

  digitalWrite(sensor.trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(sensor.trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(sensor.trigPin, LOW);

  const unsigned long durationUs = pulseIn(sensor.echoPin, HIGH, kEchoTimeoutUs);
  lastTriggerFinishedMs = millis();
  hasTriggered = true;

  if (durationUs == 0) return {false, NAN, "ECHO TIMEOUT"};

  const float distanceCm = durationUs * kSoundSpeedCmPerUs / 2.0f;
  if (!isfinite(distanceCm)) return {false, NAN, "NON-FINITE DISTANCE"};
  if (distanceCm < kMinDistanceCm || distanceCm > kMaxDistanceCm) {
    return {false, NAN, "OUT OF VALID RANGE"};
  }
  return {true, distanceCm, "NONE"};
}

float medianOfThree(float a, float b, float c) {
  if (a > b) { const float temp = a; a = b; b = temp; }
  if (b > c) { const float temp = b; b = c; c = temp; }
  if (a > b) { const float temp = a; a = b; b = temp; }
  return b;
}

void measureSensor(SensorState& sensor) {
  sensor.currentValid = false;
  sensor.validSamples = 0;
  sensor.error = "INSUFFICIENT VALID SAMPLES";
  float samples[kRequiredValidSamples];
  const char* lastSampleError = "NONE";

  for (uint8_t attempt = 0;
       attempt < kMaxSampleAttempts && sensor.validSamples < kRequiredValidSamples;
       ++attempt) {
    const SampleResult sample = readSingleSample(sensor.config);
    if (sample.valid) {
      samples[sensor.validSamples++] = sample.distanceCm;
    } else {
      lastSampleError = sample.error;
    }
  }

  if (sensor.validSamples == kRequiredValidSamples) {
    sensor.latestValidDistanceCm = medianOfThree(samples[0], samples[1], samples[2]);
    sensor.hasLatestValid = true;
    sensor.currentValid = true;
    sensor.error = "NONE";
    Serial.print(sensor.config.id);
    Serial.print(": ");
    Serial.print(sensor.latestValidDistanceCm, 2);
    Serial.println(" cm [VALID; median of 3]");
  } else {
    sensor.error = sensor.validSamples == 0 ? lastSampleError : "INSUFFICIENT VALID SAMPLES";
    Serial.print(sensor.config.id);
    Serial.print(": INVALID - ");
    Serial.print(sensor.error);
    Serial.print(" (");
    Serial.print(sensor.validSamples);
    Serial.print("/3 valid samples; last error: ");
    Serial.print(lastSampleError);
    Serial.println(")");
  }
}

void startWiFiConnection() {
  Serial.print("Connecting to hotspot: ");
  Serial.println(WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  wifiAttemptStartedMs = millis();
  wifiAttemptInProgress = true;
  wifiEverAttempted = true;
}

bool ensureWiFiConnected() {
  if (!credentialsConfigured) return false;
  if (WiFi.status() == WL_CONNECTED) {
    if (!wifiWasConnected) {
      Serial.println("Wi-Fi connected.");
      Serial.print("ESP32 B IP address: ");
      Serial.println(WiFi.localIP());
    }
    wifiWasConnected = true;
    wifiAttemptInProgress = false;
    return true;
  }

  if (wifiWasConnected) Serial.println("Wi-Fi disconnected; reconnecting.");
  wifiWasConnected = false;
  if (wifiAttemptInProgress) {
    if (millis() - wifiAttemptStartedMs >= kWiFiConnectTimeoutMs) {
      Serial.println("Wi-Fi connection timed out; sensor monitoring continues.");
      wifiAttemptInProgress = false;
      lastWiFiAttemptEndedMs = millis();
    }
    return false;
  }
  if (!wifiEverAttempted ||
      millis() - lastWiFiAttemptEndedMs >= kWiFiRetryIntervalMs) {
    startWiFiConnection();
  }
  return false;
}

bool postCurrentReading(const SensorState& sensor) {
  if (!sensor.currentValid || !isfinite(sensor.latestValidDistanceCm)) return false;
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Wi-Fi lost; skipping telemetry until reconnection.");
    return false;
  }

  char payload[112];
  const int length = snprintf(
      payload, sizeof(payload),
      "{\"sensor_id\":\"%s\",\"distance_cm\":%.2f,\"simulated\":false}",
      sensor.config.id, sensor.latestValidDistanceCm);
  if (length < 0 || length >= static_cast<int>(sizeof(payload))) {
    Serial.println("Could not format telemetry JSON; measurement not sent.");
    return false;
  }

  WiFiClient client;
  HTTPClient http;
  if (!http.begin(client, kTelemetryUrl)) {
    Serial.println("POST /api/telemetry: could not start HTTP request.");
    return false;
  }
  http.setConnectTimeout(kHttpConnectTimeoutMs);
  http.setTimeout(kHttpReadTimeoutMs);
  http.addHeader("Content-Type", "application/json");

  const int statusCode = http.POST(String(payload));
  Serial.print("POST ");
  Serial.print(sensor.config.id);
  Serial.print(" ");
  Serial.print(sensor.latestValidDistanceCm, 2);
  Serial.print(" cm -> HTTP ");
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

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println();
  Serial.println("ClimateTwin AI - ESP32 B real ultrasonic sensors");
  Serial.println("Distances are uncalibrated; no pump control is present.");

  for (SensorState& sensor : sensors) {
    pinMode(sensor.config.trigPin, OUTPUT);
    digitalWrite(sensor.config.trigPin, LOW);
    pinMode(sensor.config.echoPin, INPUT);
  }

  credentialsConfigured = WIFI_SSID[0] != '\0' && WIFI_PASSWORD[0] != '\0' &&
      strcmp(WIFI_PASSWORD, "REPLACE_WITH_YOUR_HOTSPOT_PASSWORD") != 0;
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  if (credentialsConfigured) {
    startWiFiConnection();
  } else {
    Serial.println("Configure secrets.h to enable Wi-Fi; sensors will still be read.");
  }
}

void loop() {
  const unsigned long nowMs = millis();
  if (!firstCycle && nowMs - lastCycleStartedMs < kSendIntervalMs) {
    delay(5);
    return;
  }
  const bool hadPreviousCycle = !firstCycle;
  const unsigned long startGapMs = nowMs - lastCycleStartedMs;
  firstCycle = false;
  lastCycleStartedMs = nowMs;
  Serial.println("--- Measurement cycle ---");

  const unsigned long acquisitionStartedMs = millis();
  for (SensorState& sensor : sensors) measureSensor(sensor);
  const unsigned long acquisitionMs = millis() - acquisitionStartedMs;

  if (ensureWiFiConnected()) {
    bool allValidReadingsPosted = true;
    for (const SensorState& sensor : sensors) {
      if (!sensor.currentValid) {
        Serial.print("SKIP ");
        Serial.print(sensor.config.id);
        Serial.println(": invalid current measurement; no old value sent.");
        allValidReadingsPosted = false;
        continue;
      }
      if (!postCurrentReading(sensor)) {
        allValidReadingsPosted = false;
        Serial.println("POST failed; remaining channels retry next cycle.");
        break;
      }
    }
    if (allValidReadingsPosted) {
      Serial.println("REAL SENSOR TELEMETRY TRANSMITTED");
    }
  } else {
    Serial.println("Telemetry deferred: Wi-Fi unavailable; no readings queued.");
  }

  const unsigned long totalCycleMs = millis() - nowMs;
  Serial.print("Cycle timing: acquisition=");
  Serial.print(acquisitionMs);
  Serial.print(" ms, total=");
  Serial.print(totalCycleMs);
  Serial.print(" ms, start-to-start=");
  if (hadPreviousCycle) Serial.print(startGapMs);
  else Serial.print("n/a");
  Serial.println(" ms");
  if (totalCycleMs > kSendIntervalMs) {
    Serial.println("Cycle exceeds 2 s target; next cycle starts only after this one finishes.");
  }
}
