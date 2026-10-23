# ClimateTwin AI — ESP32 B physical ultrasonic telemetry

This separate Arduino IDE sketch reads three JSN-SR04T ultrasonic sensors and
posts **current, valid physical distances** to the existing FastAPI backend.
It does not control pumps, estimate water depth, or calculate flood risk. The
original simulated telemetry sketch remains available in its own folder.

## Wiring and safety

| Channel | FastAPI `sensor_id` | TRIG output | ECHO input |
| --- | --- | ---: | ---: |
| Drain D1 | `D1` | GPIO 25 | GPIO 26 |
| Drain D2 | `D2` | GPIO 33 | GPIO 32 |
| Retention Pond | `POND` | GPIO 14 | GPIO 27 |

- Power **each** JSN-SR04T from an appropriate, stable 5 V supply. Check the
  exact module revision's voltage and current requirements and ensure the
  supply can power all three. Connect every sensor ground to ESP32 ground.
- **Each ECHO output needs a voltage divider or logic-level shifter** before
  its ESP32 input. ESP32 GPIO is not 5 V tolerant. For a nominal 5 V ECHO,
  a 10 kΩ resistor from ECHO to the ESP32 input and a 15 kΩ resistor from
  that input to ground gives about 3 V at the GPIO. Verify the real voltages
  and wiring before attaching the ESP32. A suitable level shifter is also fine.
- TRIG goes from the listed ESP32 output to the matching sensor's TRIG input.
  Do not connect any pump, relay, or electrical load to this board or sketch.
- Mount the sensors where splash, obstructions, condensation, and temperature
  can be evaluated safely. This prototype's numbers are **sensor-to-target
  distance**, not water depth. Mounting geometry and calibration are required
  before deriving depth or fill percentage.

## Configuration

1. In File Explorer, copy `secrets.h.example` to `secrets.h` in this folder.
   Set `WIFI_PASSWORD` in the local copy. The example SSID is
   `Galaxy A15 5G D769`; change `WIFI_SSID` locally if the hotspot name changes.
   `.gitignore` excludes `secrets.h`.
2. Confirm the laptop's Android-hotspot IPv4 address. The sketch currently uses
   `10.170.154.37` and FastAPI port `8000`. If the address changes, edit
   `kTelemetryUrl` in the `.ino` file. Do not point the sketch
   at the Next.js website on port 3000.
3. Confirm the exact JSN-SR04T hardware revision and its rated measurement
   range. `kMinDistanceCm = 25` and `kMaxDistanceCm = 450` are **conservative
   starting limits**, not a claim that every JSN-SR04T version works across
   that range. Change these only after checking the module and real mounting.

| Setting in `.ino` | Initial value | Meaning |
| --- | ---: | --- |
| `kMinDistanceCm`, `kMaxDistanceCm` | 25, 450 cm | Accepted nominal distance window; readings outside it are invalid. |
| `kSoundSpeedCmPerUs` | 0.0343 cm/µs | Approximate sound speed near 20 °C; no temperature compensation. |
| `kEchoTimeoutUs` | 30,000 µs | Finite `pulseIn` timeout, preventing an absent ECHO from hanging forever. |
| `kQuietTimeMs` | 70 ms | Minimum quiet period **after** each trigger/echo attempt before any next trigger. |
| `kRequiredValidSamples` | 3 | Number of valid samples used for the median. |
| `kMaxSampleAttempts` | 5 | Maximum tries per channel to obtain those three valid samples. |
| `kSendIntervalMs` | 2,000 ms | Target start-to-start cycle interval; a longer cycle is never overlapped. |
| `kWiFiConnectTimeoutMs` | 12,000 ms | Nonblocking Wi-Fi connection-attempt window. |
| `kWiFiRetryIntervalMs` | 2,000 ms | Delay after a timed-out Wi-Fi attempt before retrying. |
| `kHttpConnectTimeoutMs` | 2,000 ms | HTTP connection timeout. |
| `kHttpReadTimeoutMs` | 3,000 ms | HTTP response timeout. |

All TRIG pins start LOW. The sensors are triggered sequentially, with at least
70 ms of quiet time after each pulse/echo attempt. A sample is accepted only
when ECHO completes before the timeout and the calculated distance is finite
and within the configured range. Each channel uses the median of three valid
samples from at most five attempts. If it has fewer than three, the **current
measurement is invalid**. The last valid distance stays in memory for
diagnostics but is never posted again as a new measurement.

The sketch no longer sends a separate health request every cycle; the three
telemetry POST responses provide backend diagnostics. A normal cycle starts
about every two seconds. The Serial Monitor reports acquisition time, complete
cycle time, and observed start-to-start spacing. Nine valid triggers need at
least eight 70 ms quiet gaps (560 ms), plus echo travel time. At the far end
of the configured range, acquisition can approach 0.8 seconds. Fifteen
attempts can take roughly 1.4 seconds before HTTP overhead. The real total
depends on target distance, invalid attempts, hotspot and backend latency.
If a cycle exceeds two seconds, the next begins **after** it finishes; sensor
timing is never shortened to catch up. Wi-Fi reconnection is nonblocking;
HTTP operations still have finite connection and read timeouts.

