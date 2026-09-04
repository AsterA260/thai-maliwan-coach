const { chromium } = require('playwright');
(async()=>{
const b=await chromium.launch();
const p=await b.newPage({viewport:{width:1440,height:900}});
const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,120)));
await p.goto('file:///home/claude/coach/makieta_slajdy_2026-09-03.html');
await p.waitForTimeout(600);

const martwe = await p.evaluate(()=>{
  const out={};
  out.nav = [...document.querySelectorAll('nav button')].map(b=>({txt:b.innerText.trim(), onclick:!!b.onclick}));
  out.pill = [...document.querySelectorAll('.pillset button')].map(b=>({txt:b.innerText.trim(), onclick:!!b.onclick}));
  out.m = (()=>{const e=[...document.querySelectorAll('.tools .iconbtn')].pop(); return {tag:e.tagName,onclick:!!e.onclick};})();
  out.statsHardcoded=[...document.querySelectorAll('.stat .sv')].map(x=>x.textContent.trim());
  return out;
});

async function stan(){ return p.evaluate(()=>({
  etap:document.getElementById('stEtap').textContent,
  medal:(document.getElementById('medal').innerText||'').replace(/\s+/g,' ').slice(0,90),
  orbitSlajdy:document.querySelectorAll('#orbit .slide').length,
  orbitVisible:!document.getElementById('orbit').classList.contains('hidden'),
  carouVisible:!document.getElementById('carou').classList.contains('hidden'),
  theme:document.documentElement.dataset.theme
})); }

console.log('START      ', JSON.stringify(await stan()));
await p.click('.viewsw button[data-v="b"]'); await p.waitForTimeout(300);
console.log('KARUZELA   ', JSON.stringify(await stan()));
await p.click('.arrow >> nth=1'); await p.waitForTimeout(300);
console.log('strzalka > ', JSON.stringify(await stan()));
await p.keyboard.press('ArrowRight'); await p.waitForTimeout(250);
console.log('klawisz >  ', JSON.stringify(await stan()));
await p.click('.viewsw button[data-v="c"]'); await p.waitForTimeout(300);
console.log('8 ETAPOW   ', JSON.stringify(await stan()));
await p.click('#orbit .slide >> nth=5'); await p.waitForTimeout(300);
console.log('klik slajd6', JSON.stringify(await stan()));
await p.click('#themeBtn'); await p.waitForTimeout(300);
console.log('MOTYW      ', JSON.stringify(await stan()));
await p.click('nav button >> nth=1'); await p.waitForTimeout(300);
console.log('nav Materia', JSON.stringify(await stan()));
await p.click('.pillset button >> nth=1'); await p.waitForTimeout(300);
console.log('nav TAJSKI ', JSON.stringify(await stan()));

console.log('\nMARTWE:', JSON.stringify(martwe,null,1));
console.log('BLEDY JS:', errs.length?errs:'brak');

// telefon
const m=await b.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
await m.goto('file:///home/claude/coach/makieta_slajdy_2026-09-03.html'); await m.waitForTimeout(600);
const tel=await m.evaluate(()=>{
  const s=document.querySelector('#orbit .slide'), c=s&&s.querySelector('.cap b');
  const r=s?s.getBoundingClientRect():null;
  return {szerKafla:r?Math.round(r.width):null, wysKafla:r?Math.round(r.height):null,
    fontPodpisu:c?getComputedStyle(c).fontSize:null,
    przewijaniePoziome:document.documentElement.scrollWidth>window.innerWidth,
    scrollW:document.documentElement.scrollWidth};
});
console.log('\nTELEFON 390px:', JSON.stringify(tel));
await b.close();
})();
