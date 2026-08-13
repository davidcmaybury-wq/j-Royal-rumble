import { RumbleGame, makeRng } from '../src/engine.js';
const ROW=[100,200,300,400,500];
let n=0; const pool=()=>{n++;return{id:'cat'+n,title:'CAT'+n,
  clues:ROW.map((v,i)=>({id:`c${n}-${i}`,row:i+1,text:'',answer:''}))}};
const mk=(st={},np=4)=>new RumbleGame({
  players:Array.from({length:np},(_,i)=>({id:'p'+i,name:'P'+i})),
  rng:makeRng(5),categoryPool:pool,
  settings:{entryInterval:999,startScore:3000,ceiling:40000,ceilingDecayPerClue:0,...st}});
const openIn=(g,slot)=>{const c=g.board[slot];const x=c.clues.find(y=>!y.revealed);return x?[slot,x.row]:null;};
let fails=0; const ck=(l,ok,d='')=>{console.log(`  ${ok?'ok  ':'FAIL'} ${l}${d?'  — '+d:''}`);if(!ok)fails++;};

console.log('CATEGORY SWEEP');
{
  const g=mk({longevity:false});
  const me=g.live()[0].id;
  let ev=null;
  for(let i=0;i<5;i++){ const c=openIn(g,0); ev=g.resolveClue(...c,{winnerId:me,missedIds:[]}); }
  ck('taking all five pays a bonus', !!ev.sweep, JSON.stringify(ev.sweep));
  ck('credited to the right player', ev.sweep?.playerId===me);
  ck('and named', !!ev.sweep?.category, ev.sweep?.category);
}
{
  const g=mk({longevity:false});
  const [a,b]=g.live().map(p=>p.id);
  let ev=null;
  for(let i=0;i<4;i++){ const c=openIn(g,0); ev=g.resolveClue(...c,{winnerId:a,missedIds:[]}); }
  ev=g.resolveClue(...openIn(g,0),{winnerId:b,missedIds:[]});
  ck('four of five pays nothing', !ev.sweep);
}

console.log('\nLONGEVITY');
{
  const g=mk({longevityEvery:3,longevityBonus:500,categorySweep:false});
  const me=g.live()[0].id;
  const before=g.players.get(me).score;
  let paid=[];
  for(let i=0;i<7;i++){
    const c=openIn(g,i%6)||openIn(g,0);
    const ev=g.resolveClue(...c,{winnerId:null,missedIds:[]});
    if(ev.longevity) paid.push(ev.n);
  }
  ck('it pays on the cadence', paid.length===2, `paid at clues ${paid.join(', ')}`);
  ck('everyone in the ring gets it',
    g.live().every(p=>p.score>0));
}
{
  const g=mk({longevityEvery:3,longevityBonus:500,categorySweep:false,ceiling:3000});
  for(let i=0;i<4;i++) g.resolveClue(...openIn(g,i%6),{winnerId:null,missedIds:[]});
  ck('but it cannot push anyone past the ceiling',
    g.live().every(p=>p.score<=3000), g.live().map(p=>p.score).join());
}

// It has to keep paying, not fire once. And each player is on their own clock:
// somebody who enters at clue 7 is paid at 17, 27, 37 — not on the match's.
{
  const g=mk({longevityEvery:10,longevityBonus:500,categorySweep:false,
    entryInterval:7,startScore:20000,ceiling:200000,overtime:false},5);
  const at={};
  const paid=[];
  for(let i=0;i<40;i++){
    const e=g.resolveClue(...openIn(g,i%6)||openIn(g,0),{winnerId:g.live()[0].id,missedIds:[]});
    if(e.entered!=null){
      const id=Array.isArray(e.entered)?e.entered[0]:e.entered;
      at[id]=e.n;
    }
    for(const l of e.longevity||[]) paid.push({n:e.n,id:l.playerId,tenure:l.tenure});
  }
  const starters=paid.filter(x=>!at[x.id]).map(x=>x.n);
  ck('it keeps paying, not just once', new Set(starters).size>=4,
    `starters paid at clues ${[...new Set(starters)].join(', ')}`);
  const late=paid.filter(x=>at[x.id]);
  ck('a late entrant is on their own clock',
    late.length>0 && late.every(x=>x.tenure%10===0 && x.n===at[x.id]+x.tenure),
    late.map(x=>`clue ${x.n} after ${x.tenure}`).join(', '));
}

console.log('\nSAVE A PLAYER');
{
  const g=mk({longevity:false,categorySweep:false});
  const [a,b,c]=g.live().map(p=>p.id);
  g.players.get(c).score=50;
  g.resolveClue(...openIn(g,0),{winnerId:a,missedIds:[c]});
  ck('somebody is out', g.players.get(c).state==='eliminated', g.players.get(c).state);
  const r1=g.declareSave(a,c,800), r2=g.declareSave(b,c,700);
  ck('two people can declare', r1.ok&&r2.ok);
  const wasA=g.players.get(a).score, wasB=g.players.get(b).score;
  const ev=g.resolveClue(...openIn(g,1),{winnerId:a,missedIds:[]});
  ck('it settles at the next clue', !!ev.saved, JSON.stringify(ev.saved?.[0]?.total));
  ck('the saved player is back in', g.players.get(c).state==='live');
  ck('with what was raised', g.players.get(c).score===1500, String(g.players.get(c).score));
  // The clue itself also moved B: they lost the pot on a clue A took. So the
  // save costs 700 on top of whatever the clue did, not instead of it.
  const clueCost = wasA !== undefined ? 100 : 0;
  ck('and the donors paid on top of the clue',
    g.players.get(b).score === wasB - 700 - clueCost,
    `${wasB} -> ${g.players.get(b).score}, expected -700 save and -${clueCost} clue`);
}

console.log('\nGIFT FROM THE QUEUE');
{
  const g=mk({longevity:false,categorySweep:false},5);
  const inRing=g.live()[0].id;
  const waiting=g.queued()[0].id;
  const was=g.players.get(inRing).score;
  const r=g.giftFromQueue(waiting,inRing,1200);
  ck('a queued player can fund somebody', r.ok, JSON.stringify(r));
  ck('the recipient gets it now', g.players.get(inRing).score===was+1200,
    `${was} -> ${g.players.get(inRing).score}`);
  ck('and they cannot give what they have not got',
    !!g.giftFromQueue(waiting,inRing,5000).error,
    g.giftFromQueue(waiting,inRing,5000).error);
  // walk them in
  while(g.queued().length && g.players.get(waiting).state==='queued'){
    g.admit('test'); }
  ck('they enter lighter by what they gave',
    g.players.get(waiting).score===3000-1200, String(g.players.get(waiting).score));
}
console.log(`\n${fails?fails+' FAILURES':'all checks passed'}`);
process.exit(fails?1:0);
