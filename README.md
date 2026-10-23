# ClimateTwin AI

A synthetic township flood digital twin for a hackathon demonstration. FastAPI runs the shared simulation and trained forecast model; Next.js provides management and resident views. The repository also includes optional ESP32 firmware prototypes and two finished demo videos.

All water levels, forecasts, warnings, roads, shelters, and routes are illustrative simulation output. They are not validated flood warnings or evacuation guidance.

## Run locally

Use two PowerShell windows. First, set up the backend and create a local Management account:

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe setup_management.py your-management-name
.\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000
```

Then start the frontend in the other window:

```powershell
cd frontend
npm ci
npm run dev
```

Open <http://localhost:3000>. The Resident Safety view is public; the Management dashboard uses the local account configured above. Run one backend worker because the simulation state lives in memory.

## Project folders

- [Frontend](frontend/README.md): Next.js interface, architecture, and tests.
- [Backend](backend/README.md): FastAPI simulation, model, and Management setup.
- [Demo videos](demo-video/README.md): finished recordings and regeneration steps.
- [Firmware](firmware/): optional sensor prototypes, separate from the active synthetic demo.

Local credentials and firmware `secrets.h` files are excluded from Git. Copy the provided `secrets.h.example` files when working with firmware.
