import { avatar, lookFor, wrestler, ring, SINGLET_STYLES, HAIR_STYLES } from './public/wrestlers.js';
import { writeFileSync } from 'fs';
const names=['Marko','Colin','matt','Taotao','Cameron','Tyler G','Christopher','Dell',
  'Bront','Juno','Kip','Tibbs','Marlo','Wex','Rowan','Nam'];
let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="360">
<rect width="100%" height="100%" fill="#0A0E1C"/>
<text x="10" y="18" fill="#D6A93F" font-size="12" font-family="sans-serif">avatars at 64px, and at 24px as they appear on a tile</text>`;
names.forEach((n,i)=>{
  const x=14+(i%8)*110, y=30+Math.floor(i/8)*160;
  const look=lookFor(n);
  svg+=`<g transform="translate(${x},${y})">${avatar(look,64)}</g>`;
  svg+=`<g transform="translate(${x+70},${y+20})">${avatar(look,24)}</g>`;
  svg+=`<text x="${x}" y="${y+80}" fill="#7C88AB" font-size="9" font-family="sans-serif">${n}</text>`;
  svg+=`<text x="${x}" y="${y+92}" fill="#3C486E" font-size="8" font-family="sans-serif">${look.singlet}/${look.hair}</text>`;
  // full body
  svg+=`<svg x="${x}" y="${y+96}" width="96" height="60" viewBox="0 0 64 40">
    <rect width="64" height="40" fill="#0A0E1C"/>${ring()}
    ${wrestler(28,17,look,{arms:'raise',legs:'wide'})}</svg>`;
});
svg+='</svg>';
writeFileSync('/tmp/wr.svg',svg);
