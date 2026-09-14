// The host's voice: the contract every engine has to meet, pinned on the one
// engine that needs no model, no binary and no key.
//
// The autohost schedules the buzzers off the length of the clip it plays, so
// the thing worth testing is that `durationMs` comes from the clip itself and
// that a failure is loud. The real engines are exercised by tools/tts-bench.mjs
// on the box; CI has no model to load and should not pretend it does.
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The cache dir is read at import, so it is pointed somewhere disposable
// before the module loads. A test that wrote clips beside the app would leave
// a diff, which is the same reason logs/ and reports/ are ignored.
const dir = mkdtempSync(join(tmpdir(), 'rumble-tts-'));
process.env.RUMBLE_TTS_DIR = dir;
// The kokoro path runs against a stub worker that hangs or dies on cue, with a
// short timeout, so the parent's recovery is a fact and not an inference.
process.env.RUMBLE_TTS_WORKER = new URL('./tts-worker-stub.mjs', import.meta.url).pathname;
process.env.RUMBLE_TTS_TIMEOUT_MS = '300';
delete process.env.RUMBLE_TTS;
delete process.env.RUMBLE_VOICE_MIKE;
delete process.env.RUMBLE_VOICE_GENE;
const tts = await import('../src/tts.js');

let fails = 0;
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

console.log('A CLIP KNOWS HOW LONG IT IS');
{
  const clue = 'This former Secretary of State was the first woman to hold the office.';
  const r = await tts.speak(clue, tts.voiceFor('mike'));
  check('the default engine is the silent one, so CI needs nothing', r.engine === 'silent', r.engine);
  check('the clip is a WAV', r.audio.toString('ascii', 0, 4) === 'RIFF' && r.mime === 'audio/wav');
  check('its length is read from its own header', r.durationMs === tts.wavDurationMs(r.audio),
    `${r.durationMs} / ${tts.wavDurationMs(r.audio)}`);
  check('and matches the reading time of the text', r.durationMs === tts.readingTimeMs(clue),
    `${r.durationMs} / ${tts.readingTimeMs(clue)}`);
  check('a longer clue is a longer clip',
    tts.readingTimeMs(clue + ' ' + clue) > tts.readingTimeMs(clue));
  check('whitespace does not count as speech',
    tts.readingTimeMs('  a   b  ') === tts.readingTimeMs('a b'));
  check('even one word gets a beat, never a zero-length clip', tts.readingTimeMs('No.') >= 400,
    String(tts.readingTimeMs('No.')));
  check('the silent engine writes nothing to the cache',
    !existsSync(join(dir, 'silent')) || readdirSync(join(dir, 'silent')).length === 0);
}

console.log('\nTHE WAV HEADER IS PARSED, NOT TRUSTED');
{
  const pcm = Buffer.alloc(22050 * 2 * 3);   // three seconds at 22.05 kHz mono
  const wav = tts.pcm16ToWav(pcm, 22050);
  check('three seconds of 16-bit mono reads as 3000 ms', tts.wavDurationMs(wav) === 3000,
    String(tts.wavDurationMs(wav)));
  const stereo = tts.pcm16ToWav(Buffer.alloc(8000 * 2 * 2), 8000, 2);
  check('stereo halves the sample count', tts.wavDurationMs(stereo) === 1000,
    String(tts.wavDurationMs(stereo)));
  // A LIST chunk before the data, the way some encoders write files.
  const list = Buffer.alloc(8 + 6); list.write('LIST', 0); list.writeUInt32LE(6, 4);
  const withList = Buffer.concat([wav.subarray(0, 36), list, wav.subarray(36)]);
  check('a chunk before the data is skipped', tts.wavDurationMs(withList) === 3000,
    String(tts.wavDurationMs(withList)));
  let threw = null;
  try { tts.wavDurationMs(Buffer.from('not audio at all, sorry')); } catch (e) { threw = e; }
  check('something that is not a WAV is refused', threw instanceof tts.TtsError, threw?.message);
  const f = tts.float32ToPcm16(new Float32Array([0, 1, -1, 2, -2]));
  check('float samples are clipped to 16 bits',
    f.readInt16LE(2) === 32767 && f.readInt16LE(4) === -32768 && f.readInt16LE(6) === 32767);
}

