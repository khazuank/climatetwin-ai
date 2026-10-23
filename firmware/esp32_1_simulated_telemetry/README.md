# ESP32 #1 simulated telemetry test

Open `esp32_1_simulated_telemetry.ino` in Arduino IDE. The sketch tests Wi-Fi,
`GET /health`, and three `POST /api/telemetry` requests every 10 seconds for
`D1`, `D2`, and `POND`. All sent values are arbitrary simulated centimetre
values. No ultrasonic sensors or pumps are used.

## Configure locally

1. In File Explorer, copy `secrets.h.example` in this folder and rename the copy
   to `secrets.h`.
2. In `secrets.h`, confirm `WIFI_SSID` is your Android hotspot's current SSID and
   replace `REPLACE_WITH_YOUR_HOTSPOT_PASSWORD` with the actual password. Never
   share or commit `secrets.h`; this folder's `.gitignore` excludes it.
3. If the laptop hotspot IPv4 address changes, update `kHealthUrl` and
   `kTelemetryUrl` in the `.ino` file. The current address is
   `10.170.154.37`, and FastAPI uses port `8000`.
4. Keep FastAPI running with `--host 0.0.0.0 --port 8000` and keep the ESP32
   and laptop on the same hotspot.

The example distances are `12.3`, `18.4`, and `25.0` cm. They are synthetic
test values, not physical sensor measurements. `simulated` is always `true`.

## Upload and watch

1. Connect ESP32 #1 by USB and open the `.ino` sketch in Arduino IDE.
2. Under **Tools > Board**, select the board that matches your ESP32. If the
   exact model is unknown, use **ESP32 Dev Module** from the installed ESP32
   board package.
3. Under **Tools > Port**, select **COM3** if that is the ESP32's current port;
   otherwise select the detected ESP32 COM port.
4. Click **Verify**, then **Upload**. If your board requires it, hold **BOOT**
   while upload begins and release it once the transfer starts.
5. Open **Tools > Serial Monitor** and set **115200 baud**.

Expected successful output includes:

```text
ClimateTwin AI ESP32 #1 - SIMULATED telemetry test
Wi-Fi connected.
ESP32 IP address: <address assigned by hotspot>
GET /health -> HTTP status: 200
Response body: {"status":"ok"}
SIMULATED POST payload: {"sensor_id":"D1","distance_cm":12.3,"simulated":true}
POST D1 -> HTTP status: 200
Response body: {"status":"accepted","reading":{...}}
POST D2 -> HTTP status: 200
POST POND -> HTTP status: 200
```

The backend adds the actual `received_at_utc` timestamp to each accepted
response. If Wi-Fi disconnects, the sketch attempts to reconnect on the next
cycle. A failed health check skips telemetry until the next cycle. HTTP
failures and their response bodies or network error messages print to Serial
Monitor.

## Verify in FastAPI

The FastAPI terminal should print a `telemetry` line for each of D1, D2, and
POND with `simulated=True`. In a PowerShell window, run:

```powershell
Invoke-RestMethod -Uri 'http://10.170.154.37:8000/api/telemetry/latest' | ConvertTo-Json -Depth 5
```

Check `readings.D1`, `readings.D2`, and `readings.POND`. Each should contain
its example `distance_cm`, `simulated: true`, and a recent server-generated
`received_at_utc`. The website on port 3000 is separate from this test.
