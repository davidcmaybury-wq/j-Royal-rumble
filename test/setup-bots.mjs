const U='http://127.0.0.1:8080';
let fails=0; const check=(l,ok,d='')=>{console.log(`  ${ok?'ok  ':'FAIL'} ${l}${d?'  — '+d:''}`); if(!ok)fails++;};
const m=await (await fetch(`${U}/api/match`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).json();
const H={'content-type':'application/json','x-host-key':m.hostKey};
const v=await (await fetch(`${U}/api/match/${m.gameId}`,{headers:H})).json();
check('the default match length is 30 minutes', v.settings.targetMinutes===30, String(v.settings.targetMinutes));
let r=await (await fetch(`${U}/api/match/${m.gameId}/bots`,{method:'POST',headers:H,body:JSON.stringify({count:4})})).json();
check('robots default to the show statistics', r.added.every(b=>true) && r.roster.length===4, `${r.roster.length} added`);
const bot=r.roster.find(p=>p.isBot);
const was=bot.level;
r=await (await fetch(`${U}/api/match/${m.gameId}/bots/${encodeURIComponent(bot.token)}`,
  {method:'PATCH',headers:H,body:JSON.stringify({level:'elite'})})).json();
const now=r.roster.find(p=>p.token===bot.token);
check('a robot can be promoted', now.level==='elite', `${was} -> ${now.level}`);
check('and its description follows', /elite/.test(now.bot||''), now.bot);
const bad=await fetch(`${U}/api/match/${m.gameId}/bots/${encodeURIComponent(bot.token)}`,
  {method:'PATCH',headers:H,body:JSON.stringify({level:'wizard'})});
check('an unknown standard is refused', bad.status===400, `HTTP ${bad.status}`);
r=await (await fetch(`${U}/api/match/${m.gameId}/bots/${encodeURIComponent(bot.token)}`,{method:'DELETE',headers:H})).json();
check('a single robot can be removed', r.roster.length===3, `${r.roster.length} left`);
const p=await (await fetch(`${U}/api/match/${m.gameId}`,{method:'PATCH',headers:H,
  body:JSON.stringify({settings:{targetMinutes:45,startScore:5555}})})).json();
check('settings save', p.settings.targetMinutes===45 && p.settings.startScore===5555,
  `${p.settings.targetMinutes} min, ${p.settings.startScore}`);
const again=await (await fetch(`${U}/api/match/${m.gameId}`,{headers:H})).json();
check('and survive a re-read', again.settings.startScore===5555);
const hb=await fetch(`${U}/handbook`);
// HTML now, not a PDF: the generated PDF drifted and has been retired.
check('the handbook is served', hb.ok && hb.headers.get('content-type').includes('html'),
  hb.headers.get('content-type'));
console.log(`\n${fails?fails+' FAILURES':'all checks passed'}`);
process.exit(fails?1:0);
