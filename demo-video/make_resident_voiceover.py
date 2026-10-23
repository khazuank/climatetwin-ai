"""Same provider, voice and rate as make_voiceover.py; portrait caption layout."""
import asyncio
import json
import textwrap
from pathlib import Path
import edge_tts
from make_voiceover import timestamp, media_duration

ROOT = Path(__file__).resolve().parent
VOICE = "en-GB-SoniaNeural"
RATE = "+7%"

async def main():
    segments = json.loads((ROOT / "resident-narration.json").read_text(encoding="utf-8"))
    raw = ROOT / "raw" / "resident"
    raw.mkdir(parents=True, exist_ok=True)
    captions, lines, durations = [], [f"ClimateTwin AI — Resident Safety\nMicrosoft Edge TTS | {VOICE} | rate {RATE}\n"], []
    for number, segment in enumerate(segments, 1):
        target = raw / f"voice_{number:02}.mp3"
        if not target.exists():
            await edge_tts.Communicate(segment["text"], VOICE, rate=RATE).save(str(target))
        duration = media_duration(target)
        if duration > segment["end"] - segment["start"] - .25:
            raise ValueError(f"Scene {number} narration does not fit: {duration:.2f}s")
        durations.append({"scene": number, "duration": duration})
        print(f"Scene {number}: {duration:.2f}s", flush=True)
        lines.append(f"{timestamp(segment['start'])}–{timestamp(segment['end'])}  {segment['text']}")
        phrases = textwrap.wrap(segment["text"], width=37, break_long_words=False)
        start = segment["start"] + .25
        end = start + duration - .1
        total = sum(map(len, phrases))
        cursor = start
        for i, phrase in enumerate(phrases):
            finish = end if i == len(phrases) - 1 else cursor + (end - start) * len(phrase) / total
            captions.append(f"{len(captions)+1}\n{timestamp(cursor)} --> {timestamp(finish)}\n{phrase}\n")
            cursor = finish
    (ROOT / "resident_voiceover.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (ROOT / "resident_subtitles.srt").write_text("\n".join(captions), encoding="utf-8")
    (raw / "voice-durations.json").write_text(json.dumps(durations, indent=2), encoding="utf-8")

if __name__ == "__main__":
    asyncio.run(main())
