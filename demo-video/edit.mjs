/** Turn marked live browser footage into the 90-second narrated MP4. */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const ffmpeg = require('ffmpeg-static');
const ffprobe = require('ffprobe-static').path;
const raw = resolve('raw');
const source = resolve(raw, 'management_raw.webm');
const targetSeconds = [8, 9, 13, 13, 13, 25, 9];
const { marks, stateChecks } = JSON.parse(await readFile(resolve(raw, 'marks.json'), 'utf8'));
const narration = JSON.parse(await readFile(resolve('narration.json'), 'utf8'));
if (marks.length !== 8 || marks.map(m => String(m.scene)).join(',') !== '1,2,3,4,5,6,7,end')
  throw new Error('Seven complete recorded scenes are required');
if (!stateChecks.some(item => item.closed > 0) || !stateChecks.some(item => item.p2 === true))
  throw new Error('Real storm closure and pump intervention were not captured');

function run(binary, args) {
  return new Promise((done, fail) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let tail = '';
    let output = '';
    child.stderr.on('data', chunk => { tail = (tail + chunk.toString()).slice(-4000); });
    child.stdout.on('data', chunk => { output += chunk.toString(); });
    child.on('error', fail);
    child.on('close', code => code === 0 ? done(output || tail) : fail(new Error(`${binary} exited ${code}\n${tail}`)));
  });
}

const segments = [];
for (let i = 0; i < 7; i++) {
  const start = marks[i].at;
  const length = marks[i + 1].at - start;
  if (length < 2) throw new Error(`Scene ${i + 1} is too short`);
  const target = targetSeconds[i];
  const name = `scene_${String(i + 1).padStart(2, '0')}.mp4`;
  const output = resolve(raw, name);
  const factor = target / length;
  const fadeStart = (target - 0.18).toFixed(3);
  const filter = `setpts=(PTS-STARTPTS)*${factor.toFixed(8)},fps=30,scale=1920:1080:flags=lanczos,format=yuv420p,tpad=stop_mode=clone:stop_duration=1,trim=duration=${target},fade=t=in:st=0:d=0.18,fade=t=out:st=${fadeStart}:d=0.18`;
  console.log(`Editing scene ${i + 1}: ${length.toFixed(1)}s live to ${target}s final`);
  await run(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', start.toFixed(3), '-t', length.toFixed(3),
    '-i', source, '-vf', filter, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-pix_fmt', 'yuv420p', '-r', '30', '-threads', '4', output]);
  segments.push(name);
}
await writeFile(resolve(raw, 'segments.txt'), segments.map(name => `file '${name}'`).join('\n') + '\n');
const visual = resolve(raw, 'visual.mp4');
await run(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0',
  '-i', resolve(raw, 'segments.txt'), '-c', 'copy', visual]);

const audioInputs = narration.map((_, i) => ['-i', resolve(raw, `voice_${String(i + 1).padStart(2, '0')}.mp3`)]).flat();
const audioFilters = narration.map((line, i) => `[${i}:a]adelay=${Math.round((line.start + 0.25) * 1000)}:all=1[a${i}]`);
const mix = `${narration.map((_, i) => `[a${i}]`).join('')}amix=inputs=${narration.length}:duration=longest:dropout_transition=0,apad=whole_dur=90,atrim=duration=90,loudnorm=I=-16:TP=-1.5:LRA=11[a]`;
const audioFile = resolve(raw, 'narration.m4a');
await run(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', ...audioInputs,
  '-filter_complex', [...audioFilters, mix].join(';'), '-map', '[a]', '-c:a', 'aac', '-b:a', '192k', audioFile]);

const subtitles = `scale=1742:980:flags=lanczos,pad=1920:1080:89:0:color=0xEAF0F8,drawbox=x=0:y=980:w=1920:h=100:color=0x122B4A:t=fill,subtitles=management_subtitles.srt:force_style='FontName=Arial,FontSize=12,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=1,Outline=1,Shadow=0,Alignment=2,MarginV=14'`;
const final = resolve('ClimateTwin_Management_Demo_90s.mp4');
await run(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', visual, '-i', audioFile,
  '-vf', subtitles, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-preset', 'veryfast',
  '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '192k',
  '-t', '90', '-movflags', '+faststart', final]);
const metadata = await run(ffprobe, ['-v', 'error', '-show_entries',
  'format=duration:stream=index,codec_name,width,height,r_frame_rate', '-of', 'json', final]);
await writeFile(resolve('final_probe.json'), metadata);
console.log(`Final video: ${final}`);
