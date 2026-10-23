/** Render authentic mobile footage, proportional scaling, captions and matched female narration. */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { root, raw } from './resident-common.mjs';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const ffmpeg = require('ffmpeg-static'), ffprobe = require('ffprobe-static').path;
const targets = [5, 7, 10, 10, 8, 5];
const source = resolve(raw, 'resident_raw.webm');
const { marks, evidence, errors, residentAuthenticated } = JSON.parse(await readFile(resolve(raw, 'marks.json'), 'utf8'));
const narration = JSON.parse(await readFile(resolve(root, 'resident-narration.json'), 'utf8'));
if (marks.map(m => m.scene).join(',') !== '1,2,3,4,5,6,end') throw new Error('Six complete scenes required');
if (errors.length || residentAuthenticated) throw new Error('Capture failed its public-access/error checks');
const initial = evidence.find(e => e.label === '03-route');
const storm = evidence.find(e => e.label === '04-closed-route');
if (!storm.closed || initial.route.road_ids.join() === storm.route.road_ids.join()) throw new Error('Missing genuine route/closure change');
if (evidence.find(e => e.label === '05-forecasts')?.forecast.status !== 'ready') throw new Error('Trained forecast unavailable');

function run(binary, args) {
  return new Promise((done, fail) => {
    const child = spawn(binary, args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', tail = '';
    child.stdout.on('data', b => output += b.toString());
    child.stderr.on('data', b => tail = (tail + b.toString()).slice(-5000));
    child.on('error', fail);
    child.on('close', code => code === 0 ? done(output || tail) : fail(new Error(`Media command failed (${code}): ${tail}`)));
  });
}
const segments = [];
for (let i = 0; i < 6; i++) {
  const duration = marks[i+1].at - marks[i].at, target = targets[i];
  const file = `scene_${i+1}.mp4`;
  // 390x640 -> 1014x1664 (2.6x); closing -> 936x1536 (2.4x). No stretching or desktop cropping.
  const framing = i === 5
    ? 'scale=936:1536:flags=lanczos,pad=1080:1920:72:96:color=0xEAF0F8,drawbox=x=0:y=1632:w=1080:h=288:color=0x122B4A:t=fill'
    : 'scale=1014:1664:flags=lanczos,pad=1080:1920:33:108:color=0xEAF0F8,drawbox=x=0:y=1772:w=1080:h=148:color=0x122B4A:t=fill';
  const filter = `setpts=(PTS-STARTPTS)*${(target/duration).toFixed(9)},fps=30,${framing},drawbox=x=0:y=0:w=1080:h=96:color=0x122B4A:t=fill,format=yuv420p,tpad=stop_mode=clone:stop_duration=1,trim=duration=${target},fade=t=in:st=0:d=0.12,fade=t=out:st=${target-.12}:d=0.12`;
  console.log(`Scene ${i+1}: ${duration.toFixed(2)}s capture -> ${target}s finished`);
  await run(ffmpeg, ['-y','-hide_banner','-loglevel','error','-ss',marks[i].at.toFixed(3),'-t',duration.toFixed(3),'-i',source,
    '-vf',filter,'-an','-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-r','30','-threads','4',resolve(raw,file)]);
  segments.push(file);
}
await writeFile(resolve(raw,'segments.txt'), segments.map(s => `file '${s}'`).join('\n')+'\n');
await run(ffmpeg,['-y','-hide_banner','-loglevel','error','-f','concat','-safe','0','-i',resolve(raw,'segments.txt'),'-c','copy',resolve(raw,'visual.mp4')]);

const inputs = narration.flatMap((s,i) => ['-i',resolve(raw,`voice_${String(i+1).padStart(2,'0')}.mp3`)]);
const filters = narration.map((s,i) => `[${i}:a]adelay=${Math.round((s.start+.25)*1000)}:all=1[a${i}]`);
filters.push(narration.map((_,i) => `[a${i}]`).join('')+'amix=inputs=6:duration=longest:dropout_transition=0,apad=whole_dur=45,atrim=duration=45,loudnorm=I=-16:TP=-1.5:LRA=11[a]');
await run(ffmpeg,['-y','-hide_banner','-loglevel','error',...inputs,'-filter_complex',filters.join(';'),'-map','[a]','-c:a','aac','-b:a','192k',resolve(raw,'narration.m4a')]);

function assTime(seconds) {
  const cs = Math.round(seconds*100);
  return `${Math.floor(cs/360000)}:${String(Math.floor(cs/6000)%60).padStart(2,'0')}:${String(Math.floor(cs/100)%60).padStart(2,'0')}.${String(cs%100).padStart(2,'0')}`;
}
const events = [];
const line = (start,end,style,text) => events.push(`Dialogue: 0,${assTime(start)},${assTime(end)},${style},,0,0,0,,${text}`);
line(0,45,'Brand','CLIMATETWIN AI  /  RESIDENT SAFETY');
line(0,45,'Note','Synthetic township  •  Illustrative routes');
const labels = ['01  PUBLIC ACCESS','02  NEARBY FLOOD CONDITIONS','03  FIND A SHELTER ROUTE','04  ACCELERATED SIMULATION','05  TRAINED AI · SYNTHETIC DATA','06  PREPARE EARLIER'];
narration.forEach((s,i) => line(s.start,s.end,'Label',labels[i]));
line(40.15,45,'Closing','CLIMATETWIN AI');
line(40.15,45,'Tagline','Smarter Flood Awareness. Safer Communities.');
const srt = await readFile(resolve(root,'resident_subtitles.srt'),'utf8');
for (const block of srt.trim().split(/\r?\n\s*\r?\n/)) {
  const [,times,...text] = block.split(/\r?\n/);
  const parse = t => { const [h,m,s] = t.replace(',','.').split(':').map(Number); return h*3600+m*60+s; };
  const [start,end] = times.split(' --> ').map(parse);
  line(start,end,'Caption',text.join('\\N'));
}
const ass = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Arial,44,&H00FFFFFF,&H00FFFFFF,&H80000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,30,30,68,1
Style: Brand,Arial,30,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,1,0,1,0,0,8,20,20,14,1
Style: Label,Arial,23,&H00E9D4B6,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,1,0,1,0,0,8,20,20,57,1
Style: Note,Arial,23,&H00E5CFB5,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,2,20,20,14,1
Style: Closing,Arial,40,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,2,0,1,0,0,8,20,20,1665,1
Style: Tagline,Arial,32,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,8,20,20,1730,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join('\n')}
`;
await writeFile(resolve(root,'resident_overlays.ass'),ass);
const final = resolve(root,'ClimateTwin_Resident_Demo_45s.mp4');
await run(ffmpeg,['-y','-hide_banner','-loglevel','error','-i',resolve(raw,'visual.mp4'),'-i',resolve(raw,'narration.m4a'),
  '-vf','subtitles=resident_overlays.ass','-map','0:v:0','-map','1:a:0','-c:v','libx264','-preset','veryfast','-crf','18','-threads','4',
  '-pix_fmt','yuv420p','-r','30','-c:a','aac','-b:a','192k','-t','45','-movflags','+faststart',final]);
const metadata = await run(ffprobe,['-v','error','-show_entries','format=duration,size:stream=index,codec_name,width,height,r_frame_rate,nb_frames','-of','json',final]);
await writeFile(resolve(root,'resident_final_probe.json'),metadata);
await run(ffmpeg,['-v','error','-i',final,'-f','null','-']);
console.log(metadata);
console.log(`Verified full decode: ${final}`);
