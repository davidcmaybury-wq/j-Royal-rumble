import { io } from 'socket.io-client';
const U='http://127.0.0.1:8080';
const once=(s,e)=>new Promise(r=>s.once(e,r));
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
const m=await (await fetch(`${U}/api/match`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).json();
const host=io(U,{transports:['websocket']}); await once(host,'connect');
let st=null; host.on('state',s=>{st=s});
await new Promise(r=>host.emit('host-join',{gameId:m.gameId,hostKey:m.hostKey},x=>{st=x.state;r()}));
const ps=[];
for(const n of ['A','B','C']){const s=io(U,{transports:['websocket']});await once(s,'connect');
  await new Promise(r=>s.emit('join',{gameId:m.gameId,name:n},r));ps.push(s)}
await wait(200); host.emit('start-match'); await wait(300);
// sample a few hundred categories by rerolling the board
let bad=0, seen=0;
const re=/\\["'\\]|&quot;|&amp;|&#39;/;
for(let round=0;round<60;round++){
  for(const cat of st.board){ seen++; if(re.test(cat.title)) { bad++; console.log('BAD title:',JSON.stringify(cat.title)); } }
  for(let i=0;i<6;i++) host.emit('veto',{slot:i});
  await wait(60);
}
console.log(`checked ${seen} category titles served live, ${bad} still escaped`);
// and clue text on the way to the console
let cbad=0,cseen=0;
for(let i=0;i<25;i++){
  const open=[]; st.board.forEach((c,si)=>c.clues.forEach(x=>{if(!x.revealed)open.push([si,x.row])}));
  const [s2,r2]=open[Math.floor(Math.random()*open.length)];
  host.emit('pick-clue',{slot:s2,row:r2}); await wait(70);
  if(st.clue){ cseen++; if(re.test(st.clue.text)||re.test(st.clue.answer)){cbad++;console.log('BAD clue:',JSON.stringify(st.clue.text.slice(0,90)))} }
  host.emit('resolve',{winnerToken:null}); await wait(90);
}
console.log(`checked ${cseen} live clues, ${cbad} still escaped`);
host.close(); ps.forEach(s=>s.close()); process.exit(bad+cbad?1:0);
