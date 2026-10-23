"""Generate neural English speech and timed captions from narration.json."""

import asyncio
import json
from pathlib import Path
import subprocess
import textwrap

import edge_tts

ROOT = Path(__file__).resolve().parent
SEGMENTS = json.loads((ROOT / "narration.json").read_text(encoding="utf-8"))
VOICE = "en-GB-SoniaNeural"


def timestamp(seconds: float) -> str:
    milliseconds = round(seconds * 1000)
    hours, milliseconds = divmod(milliseconds, 3_600_000)
    minutes, milliseconds = divmod(milliseconds, 60_000)
    secs, milliseconds = divmod(milliseconds, 1000)
    return f"{hours:02}:{minutes:02}:{secs:02},{milliseconds:03}"


def media_duration(path: Path) -> float:
    executable = ROOT / "node_modules" / "ffprobe-static" / "bin" / "win32" / "x64" / "ffprobe.exe"
    if not executable.exists():
        return 0.0
    result = subprocess.check_output([str(executable), "-v", "error", "-show_entries",
                                      "format=duration", "-of", "default=noprint_wrappers=1:nokey=1",
                                      str(path)], text=True)
    return float(result.strip())


async def main() -> None:
    (ROOT / "raw").mkdir(exist_ok=True)
    lines = ["ClimateTwin AI — Management demo voiceover", "Voice: English, calm and professional", ""]
    captions = []
    caption_number = 0
    for number, segment in enumerate(SEGMENTS, 1):
        lines.append(f"{timestamp(segment['start'])}–{timestamp(segment['end'])}  {segment['text']}")
        target = ROOT / "raw" / f"voice_{number:02}.mp3"
        if not target.exists():
            await edge_tts.Communicate(segment["text"], VOICE, rate="+7%").save(str(target))
            print(f"Generated {target.name}: {target.stat().st_size} bytes", flush=True)
        phrases = textwrap.wrap(segment["text"], width=58, break_long_words=False)
        start = segment["start"] + 0.25
        speech_end = min(segment["end"] - 0.25, start + (media_duration(target) or segment["end"] - segment["start"]) - 0.1)
        total = sum(len(phrase) for phrase in phrases)
        cursor = start
        for index, phrase in enumerate(phrases):
            end = speech_end if index == len(phrases) - 1 else cursor + (speech_end - start) * len(phrase) / total
            caption_number += 1
            captions.append(f"{caption_number}\n{timestamp(cursor)} --> {timestamp(end)}\n{phrase}\n")
            cursor = end
    (ROOT / "management_voiceover.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (ROOT / "management_subtitles.srt").write_text("\n".join(captions), encoding="utf-8")


if __name__ == "__main__":
    asyncio.run(main())
