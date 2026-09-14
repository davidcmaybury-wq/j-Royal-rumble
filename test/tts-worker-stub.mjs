// A stand-in for src/tts-worker.mjs, for test/tts.mjs.
//
// Answers like the real worker — {id, pcm, rate} — but with no model behind
// it, and misbehaves on cue so the parent's timeout and restart paths can be
// proven rather than inferred: a line containing HANG is never answered, a
// line containing DIE exits the process mid-request.
process.on('message', (m) => {
  if (m.warm) return process.send({ id: m.id, ok: true });
  if (/HANG/.test(m.text)) return;                 // the request is simply lost
  if (/DIE/.test(m.text)) process.exit(3);         // the worker goes away
  const rate = 8000;
  const n = Math.round(rate * m.text.length / 12);   // ~12 chars/s, like a voice
  process.send({ id: m.id, pcm: Buffer.alloc(n * 2), rate });
});
process.on('disconnect', () => process.exit(0));