The original 10-second sketch was copied unchanged to
`backup/esp32_b_real_sensors_10s.ino.txt` before this update. To roll back,
copy that file's contents over `esp32_b_real_sensors.ino` in Arduino IDE,
verify, and upload to ESP32 B. Keep the same local `secrets.h`.

## Upload with Arduino IDE

1. Keep the already working FastAPI service available on the laptop. Its
   `/health` and `/api/telemetry` endpoints must be reachable over the hotspot.
2. Connect **ESP32 B** by USB. Keep ESP32 A, reserved for future pumps, aside.
3. Open `esp32_b_real_sensors.ino` from this folder in Arduino IDE. Ensure your
   local `secrets.h` is beside the `.ino` file.
4. In **Tools → Board**, select the exact installed ESP32 board model. If the
   model is unknown, `ESP32 Dev Module` from the existing ESP32 board package
   is a starting selection; verify it against the actual board before upload.
   The sketch uses `WiFi.h` and `HTTPClient.h` from that board package; no
   additional Arduino libraries are required.
5. In **Tools → Port**, select the COM port shown for **ESP32 B**. Do not assume
   a fixed COM number. Click **Verify**, then **Upload**. If this board requires
   manual boot mode, hold **BOOT** as upload starts and release it once the
   transfer begins.
6. Open **Tools → Serial Monitor** at **115200 baud**. Reset ESP32 B if needed
   to see startup and connection messages.

Expected output uses real measurements, so its numbers will differ:

```text
ClimateTwin AI - ESP32 B real ultrasonic sensors
Connecting to hotspot: Galaxy A15 5G D769
D1: <measured distance> cm [VALID; median of 3]
D2: <measured distance> cm [VALID; median of 3]
POND: <measured distance> cm [VALID; median of 3]
Wi-Fi connected.
ESP32 B IP address: <address assigned by hotspot>
POST D1 <measured distance> cm -> HTTP 200
Response body: {"status":"accepted","reading":{...}}
REAL SENSOR TELEMETRY TRANSMITTED
Cycle timing: acquisition=<milliseconds> ms, total=<milliseconds> ms, start-to-start=<milliseconds> ms
```

When a sensor fails, Serial Monitor reports the channel and reason, for
example `D1: INVALID - ECHO TIMEOUT (0/3 valid samples; last error: ECHO
TIMEOUT)`, followed by `SKIP D1`. No zero or previous distance is posted.
Wi-Fi and HTTP errors are logged, then retried on subsequent cycles without
resetting sensor state. Wi-Fi connection attempts do not block sensor
acquisition. A slow HTTP request can lengthen a cycle beyond two seconds;
the timing line exposes this rather than hiding the delay.

## End-to-end test plan

1. **Boot:** Confirm the startup banner and three channel diagnostics at
   115200 baud. Even without Wi-Fi, sensor monitoring must continue.
2. **Hotspot:** Confirm `Wi-Fi connected` and an ESP32 B IP address. Disconnect
   and restore the hotspot later to test reconnection.
3. **D1:** Put a suitable target within the verified valid range; confirm a
   valid D1 distance and `POST D1 <distance> cm -> HTTP 200`.
4. **D2:** Repeat for D2 and confirm its separate ID and POST.
5. **POND:** Repeat for the retention pond sensor and confirm `POND`.
6. **Motion:** Move a target within the valid range and confirm the distance
   changes. Do not interpret that change as water-depth calibration.
7. **FastAPI:** Check the backend terminal for D1, D2, POND entries with
   `simulated=False`. Optionally inspect the latest response in PowerShell:

   ```powershell
   Invoke-RestMethod 'http://10.170.154.37:8000/api/telemetry/latest' | ConvertTo-Json -Depth 5
   ```

8. **Website:** In ClimateTwin AI at `http://localhost:3000`, choose **ESP32
   Test** and confirm three updated distances, physical sensor readings shown
   as uncalibrated, and recent UTC timestamps. In browser DevTools → Network,
   filter `telemetry/latest`; successful GETs should start about one second
   apart and never overlap. The software storm and pump simulation remains a
   separate mode.
9. **Sensor failure:** Disconnect one sensor only while powered off, then
   power on and check `INVALID`/`SKIP` for that channel. Its backend value may
   remain temporarily as the last accepted reading; the frontend should mark
   it stale after about 10 seconds. It must never become a fabricated zero.
10. **Wi-Fi recovery:** Disable the hotspot, observe finite connection timeout
    and continued measurement, then restore it. Confirm new HTTP 200 POSTs
    without rebooting the firmware.

For the update-rate check, compare several `start-to-start` values in Serial
Monitor. A healthy system should be near 2,000 ms; if `total` consistently
exceeds 2,000 ms, use that observed start-to-start spacing as the achievable
rate and investigate invalid samples or HTTP latency. Move a target near D1,
then D2 and POND, checking that each changes independently. Restart FastAPI
and confirm HTTP errors followed by new HTTP 200 posts and fresh website
timestamps. Switch to Simulation and exercise storm, pump, map, and chart
controls to confirm the separate scenario remains intact.

The FastAPI store is in memory and keeps only the last successful reading for
each channel. Its timestamp is assigned by the backend. If a channel stops
posting, freshness must be judged from that timestamp, not from a health
check or the existence of an old value. Physical sensor reliability and
calibration still require on-site validation.
