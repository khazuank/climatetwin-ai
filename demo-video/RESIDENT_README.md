# ClimateTwin AI — Resident Safety video

Finished output: `ClimateTwin_Resident_Demo_45s.mp4`.

## Format and narration

- 45.000 seconds, 1080 × 1920 portrait, 30 fps, H.264 with AAC audio.
- Actual mobile browser viewport: 390 × 640, touch enabled. Footage is scaled
  proportionally onto a branded background, with no desktop crop or stretching.
- Same free Microsoft Edge neural TTS configuration as the Management video:
  `en-GB-SoniaNeural`, British English female, rate `+7%`, default pitch/volume.
  Both videos use FFmpeg loudness normalization targeting -16 LUFS and -1.5 dBTP,
  with AAC at 192 kb/s. No music.
- White Arial English captions on a navy band outside the application UI.
  `resident_voiceover.txt`, `resident_subtitles.srt` and `resident_overlays.ass`
  accompany the MP4.

## Captured scenes

| Time | Actual website footage |
| --- | --- |
| 0–5 s | Mobile welcome page, Continue as Resident, public entry |
| 5–12 s | H2 nearby flood conditions, normal/open roads |
| 12–22 s | Home selection, touch pan/recenter, H2–S1 blue route, 6.4 min / 477 m |
| 22–32 s | Hidden Management starts the guided storm; Resident polls automatically, warning changes, roads close and the route changes to 12.8 min / 939 m |
| 32–40 s | Existing blue D1, orange D2 and green POND cards, current levels and trained +10/+20 minute forecasts |
| 40–45 s | Return to the real map/route with the closing brand and tagline |

H2 is used because the supported storm visibly changes its route. The scenario
uses the application's supported 4× simulation speed; the longer live capture is
also condensed in the edit. Scene 4 is explicitly labelled **ACCELERATED
SIMULATION**. Road status, journeys, water values and ML predictions are never
fabricated or replaced by recording scripts. This is a synthetic township;
routes are illustrative and are not verified real evacuation guidance.

## Reproduce

Keep FastAPI on port 8000 and Next.js on port 3000. Use the existing application
startup instructions; the recording scripts do not start another server.
From this `demo-video` directory, with its existing dependencies installed:

```powershell
.\.venv\Scripts\python.exe make_resident_voiceover.py
$secure = Read-Host 'Management password' -AsSecureString
$env:CLIMATETWIN_DEMO_PASSWORD = [System.Net.NetworkCredential]::new('', $secure).Password
try { npm.cmd run resident:record } finally { Remove-Item Env:CLIMATETWIN_DEMO_PASSWORD -ErrorAction SilentlyContinue }
npm.cmd run resident:edit
npm.cmd run resident:verify
```

For an optional rehearsal, run `npm.cmd run resident:rehearse` while the temporary
password variable is set. The username is read from `../backend/.env`. The password
is not written to a file. Management authentication and cookies remain only in an
unrecorded browser context; the Resident context has no authentication cookies.

Recording resets the shared local simulation, runs its existing guided scenario,
and leaves it paused after the captured closures. Avoid simultaneous manual
simulation changes while recording. The scripts do not alter application source,
simulation math, model files, routing, pump logic or authentication.

For a fresh tools install, see `README.md` for npm, Playwright recording FFmpeg,
Python virtual environment and `edge-tts` setup. Chrome must be installed.
TTS generation needs internet access; previously generated audio is cached in
ignored `raw/resident/`. Delete only the relevant cached voice clip when changing
narration. Subsequent video editing can run offline.

## Verification and evidence

`resident_final_probe.json` contains basic FFprobe properties.
`resident_verification.json` contains the full-decode result, audio levels, format
checks and captured route/forecast facts. `raw/resident/marks.json` preserves
scene timings, real public polling evidence and browser error checks, without
session cookies or passwords. Visual review frames are in the same ignored folder.

The capture has a 390 px source width, so small interface text has the detail of
the mobile website rather than native 1080 px typography. Browser recording is
resampled to 30 fps; storm footage is intentionally accelerated. The footage is
a local synthetic demonstration, not a live emergency service.
