// Runs every measurement behind the analysis charts, against the shipping
// rules engine rather than a copy of it, and writes /tmp/stats.json for
// tools/plot-analysis.py to draw.
import { RumbleGame, makeRng, autoCeiling, autoEntryInterval } from '../src/engine.js';
import { writeFileSync } from 'fs';
const ROW=[100,200,300,400,500];
function pool(){let n=0;return()=>{n++;return{id:'c'+n,title:'C'+n,
  clues:ROW.map((v,i)=>({id:`c${n}-${i}`,row:i+1,text:'',answer:''}))}}}
const KNOW=[0.82,0.72,0.62,0.50,0.38];
const gauss=(r)=>Math.sqrt(-2*Math.log(1-r()))*Math.cos(2*Math.PI*r());
const fisher=(a,rng)=>{const x=a.slice();
  for(let i=x.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[x[i],x[j]]=[x[j],x[i]];}return x;};
// The bug: a random comparator is not a shuffle.
const biased=(a,rng)=>a.slice().sort(()=>rng()-0.5);

function run(n,seed,o={}){
  const {iv,ceiling,decay=0,lon=true,lonEvery=10,lonSize=500,
         shuffle=fisher,elitePos=null,eliteEdge=0,skill=true}=o;
  const rng=makeRng(seed);
  const players=Array.from({length:n},(_,i)=>({id:'p'+i,name:'P'+i}));
  const adj=new Map(players.map(p=>[p.id, skill?gauss(rng)*0.10:0]));
  const rank=[...adj.entries()].sort((a,b)=>b[1]-a[1]).map(([id])=>id);
  const g=new RumbleGame({players,rng,categoryPool:pool(),
    settings:{entryInterval:iv??autoEntryInterval(n,30,17.5),startScore:3000,
      ceiling:ceiling??autoCeiling(n),ceilingFloor:3000,ceilingDecayPerClue:decay,
      longevity:lon,longevityEvery:lonEvery,longevityBonus:lonSize}});
  let elite=null;
  if(elitePos) for(const p of g.players.values())
    if((p.originalDraw??p.drawNumber)===elitePos) elite=p.id;
  let guard=0;
  while(!g.finished&&guard++<1400){
    const open=[];g.board.forEach((c,si)=>c.clues.forEach(x=>{if(!x.revealed)open.push([si,x.row])}));
    const [s,r]=open[Math.floor(rng()*open.length)];
    let w=null;const missed=[];
    for(const p of shuffle(g.live(),rng)){
      const k=KNOW[r-1]+adj.get(p.id)+(p.id===elite?eliteEdge:0);
      if(rng()<Math.min(.97,Math.max(.03,k))){w=p.id;break;}
      if(rng()<0.07) missed.push(p.id);
    }
    g.resolveClue(s,r,{winnerId:w,missedIds:missed});
  }
  const win=[...g.players.values()].find(p=>p.state==='winner'||(g.finished&&p.state==='live'));
  if(!win) return null;
  const e=elite?g.players.get(elite):null;
  return {draw:win.originalDraw??win.drawNumber, clues:g.cluesRevealed,
    top3:rank.indexOf(win.id)<3, eliteWon: elite? win.id===elite : null,
    eliteTenure: e? (e.eliminatedAtClue??g.cluesRevealed)-(e.enteredAtClue??0) : null};
}
function dist(n,o,runs){
  const w=new Array(n+1).fill(0);const L=[];let d=0,s3=0;
  for(let i=1;i<=runs;i++){const r=run(n,i,o); if(!r)continue;
    d++;w[r.draw]++;L.push(r.clues); if(r.top3)s3++;}
  L.sort((a,b)=>a-b);
  const fair=100/n,third=Math.ceil(n/3);
  const per=(a,b)=>w.slice(a,b+1).reduce((x,y)=>x+y,0)/d*100/(b-a+1);
  return {pct:w.slice(1).map(x=>x/d*100), fair,
    spread:(per(2*third+1,n)/fair)/(per(1,third)/fair),
    mins:Math.round(L[Math.floor(d/2)]*17.5/60), skill:s3/d*100};
}
const out={};
// 1. win distribution by draw
out.dist={}; for(const n of [10,20,30]) out.dist[n]=dist(n,{},6000);
// 2. the biased-shuffle artefact
out.biased=dist(10,{shuffle:biased},6000).pct;
out.fixed=out.dist[10].pct;
// 3. ceiling decay reversal
out.decay={}; for(const n of [10,20,30]){ out.decay[n]=[];
  for(const d of [0,-25,-40,-60,-90,-130,-180])
    out.decay[n].push([d, dist(n,{decay:d,lon:false},2000).spread]); }
// 4. longevity size
out.lon={}; for(const n of [10,20,30]){ out.lon[n]=[];
  for(const sz of [0,250,400,500,600,750,1000])
    out.lon[n].push([sz, dist(n,{lon:sz>0,lonSize:sz||500},2000).spread]); }
// 5. entry interval: fairness vs skill
out.iv={}; for(const n of [10,16,20,30]){ out.iv[n]=[];
  for(const iv of [1,2,3,4,5,6,8,10,12,15]){ if(iv*(n-3)>340) continue;
    const r=dist(n,{iv},2000); out.iv[n].push([iv,r.spread,r.mins,r.skill]); } }
// 6. ceiling vs fairness
out.ceil={}; for(const n of [10,16,20,24,30]){ out.ceil[n]=[];
  for(const c of [6000,7500,9000,10500,12000,15000])
    out.ceil[n].push([c, dist(n,{ceiling:c,iv:4},2000).spread]); }
// 7. elite by start position
out.elite={}; for(const n of [20,30]){ out.elite[n]=[];
  const step=n<=20?2:3;
  for(let p=1;p<=n;p+=step){
    let won=0,ten=0,d=0;
    for(let i=1;i<=1500;i++){const r=run(n,i,{elitePos:p,eliteEdge:0.15});
      if(!r)continue; d++; if(r.eliteWon)won++; ten+=r.eliteTenure;}
    out.elite[n].push([p, won/d*100, ten/d]); } }
writeFileSync('/tmp/stats.json', JSON.stringify(out));
console.log('done');
