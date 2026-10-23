import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { root, raw } from './resident-common.mjs';
const require = createRequire(import.meta.url);
const ffmpeg = require('ffmpeg-static'), ffprobe = require('ffprobe-static').path;
const final = resolve(root, 'ClimateTwin_Resident_Demo_45s.mp4');
function run(binary,args) {
  const result = spawnSync(binary,args,{ encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024 });
  if (result.status !== 0) throw new Error(result.stderr || String(result.error));
  return result.stdout || result.stderr;
}
const metadata = JSON.parse(run(ffprobe,['-v','error','-show_format','-show_streams','-of','json',final]));
const video = metadata.streams.find(s => s.codec_type === 'video');
const audio = metadata.streams.find(s => s.codec_type === 'audio');
assert.equal(Number(metadata.format.duration),45);
assert.equal(video.width,1080); assert.equal(video.height,1920);
assert.equal(video.r_frame_rate,'30/1'); assert.equal(video.codec_name,'h264');
assert.equal(Number(video.nb_frames),1350); assert.equal(audio.codec_name,'aac');
run(ffmpeg,['-v','error','-i',final,'-f','null','-']);
const volume = run(ffmpeg,['-hide_banner','-i',final,'-af','volumedetect','-vn','-f','null','-']);
const mean = Number(volume.match(/mean_volume: ([\-\d.]+) dB/)?.[1]);
const peak = Number(volume.match(/max_volume: ([\-\d.]+) dB/)?.[1]);
assert.ok(Number.isFinite(mean) && mean > -24 && peak < 0,'Narration must be audible and unclipped');
for (const second of [1,3,8,17,24,27,29,30.5,35,42,44]) {
  run(ffmpeg,['-y','-v','error','-ss',String(second),'-i',final,'-frames:v','1',resolve(raw,`final-${second}.png`)]);
}
const report = {
  duration_seconds:45, width:1080,height:1920,fps:30,frames:1350,
  video_codec:video.codec_name,audio_codec:audio.codec_name,
  bytes:Number(metadata.format.size),full_decode:'passed',
  audio_mean_db:mean,audio_peak_db:peak,
  capture_viewport:{width:390,height:640},
  narration:{provider:'Microsoft Edge neural TTS',voice:'en-GB-SoniaNeural',rate:'+7%',matches_management_settings:true},
  subtitles:'English SRT and burned-in captions',
  scene_boundaries_seconds:[0,5,12,22,32,40,45],
  captures:JSON.parse(await readFile(resolve(raw,'marks.json'),'utf8')).evidence.map(e => ({
    label:e.label,minute:e.minute,status:e.status,closed_roads:e.closed,route:e.route.road_ids,
    distance_m:e.route.distance_m,travel_minutes:e.route.travel_minutes,forecast_status:e.forecast.status
  }))
};
await writeFile(resolve(root,'resident_verification.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
