# ClimateTwin AI Management demo video

The MP4 is a seven-scene recording of the real local website at 1920×1080.
`record.mjs` uses Playwright and the installed Chrome browser to sign in, select
map features, show trained forecasts, run the guided storm, capture actual road
closures, compare pump responses, and operate virtual P2 when the backend allows
it. It never writes a password or session cookie to a project file. Raw video,
audio clips and browser probe images are in ignored `raw/` and `tmp/` folders.

The narration uses free Edge neural TTS (`en-GB-SoniaNeural`). `edit.mjs` uses
FFmpeg to time the seven scenes to 90 seconds, mix narration, burn English
subtitles, and export H.264 video with AAC audio. No application code is
changed by these scripts. All data shown comes from the running synthetic demo.

## Regenerate

Start FastAPI and Next.js as documented in `../backend/README.md` and
`../frontend/README.md`. Then run from this folder in PowerShell:

```powershell
npm.cmd install
npx.cmd playwright install ffmpeg
py -3.14 -m venv .venv
.\.venv\Scripts\python.exe -m pip install edge-tts
.\.venv\Scripts\python.exe make_voiceover.py
$secure = Read-Host 'Management password' -AsSecureString
$env:CLIMATETWIN_DEMO_PASSWORD = [System.Net.NetworkCredential]::new('', $secure).Password
try { npm.cmd run record } finally { Remove-Item Env:CLIMATETWIN_DEMO_PASSWORD -ErrorAction SilentlyContinue }
npm.cmd run edit
```

The script reads the username from `../backend/.env`. The password exists only
in the process environment while recording and is entered into the site's
masked password input. Do not use a production account for this video.

Open `ClimateTwin_Management_Demo_90s.mp4` in a video player. The text script
and SRT captions are alongside it. `final_probe.json` holds FFprobe metadata.
To inspect an old backend before starting another, use
`Get-NetTCPConnection -State Listen -LocalPort 8000` and confirm its owning PID.
