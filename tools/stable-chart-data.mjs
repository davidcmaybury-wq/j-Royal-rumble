// Runs the stable simulations behind stables-analysis.png and writes
// /tmp/stabdata.json for tools/plot-stables.py to draw.
//
//   node tools/stable-chart-data.mjs && python3 tools/plot-stables.py
//
import { RumbleGame, makeRng, autoCeiling } from '../src/engine.js';
import { makeBot, planClue } from '../src/bots.js';
import { writeFileSync } from 'fs';
const ROW=[100,200,300,400,500];
function pool(){let n=0;return()=>{n++;return{id:'c'+n,title:'C'+n,
  clues:ROW.map((v,i)=>({id:`c${n}-${i}`,row:i+1,text:'',answer:''}))}}}

function run(field, allied, seed, focus, eliteLevel='elite'){
  const rng=makeRng(seed); const brains=new Map(); const players=[];
  players.push({id:'elite',name:'E'}); brains.set('elite', makeBot(rng,{level:eliteLevel}));
  for(let i=0;i<field-1;i++){ players.push({id:'n'+i,name:'N'+i});
    brains.set('n'+i, makeBot(rng,{level:'normie'})); }
  const g=new RumbleGame({players,rng,categoryPool:pool(),
    settings:{entryInterval:999,startScore:3000,ceiling:autoCeiling(field),
      ceilingFloor:3000,ceilingDecayPerClue:null,stables:allied>1,
      stableFocus:focus,stableMaxFraction:1}});
  if(allied>1){ const st=g.createStable('n0','Pack'); let j=1;
    for(let i=1;i<field-1&&j<allied;i++) if(g.joinStable('n'+i,st.id).ok) j++; }
  let guard=0;
  while(!g.finished&&guard++<1200){
    const open=[];g.board.forEach((c,si)=>c.clues.forEach(x=>{if(!x.revealed)open.push([si,x.row])}));
    const [s,r]=open[Math.floor(rng()*open.length)];
    const tries=[];
    for(const p of g.live()){ const plan=planClue(brains.get(p.id),r,rng,250,0,190);
      if(plan.attempt) tries.push({id:p.id,ms:plan.ms,correct:plan.correct}); }
    tries.sort((a,b)=>a.ms-b.ms); const f=tries[0];
    g.resolveClue(s,r,{winnerId:f&&f.correct?f.id:null,missedIds:f&&!f.correct?[f.id]:[]});
  }
  const w=[...g.players.values()].find(p=>p.state==='winner'||(g.finished&&p.state==='live'));
  return w? w.id==='elite' : null;
}
function rate(field,allied,focus,runs=2500,lvl='elite'){
  let won=0,d=0;
  for(let s=1;s<=runs;s++){const r=run(field,allied,s,focus,lvl); if(r===null)continue; d++; if(r)won++;}
  return won/d*100;
}
const out={fields:[6,8,10,12], focus:{}, old:{}, cap:{}, levels:{}};
for(const f of out.fields){
  out.focus[f]=[]; out.old[f]=[]; out.cap[f]=Math.floor(f/2);
  for(let a=0;a<=f-1;a++){
    if(a===1){ out.focus[f].push(null); out.old[f].push(null); continue; }
    out.focus[f].push(+rate(f,a,true).toFixed(1));
    out.old[f].push(+rate(f,a,false).toFixed(1));
  }
}
// how the strong player's level changes the picture, at the legal cap
for(const lvl of ['champ','superchamp','elite']){
  out.levels[lvl]={none:+rate(10,0,true,2000,lvl).toFixed(1),
                   cap:+rate(10,5,true,2000,lvl).toFixed(1)};
}
writeFileSync('/tmp/stabdata.json', JSON.stringify(out));
console.log('done');