console.log('\nIT FAILS CLOSED AND NAMES THE FIX');
{
  const bad = tts.useEngine('festival');
  check('an unknown engine is refused at configure', !bad.ok, bad.reason);
  check('and the refusal names the variable', /RUMBLE_TTS/.test(bad.reason || ''), bad.reason);
  let threw = null;
  try { await tts.speak('hello'); } catch (e) { threw = e; }
  check('speak() throws rather than returning silence', threw instanceof tts.TtsError, threw?.message);
  check('the failure is counted for /api/health', tts.status().failed >= 1 && tts.status().lastError === bad.reason,
    tts.status().lastError);

  const el = tts.useEngine('elevenlabs');
  if (process.env.ELEVENLABS_API_KEY) {
    check('with a key, elevenlabs configures (not exercised here)', el.ok);
  } else {
    check('elevenlabs without a key is refused', !el.ok);
    check('and names ELEVENLABS_API_KEY', /ELEVENLABS_API_KEY/.test(el.reason || ''), el.reason);
  }

  const pip = tts.useEngine('piper');
  if (process.env.PIPER_BIN) {
    check('with PIPER_BIN set, piper configures', pip.ok, pip.reason);
  } else {
    // piper may be on the PATH of a developer machine; the refusal is only
    // guaranteed where it is not.
    check('piper with no binary names PIPER_BIN, or a binary was found',
      pip.ok || /PIPER_BIN/.test(pip.reason || ''), pip.reason || 'found on PATH');
  }

  const ko = tts.useEngine('kokoro');
  check('kokoro configures without loading anything', ko.ok);
  check('each host has a default voice per engine',
    tts.voiceFor('mike') && tts.voiceFor('gene') && tts.voiceFor('mike') !== tts.voiceFor('gene'),
    `${tts.voiceFor('mike')} / ${tts.voiceFor('gene')}`);
  process.env.RUMBLE_VOICE_GENE = 'bm_george';
  check('and the environment can override one', tts.voiceFor('gene') === 'bm_george', tts.voiceFor('gene'));
  delete process.env.RUMBLE_VOICE_GENE;
  tts.useEngine('silent');
}

console.log('\nA WORKER THAT HANGS OR DIES IS SURVIVED, AND SAID');
{
  tts.useEngine('kokoro');
  const ok = await tts.speak('An ordinary line.', 'v');
  check('the worker answers, and its clip has a length', ok.durationMs > 0 && ok.engine === 'kokoro',
    String(ok.durationMs));
  const pid = tts.status().workerPid;
  let threw = null;
  const t0 = Date.now();
  try { await tts.speak('This one will HANG.', 'v'); } catch (e) { threw = e; }
  check('a request the worker never answers is rejected at the timeout',
    threw instanceof tts.TtsError && /longer than 300ms/.test(threw.message), threw?.message);
  check('promptly, not after twenty seconds', Date.now() - t0 < 2000, `${Date.now() - t0} ms`);
  const after = await tts.speak('And the next line is fine.', 'v');
  check('the next request is answered by the same worker', after.durationMs > 0 && tts.status().workerPid === pid,
    `${tts.status().workerPid} / ${pid}`);
  check('a late answer to the lost request cannot be mistaken for this one',
    after.durationMs === tts.readingTimeMs('And the next line is fine.', 12), String(after.durationMs));

  threw = null;
  try { await tts.speak('Now DIE.', 'v'); } catch (e) { threw = e; }
  check('a worker that exits mid-request is a named error', threw instanceof tts.TtsError && /worker exited 3/.test(threw.message),
    threw?.message);
  check('and is recorded for /api/health', /worker exited 3/.test(tts.status().lastError || ''), tts.status().lastError);
  check('with no live worker to report', tts.status().workerPid === null);
  const again = await tts.speak('Back again.', 'v');
  check('the next request starts a fresh worker', again.durationMs > 0 && tts.status().workerPid && tts.status().workerPid !== pid,
    `${tts.status().workerPid} / ${pid}`);
  tts.stop();
  tts.useEngine('silent');
}

// A real engine can only be exercised where one exists. A stand-in piper — any
// executable that reads text on stdin and writes a WAV to the -f path — is
// enough to prove the spawn, the flags, the cache and the length parse.
if (process.env.PIPER_BIN) {
  console.log('\nA REAL ENGINE IS CACHED, ONCE PER LINE PER VOICE');
  tts.useEngine('piper');
  const line = 'The correct response: Millard Fillmore.';
  const first = await tts.speak(line, 'test-voice');
  const again = await tts.speak(line, 'test-voice');
  const other = await tts.speak(line, 'other-voice');
  check('the first call synthesizes', first.cached === false && typeof first.synthMs === 'number');
  check('the second call is served from disk', again.cached === true);
  check('with the same length', again.durationMs === first.durationMs, `${again.durationMs} / ${first.durationMs}`);
  check('a different voice is a different clip', other.cached === false);
  check('the cache lives under the engine\'s own directory', existsSync(join(dir, 'piper')));
  check('and the counts say what happened', tts.status().spoken >= 2 && tts.status().cached >= 1,
    JSON.stringify({ spoken: tts.status().spoken, cached: tts.status().cached }));
  tts.useEngine('silent');
}

console.log('\nTHE CALLER NEVER SPEAKS NOTHING');
{
  let threw = null;
  try { await tts.speak('   '); } catch (e) { threw = e; }
  check('an empty line is refused rather than played as a beat', threw instanceof tts.TtsError, threw?.message);
  const s = tts.status();
  check('status reports the engine and where clips go', s.engine === 'silent' && s.dir === dir, `${s.engine} ${s.dir}`);
}

rmSync(dir, { recursive: true, force: true });
console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);
