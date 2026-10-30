/**
 * HubbleNest AI Game Builder
 *
 * Two REAL generation paths — no mock, no placeholder, no simulation:
 *
 *  1. GEMINI (full AI): when a Gemini API key has been saved once in
 *     Settings (stored in Firestore config/ai, surviving redeploys like the
 *     push config), the prompt is sent to the real Gemini API and the model
 *     writes the complete game code. Response is validated before use.
 *
 *  2. BUILT-IN SYNTHESIZER (always works, zero config): the prompt is parsed
 *     for a game archetype (snake, pong, breakout, flappy, shooter, catcher,
 *     runner), difficulty/speed modifiers, palette and theme words, and a
 *     complete, genuinely playable game is synthesized from real parameterized
 *     engine templates. This is genuine procedural generation — the output is
 *     a full game the member can then tweak and publish.
 *
 * Both paths output the classic editor triple { title, description, html,
 * css, js } so the game lands straight in the Arcade editor with a live
 * preview, and the member stays in control before publishing.
 */

import { db, doc, getDoc } from './firebase.js';

/* ======================================================================
   AI CONFIG (config/ai — one-time setup in Settings, like the push config)
   ====================================================================== */

export async function getAiConfig() {
  try {
    const snap = await getDoc(doc(db, 'config', 'ai'));
    if (snap.exists()) {
      const d = snap.data();
      return { apiKey: d.apiKey || '', model: d.model || 'gemini-2.0-flash', ownerUid: d.ownerUid || '' };
    }
  } catch (e) {
    console.warn('[HubbleNest] AI config not readable:', e?.code || e);
  }
  return { apiKey: '', model: 'gemini-2.0-flash', ownerUid: '' };
}

/* ======================================================================
   PROMPT UNDERSTANDING (shared by both paths)
   ====================================================================== */

const ARCHETYPES = {
  snake:    ['snake', 'worm', 'grow', 'eat', 'food', 'nio'],
  pong:     ['pong', 'ping', 'paddle ball', 'table tennis', 'tennis'],
  breakout: ['breakout', 'brick', 'arkanoid', 'paddle and ball', 'block break'],
  flappy:   ['flappy', 'bird', 'fly through', 'pipes', 'flap'],
  shooter:  ['shooter', 'shoot', 'space invaders', 'asteroid', 'invader', 'bullet', 'alien', 'spaceship', 'space ship'],
  catcher:  ['catch', 'falling', 'drop', 'orbit', 'basket', 'collect'],
  runner:   ['runner', 'run', 'jump', 'dino', 'obstacle', 'endless']
};

const PALETTES = {
  neon:   { bg: '#0b1020', fg: '#eef2ff', accent: '#22d3ee', accent2: '#a78bfa', danger: '#f43f5e' },
  space:  { bg: '#050814', fg: '#e8eaf6', accent: '#8b5cf6', accent2: '#38bdf8', danger: '#ef4444' },
  forest: { bg: '#0a1a12', fg: '#e7f6ec', accent: '#34d399', accent2: '#a3e635', danger: '#f87171' },
  ocean:  { bg: '#04182b', fg: '#e0f2fe', accent: '#22d3ee', accent2: '#60a5fa', danger: '#fb7185' },
  candy:  { bg: '#2b0a24', fg: '#fdf2f8', accent: '#f472b6', accent2: '#c084fc', danger: '#fb7185' },
  retro:  { bg: '#1a1408', fg: '#fde68a', accent: '#fbbf24', accent2: '#84cc16', danger: '#ef4444' },
  fire:   { bg: '#1c0a05', fg: '#ffedd5', accent: '#fb923c', accent2: '#facc15', danger: '#ef4444' },
  ice:    { bg: '#0a1628', fg: '#e0f2fe', accent: '#93c5fd', accent2: '#e0f2fe', danger: '#f472b6' }
};

const SPEED_WORDS = {
  'insane': 1.9, 'very fast': 1.8, 'fast': 1.4, 'brutal': 1.7, 'hard': 1.35,
  'chill': 0.75, 'slow': 0.7, 'easy': 0.8, 'relax': 0.7, 'casual': 0.85,
  'normal': 1.0, 'medium': 1.0
};

export function analyzePrompt(prompt) {
  const p = (prompt || '').toLowerCase();

  let archetype = 'catcher';
  let bestHits = 0;
  for (const [name, words] of Object.entries(ARCHETYPES)) {
    const hits = words.filter((w) => p.includes(w)).length;
    if (hits > bestHits) { bestHits = hits; archetype = name; }
  }

  let theme = 'neon';
  for (const t of Object.keys(PALETTES)) { if (p.includes(t)) { theme = t; break; } }
  const colorWords = { red: 'fire', blue: 'ice', green: 'forest', pink: 'candy', purple: 'space', orange: 'fire', cyan: 'ocean', gold: 'retro', ice: 'ice' };
  if (PALETTES[theme] === PALETTES.neon) {
    for (const [w, t] of Object.entries(colorWords)) { if (p.includes(w)) { theme = t; break; } }
  }

  let speed = 1.0;
  for (const [w, m] of Object.entries(SPEED_WORDS)) { if (p.includes(w)) { speed = m; break; } }
  if (/\btwo player|2 player|versus|vs\b/.test(p)) speed = Math.max(speed, 1.15);

  const small = /\bsmall|tiny\b/.test(p);
  const big = /\bbig|large|huge\b/.test(p);

  // A friendly title: capitalize the archetype, keep salient nouns
  const titleWords = prompt.trim().split(/\s+/).slice(0, 5).join(' ').replace(/[^\w\s'-]/g, '');
  const title = (titleWords || defaultTitle(archetype)).slice(0, 60)
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return { archetype, theme, palette: PALETTES[theme], speed, small, big, title, raw: (prompt || '').trim() };
}

function defaultTitle(archetype) {
  return { snake: 'Neon Snake', pong: 'Retro Pong', breakout: 'Brick Buster', flappy: 'Sky Flap', shooter: 'Star Defender', catcher: 'Orbit Catch', runner: 'Endless Runner' }[archetype] || 'Prompt Game';
}

/* ======================================================================
   GEMINI PATH
   ====================================================================== */

const GEMINI_SYSTEM_PROMPT = `You are a senior HTML5 game developer. Write a COMPLETE, playable browser game.
Answer with ONLY a JSON object (no markdown fences, no commentary) with EXACTLY these keys:
{"title": string (max 60 chars), "description": string (max 200 chars), "html": string, "css": string, "js": string}
Rules:
- html is the BODY content only (no <html>/<head>/<body> tags, no <script> or <link> tags).
- css is plain CSS; js is plain browser JavaScript (canvas API allowed and encouraged).
- The game MUST run instantly with no external assets, no network, no imports, no localStorage
  (the sandbox iframe has an opaque origin — wrap storage in try/catch if used at all).
- Must support keyboard AND touch/click where sensible, show a score, handle game over, and offer a restart.
- Keep total size under 350 KB. Make it polished, juicy and fun.`;

export async function generateWithGemini(prompt, apiKey, model) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || 'gemini-2.0-flash')}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: GEMINI_SYSTEM_PROMPT + '\n\nGame request: ' + prompt }] }],
      generationConfig: { temperature: 0.8, maxOutputTokens: 8192 }
    })
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error?.message || ''; } catch (e) { /* ignore */ }
    throw new Error(`Gemini API ${res.status}: ${detail.slice(0, 180) || res.statusText}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  let obj;
  try { obj = JSON.parse(cleaned); } catch (e) {
    // Tolerate a JSON object embedded in prose
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('The AI answer was not valid game JSON.');
    obj = JSON.parse(m[0]);
  }
  if (!obj || typeof obj.html !== 'string' || typeof obj.js !== 'string') {
    throw new Error('The AI answer was missing the html/js game code.');
  }
  return {
    title: String(obj.title || 'AI Game').slice(0, 60),
    description: String(obj.description || 'Generated with AI from a prompt.').slice(0, 200),
    html: obj.html, css: String(obj.css || ''), js: obj.js,
    source: 'gemini'
  };
}

/* ======================================================================
   BUILT-IN SYNTHESIZER — real parameterized game engines
   Every template is a complete, playable game wired for keyboard + touch.
   ====================================================================== */

function shellCss(pal) {
  return `html,body{margin:0;height:100%;background:${pal.bg};color:${pal.fg};font-family:system-ui,sans-serif;overflow:hidden;user-select:none;-webkit-user-select:none}
#stage{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px}
#hud{font-weight:800;font-size:clamp(15px,3.4vw,22px);letter-spacing:.02em;display:flex;gap:18px;align-items:center}
#hud .pill{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);padding:4px 14px;border-radius:999px}
#board{position:relative;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.12);border-radius:14px;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.45)}
canvas{display:block;touch-action:none}
#overlay{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:rgba(5,8,20,.72);backdrop-filter:blur(3px);text-align:center;padding:20px}
#overlay h1{margin:0;font-size:clamp(20px,5vw,34px);color:${pal.accent}}
#overlay p{margin:0;color:${pal.fg};opacity:.85;font-size:clamp(13px,2.6vw,16px);max-width:420px;line-height:1.5}
#overlay button{font:inherit;font-weight:800;padding:12px 30px;border-radius:999px;border:0;cursor:pointer;background:linear-gradient(135deg,${pal.accent},${pal.accent2});color:#0b1020;box-shadow:0 10px 30px ${pal.accent}55}
.hidden{display:none !important}`;
}

function shellHtml(title, hint) {
  return `<div id="stage">
  <div id="hud"><span class="pill" id="score">Score 0</span><span class="pill" id="best">Best 0</span></div>
  <div id="board">
    <canvas id="game" width="420" height="560"></canvas>
    <div id="overlay">
      <h1>${title}</h1>
      <p>${hint}</p>
      <button id="startBtn">Play</button>
    </div>
  </div>
</div>`;
}

function shellJsBase() {
  return `const canvas=document.getElementById('game'),ctx=canvas.getContext('2d');
const W=canvas.width,H=canvas.height;
const scoreEl=document.getElementById('score'),bestEl=document.getElementById('best'),overlay=document.getElementById('overlay'),startBtn=document.getElementById('startBtn');
function lsGet(k){try{return localStorage.getItem(k)}catch(e){return null}}
function lsSet(k,v){try{return localStorage.setItem(k,v)}catch(e){}}
let running=false,score=0,best=parseInt(lsGet('hn_best')||'0',10)||0;
bestEl.textContent='Best '+best;
function setScore(v){score=v;scoreEl.textContent='Score '+score;if(score>best){best=score;bestEl.textContent='Best '+best;lsSet('hn_best',String(best))}}
function showOver(msg){running=false;overlay.querySelector('h1').textContent='Game over';overlay.querySelector('p').textContent=msg+' Final score: '+score+'.';startBtn.textContent='Play again';overlay.classList.remove('hidden')}
function begin(){overlay.classList.add('hidden');running=true;reset();last=performance.now();requestAnimationFrame(loop)}
startBtn.addEventListener('click',begin);
let last=0;
function loop(ts){if(!running)return;const dt=Math.min(40,ts-last);last=ts;update(dt/16.666);draw();requestAnimationFrame(loop)}
const KEY={};addEventListener('keydown',e=>{KEY[e.key]=true;if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key))e.preventDefault();},{passive:false});
addEventListener('keyup',e=>{KEY[e.key]=false});
function pointer(el,fn){el.addEventListener('pointerdown',e=>{e.preventDefault();fn(e)});}`;
}

function gameSnake(a) {
  const cell = a.big ? 26 : a.small ? 18 : 21;
  return {
    html: shellHtml(a.title, 'Arrow keys or swipe to steer. Eat the glowing orbs — hitting yourself ends the run.'),
    css: shellCss(a.palette),
    js: shellJsBase() + `
const CELL=${cell},COLS=Math.floor(W/CELL),ROWS=Math.floor(H/CELL);
const PAL=${JSON.stringify(a.palette)};const STEP_FRAMES=${(8.4 / a.speed).toFixed(1)};
let snake,dir,nextDir,food,timer=0;
function reset(){snake=[{x:COLS>>1,y:ROWS>>1}];dir={x:1,y:0};nextDir=dir;spawnFood();setScore(0)}
function spawnFood(){do{food={x:(Math.random()*COLS)|0,y:(Math.random()*ROWS)|0}}while(snake.some(s=>s.x===food.x&&s.y===food.y))}
function step(){dir=nextDir;const head={x:snake[0].x+dir.x,y:snake[0].y+dir.y};
if(head.x<0||head.y<0||head.x>=COLS||head.y>=ROWS||snake.some(s=>s.x===head.x&&s.y===head.y)){showOver('You crashed.');return}
snake.unshift(head);
if(head.x===food.x&&head.y===food.y){setScore(score+10);spawnFood()}else snake.pop()}
function update(dt){timer+=dt;if(timer>=STEP_FRAMES){timer=0;step()}}
function swipe(){let sx=null,sy=null;
canvas.addEventListener('touchstart',e=>{sx=e.touches[0].clientX;sy=e.touches[0].clientY},{passive:true});
canvas.addEventListener('touchmove',e=>{if(sx===null)return;const dx=e.touches[0].clientX-sx,dy=e.touches[0].clientY-sy;
if(Math.abs(dx)>24||Math.abs(dy)>24){if(Math.abs(dx)>Math.abs(dy))nextDir={x:dx>0?1:-1,y:0};else nextDir={x:0,y:dy>0?1:-1};sx=e.touches[0].clientX;sy=e.touches[0].clientY}},{passive:true})}
swipe();
addEventListener('keydown',()=>{if(KEY.ArrowUp&&dir.y===0)nextDir={x:0,y:-1};if(KEY.ArrowDown&&dir.y===0)nextDir={x:0,y:1};if(KEY.ArrowLeft&&dir.x===0)nextDir={x:-1,y:0};if(KEY.ArrowRight&&dir.x===0)nextDir={x:1,y:0}});
function draw(){ctx.fillStyle='${a.palette.bg}';ctx.fillRect(0,0,W,H);
ctx.fillStyle='${a.palette.danger}';ctx.beginPath();ctx.arc(food.x*CELL+CELL/2,food.y*CELL+CELL/2,CELL*0.38,0,7);ctx.fill();
snake.forEach((s,i)=>{ctx.fillStyle=i===0?'${a.palette.accent}':'${a.palette.accent2}';ctx.globalAlpha=i===0?1:Math.max(.35,1-i/snake.length);ctx.beginPath();ctx.roundRect(s.x*CELL+1,s.y*CELL+1,CELL-2,CELL-2,5);ctx.fill()});ctx.globalAlpha=1;}
if(!ctx.roundRect){ctx.roundRect=function(x,y,w,h,r){this.beginPath();this.moveTo(x+r,y);this.arcTo(x+w,y,x+w,y+h,r);this.arcTo(x+w,y+h,x,y+h,r);this.arcTo(x,y+h,x,y,r);this.arcTo(x,y,x+w,y,r);this.closePath()};}`,
    title: a.title, description: 'Classic snake with a ' + a.theme + ' glow — eat orbs, grow, survive.'
  };
}

function gamePong(a) {
  return {
    html: shellHtml(a.title, 'Move with the mouse, finger, or ↑/↓ keys. First to 7 wins.'),
    css: shellCss(a.palette),
    js: shellJsBase() + `
const PAL=${JSON.stringify(a.palette)};const SPD=${a.speed.toFixed(2)};
let py=(H-90)/2,ay=(H-90)/2,bx=W/2,by=H/2,vx=4.4*SPD,vy=2.6*SPD,me=0,ai=0;const PH=90,PW=12;
function reset(){bx=W/2;by=H/2;vx=(Math.random()<.5?-1:1)*4.4*SPD;vy=(Math.random()*2-1)*2.6*SPD}
function update(){bx+=vx;by+=vy;py+=(KEY.ArrowUp?-7*SPD:0)+(KEY.ArrowDown?7*SPD:0);
py=Math.max(0,Math.min(H-PH,py));
ay+=(by-(ay+PH/2))*0.055*SPD;ay=Math.max(0,Math.min(H-PH,ay));
if(by<6||by>H-6)vy=-vy;
if(bx<26&&bx>14&&by>py&&by<py+PH){vx=Math.abs(vx)*1.04;vy+=(by-(py+PH/2))*0.12}
if(bx>W-26&&bx<W-14&&by>ay&&by<ay+PH){vx=-Math.abs(vx)*1.04;vy+=(by-(ay+PH/2))*0.12}
if(bx<0){ai++;scoreUi();reset()}
if(bx>W){me++;setScore(me);scoreUi();reset()}
if(me>=7){showOver('You win 7-'+ai+'!')}else if(ai>=7){showOver('The AI wins '+ai+'-'+me+'.')}}
function scoreUi(){scoreEl.textContent='You '+me+' — '+ai+' AI'}
canvas.addEventListener('pointermove',e=>{const r=canvas.getBoundingClientRect();py=Math.max(0,Math.min(H-PH,(e.clientY-r.top)*(H/r.height)-PH/2))});
function draw(){ctx.fillStyle='${a.palette.bg}';ctx.fillRect(0,0,W,H);
ctx.strokeStyle='rgba(255,255,255,.15)';ctx.setLineDash([8,10]);ctx.beginPath();ctx.moveTo(W/2,0);ctx.lineTo(W/2,H);ctx.stroke();ctx.setLineDash([]);
ctx.fillStyle='${a.palette.accent}';ctx.fillRect(14,py,PW,PH);
ctx.fillStyle='${a.palette.danger}';ctx.fillRect(W-14-PW,ay,PW,PH);
ctx.fillStyle='${a.palette.accent2}';ctx.beginPath();ctx.arc(bx,by,7,0,7);ctx.fill()}`,
    title: a.title, description: 'Paddle duel against a reactive AI — first to 7.'
  };
}

function gameBreakout(a) {
  return {
    html: shellHtml(a.title, 'Slide the paddle with mouse, finger or ←/→. Clear every brick.'),
    css: shellCss(a.palette),
    js: shellJsBase() + `
const PAL=${JSON.stringify(a.palette)};const SPD=${a.speed.toFixed(2)};
const COLS=8,ROWS=6,BW=(W-40-(COLS-1)*8)/COLS,BH=20;const PW=86,PH=13;
let px=(W-PW)/2,bricks=[],bx,by,vx,vy,lives=3,level=1;
function buildBricks(){bricks=[];for(let r=0;r<ROWS;r++)for(let c=0;c<COLS;c++)bricks.push({x:20+c*(BW+8),y:56+r*(BH+8),alive:true,hue:(r*${Math.round(360 / 6)}+${a.hueShift || 0})%360})}
function reset(){bx=W/2;by=H-60;vx=3.6*SPD*(Math.random()<.5?-1:1);vy=-4.6*SPD}
function fullReset(){lives=3;setScore(0);buildBricks();reset()}
function update(){px+=(KEY.ArrowLeft?-9*SPD:0)+(KEY.ArrowRight?9*SPD:0);px=Math.max(0,Math.min(W-PW,px));
bx+=vx;by+=vy;
if(bx<7||bx>W-7)vx=-vx;if(by<7)vy=Math.abs(vy);
if(by>H-40-PH&&by<H-40&&bx>px&&bx<px+PW&&vy>0){vy=-Math.abs(vy)*1.03;vx+=(bx-(px+PW/2))*0.07}
if(by>H+10){lives--;if(lives<=0){showOver('Ball lost.');}else reset()}
for(const b of bricks){if(!b.alive)continue;
if(bx>b.x-6&&bx<b.x+BW+6&&by>b.y-6&&by<b.y+BH+6){b.alive=false;vy=-vy;setScore(score+10);break}}
if(bricks.every(b=>!b.alive)){level++;buildBricks();reset()}}
canvas.addEventListener('pointermove',e=>{const r=canvas.getBoundingClientRect();px=Math.max(0,Math.min(W-PW,(e.clientX-r.left)*(W/r.width)-PW/2))});
fullReset();
function draw(){ctx.fillStyle='${a.palette.bg}';ctx.fillRect(0,0,W,H);
for(const b of bricks){if(!b.alive)continue;ctx.fillStyle='hsl('+b.hue+' 80% 62%)';ctx.beginPath();ctx.roundRect(b.x,b.y,BW,BH,5);ctx.fill()}
ctx.fillStyle='${a.palette.accent}';ctx.beginPath();ctx.roundRect(px,H-40,PW,PH,7);ctx.fill();
ctx.fillStyle='${a.palette.fg}';ctx.beginPath();ctx.arc(bx,by,7,0,7);ctx.fill();
ctx.font='700 14px system-ui';ctx.fillStyle='rgba(255,255,255,.75)';ctx.fillText('❤'.repeat(Math.max(0,lives)),10,22);}
if(!ctx.roundRect){ctx.roundRect=function(x,y,w,h,r){this.beginPath();this.moveTo(x+r,y);this.arcTo(x+w,y,x+w,y+h,r);this.arcTo(x+w,y+h,x,y+h,r);this.arcTo(x,y+h,x,y,r);this.arcTo(x,y,x+w,y,r);this.closePath()};}`,
    title: a.title, description: 'Break every brick, three lives, rising levels.'
  };
}

function gameFlappy(a) {
  return {
    html: shellHtml(a.title, 'Tap, click or press Space to flap. Thread the gates.'),
    css: shellCss(a.palette),
    js: shellJsBase() + `
const PAL=${JSON.stringify(a.palette)};const SPD=${a.speed.toFixed(2)};
let by=H/2,bv=0,pipes=[],spawnT=0;const GAP=${a.big?210:a.small?140:172},PWID=64;
function reset(){by=H/2;bv=0;pipes=[];spawnT=0;setScore(0)}
function flap(){if(!running){begin();return}bv=-7.4}
function update(){bv+=0.42*SPD;by+=bv;
spawnT+=1;if(spawnT>${Math.round(92 / a.speed)}){spawnT=0;pipes.push({x:W+PWID,gy:60+Math.random()*(H-GAP-120),passed:false})}
for(const p of pipes){p.x-=3.1*SPD;
if(!p.passed&&p.x+PWID<W/2-30){p.passed=true;setScore(score+1)}
if(W/2-14>p.x&&W/2-14<p.x+PWID&&(by-12<p.gy||by+12>p.gy+GAP)){showOver('You hit a gate.')}}
pipes=pipes.filter(p=>p.x>-PWID-10);
if(by>H-8||by<0)showOver('Out of bounds.')}
pointer(canvas,flap);addEventListener('keydown',e=>{if(e.key===' ')flap()});
reset();
function draw(){ctx.fillStyle='${a.palette.bg}';ctx.fillRect(0,0,W,H);
ctx.fillStyle='${a.palette.accent2}';
for(const p of pipes){ctx.beginPath();ctx.roundRect(p.x,0,PWID,p.gy,8);ctx.fill();ctx.beginPath();ctx.roundRect(p.x,p.gy+GAP,PWID,H-p.gy-GAP,8);ctx.fill()}
ctx.fillStyle='${a.palette.accent}';ctx.beginPath();ctx.arc(W/2-30,by,13,0,7);ctx.fill();
ctx.fillStyle='#0b1020';ctx.beginPath();ctx.arc(W/2-25,by-4,3,0,7);ctx.fill();}
if(!ctx.roundRect){ctx.roundRect=function(x,y,w,h,r){this.beginPath();this.moveTo(x+r,y);this.arcTo(x+w,y,x+w,y+h,r);this.arcTo(x+w,y+h,x,y+h,r);this.arcTo(x,y+h,x,y,r);this.arcTo(x,y,x+w,y,r);this.closePath()};}`,
    title: a.title, description: 'One-button flying — time the gaps, chase the best score.'
  };
}

function gameShooter(a) {
  return {
    html: shellHtml(a.title, 'Move with mouse/finger or ←/→, Space or tap to shoot. Survive the swarm.'),
    css: shellCss(a.palette),
    js: shellJsBase() + `
const PAL=${JSON.stringify(a.palette)};const SPD=${a.speed.toFixed(2)};
let px=W/2,bullets=[],enemies=[],ebullets=[],spawnT=0,fireT=0,lives=3;
function reset(){px=W/2;bullets=[];enemies=[];ebullets=[];spawnT=0;fireT=0;lives=3;setScore(0)}
function shoot(){if(fireT>0||!running)return;fireT=${Math.round(14 / a.speed)};bullets.push({x:px,y:H-56})}
function update(){px+=(KEY.ArrowLeft?-7.5*SPD:0)+(KEY.ArrowRight?7.5*SPD:0);
px=Math.max(18,Math.min(W-18,px));fireT--;
if(KEY[' '])shoot();
bullets.forEach(b=>b.y-=9*SPD);bullets=bullets.filter(b=>b.y>-10);
spawnT++;if(spawnT>${Math.round(50 / a.speed)}){spawnT=0;enemies.push({x:30+Math.random()*(W-60),y:-24,vx:(Math.random()*2-1)*1.4*SPD,vy:(1.1+Math.random()*1.4)*SPD,hp:1})}
enemies.forEach(e=>{e.x+=e.vx;e.y+=e.vy;if(e.x<20||e.x>W-20)e.vx*=-1;
if(Math.random()<0.006*SPD)ebullets.push({x:e.x,y:e.y+14})});
ebullets.forEach(b=>b.y+=5.4*SPD);ebullets=ebullets.filter(b=>b.y<H+10);
for(const e of enemies){if(Math.abs(e.x-px)<20&&Math.abs(e.y-(H-42))<22){e.hp=0;lives--;if(lives<=0)showOver('Your ship was hit.')}
for(const b of bullets){if(Math.abs(b.x-e.x)<16&&Math.abs(b.y-e.y)<16){e.hp=0;b.y=-99;setScore(score+15);break}}}
bullets=bullets.filter(b=>b.y>-10);enemies=enemies.filter(e=>e.hp>0&&e.y<H+30);
if(enemies.some(e=>e.y>H-30)){enemies=enemies.filter(e=>e.y<=H-30);lives--;if(lives<=0)showOver('An invader broke through.')}}
pointer(canvas,shoot);
canvas.addEventListener('pointermove',e=>{const r=canvas.getBoundingClientRect();px=Math.max(18,Math.min(W-18,(e.clientX-r.left)*(W/r.width)))});
addEventListener('keydown',e=>{if(e.key===' ')shoot()});
reset();
function draw(){ctx.fillStyle='${a.palette.bg}';ctx.fillRect(0,0,W,H);
ctx.fillStyle='${a.palette.accent}';
ctx.beginPath();ctx.moveTo(px,H-56);ctx.lineTo(px-16,H-24);ctx.lineTo(px+16,H-24);ctx.closePath();ctx.fill();
ctx.fillStyle='${a.palette.accent2}';bullets.forEach(b=>ctx.fillRect(b.x-2,b.y-8,4,10));
ctx.fillStyle='${a.palette.danger}';enemies.forEach(e=>{ctx.beginPath();ctx.arc(e.x,e.y,13,0,7);ctx.fill()});
ctx.fillStyle='#fca5a5';ebullets.forEach(b=>ctx.fillRect(b.x-2,b.y,4,8));
ctx.font='700 14px system-ui';ctx.fillStyle='rgba(255,255,255,.75)';ctx.fillText('❤'.repeat(Math.max(0,lives)),10,22);}`,
    title: a.title, description: 'Blast the incoming swarm, dodge their fire, three lives.'
  };
}

function gameCatcher(a) {
  const noun = (a.raw.match(/\b(stars?|apples?|eggs?|coins?|hearts?|balls?|orbs?|snow|leaves?|candy|fruits?)\b/i) || ['orbs'])[0];
  return {
    html: shellHtml(a.title, 'Slide the tray with mouse, finger or ←/→. Catch the falling ' + noun + ', avoid the red ones.'),
    css: shellCss(a.palette),
    js: shellJsBase() + `
const PAL=${JSON.stringify(a.palette)};const SPD=${a.speed.toFixed(2)};const TW=${a.big?130:96};
let px=W/2,items=[],spawnT=0,lives=3,fallN=0;
function reset(){px=W/2;items=[];spawnT=0;lives=3;setScore(0)}
function update(){px+=(KEY.ArrowLeft?-9*SPD:0)+(KEY.ArrowRight?9*SPD:0);px=Math.max(TW/2,Math.min(W-TW/2,px));
spawnT++;if(spawnT>${Math.round(34 / a.speed)}){spawnT=0;fallN++;
items.push({x:26+Math.random()*(W-52),y:-16,vy:(2.2+Math.random()*1.8+fallN*0.02)*SPD,bad:Math.random()<0.18})}
for(const it of items){it.y+=it.vy;
if(it.y>H-52&&it.y<H-30&&Math.abs(it.x-px)<TW/2+10){it.y=H+99;
if(it.bad){lives--;if(lives<=0){showOver('Too many bad ones.')}}else setScore(score+10)}}
items=items.filter(it=>it.y<H+20);
if(items.some(it=>!it.bad&&it.y>=H+19&&it.vy>0)){/* missed orbs just fall */}}
canvas.addEventListener('pointermove',e=>{const r=canvas.getBoundingClientRect();px=Math.max(TW/2,Math.min(W-TW/2,(e.clientX-r.left)*(W/r.width)))});
reset();
function draw(){ctx.fillStyle='${a.palette.bg}';ctx.fillRect(0,0,W,H);
for(const it of items){ctx.fillStyle=it.bad?'${a.palette.danger}':'${a.palette.accent}';ctx.beginPath();ctx.arc(it.x,it.y,11,0,7);ctx.fill();
ctx.fillStyle='rgba(255,255,255,.35)';ctx.beginPath();ctx.arc(it.x-3,it.y-3,4,0,7);ctx.fill()}
ctx.fillStyle='${a.palette.accent2}';ctx.beginPath();ctx.roundRect(px-TW/2,H-52,TW,14,7);ctx.fill();
ctx.font='700 14px system-ui';ctx.fillStyle='rgba(255,255,255,.75)';ctx.fillText('❤'.repeat(Math.max(0,lives)),10,22);}
if(!ctx.roundRect){ctx.roundRect=function(x,y,w,h,r){this.beginPath();this.moveTo(x+r,y);this.arcTo(x+w,y,x+w,y+h,r);this.arcTo(x+w,y+h,x,y+h,r);this.arcTo(x,y+h,x,y,r);this.arcTo(x,y,x+w,y,r);this.closePath()};}`,
    title: a.title, description: 'Catch the good ' + noun + ', dodge the red ones.'
  };
}

function gameRunner(a) {
  return {
    html: shellHtml(a.title, 'Tap, click or ↑/Space to jump. Survive as long as you can.'),
    css: shellCss(a.palette),
    js: shellJsBase() + `
const PAL=${JSON.stringify(a.palette)};const SPD=${a.speed.toFixed(2)};
let gy=H-70,y=gy,vy=0,obs=[],spawnT=0,speed=4.6*SPD,ground1=0;
function reset(){y=gy;vy=0;obs=[];spawnT=0;speed=4.6*SPD;setScore(0)}
function jump(){if(!running){begin();return}if(y>=gy-1){vy=-11.2}}
function update(){vy+=0.52;y+=vy;if(y>gy){y=gy;vy=0}
speed+=0.0016*SPD;ground1=(ground1-speed)%48;
spawnT++;if(spawnT>${Math.round(70 / a.speed)}){spawnT=0;const h=26+Math.random()*34;obs.push({x:W+30,w:18+Math.random()*20,h})}
obs.forEach(o=>o.x-=speed);obs=obs.filter(o=>o.x>-60);
for(const o of obs){if(70+20>o.x&&70-6<o.x+o.w&&y>gy-o.h+2&&y<=gy+2){showOver('You hit an obstacle.')}}
if(running)setScore(score+1)}
pointer(canvas,jump);addEventListener('keydown',e=>{if(e.key===' '||e.key==='ArrowUp')jump()});
reset();
function draw(){ctx.fillStyle='${a.palette.bg}';ctx.fillRect(0,0,W,H);
ctx.strokeStyle='rgba(255,255,255,.22)';ctx.lineWidth=2;ctx.beginPath();
for(let x=ground1;x<W;x+=48){ctx.moveTo(x,H-46);ctx.lineTo(x+26,H-46)}ctx.stroke();
ctx.fillStyle='${a.palette.danger}';obs.forEach(o=>{ctx.beginPath();ctx.roundRect(o.x,gy-o.h,o.w,o.h,5);ctx.fill()});
ctx.fillStyle='${a.palette.accent}';const sq=y>=gy-1?0:2;ctx.beginPath();ctx.roundRect(58,y-26+sq,30,26-sq,7);ctx.fill();}
if(!ctx.roundRect){ctx.roundRect=function(x,y,w,h,r){this.beginPath();this.moveTo(x+r,y);this.arcTo(x+w,y,x+w,y+h,r);this.arcTo(x+w,y+h,x,y+h,r);this.arcTo(x,y+h,x,y,r);this.arcTo(x,y,x+w,y,r);this.closePath()};}`,
    title: a.title, description: 'Endless runner — one button, rising speed, beat your best.'
  };
}

const BUILDERS = { snake: gameSnake, pong: gamePong, breakout: gameBreakout, flappy: gameFlappy, shooter: gameShooter, catcher: gameCatcher, runner: gameRunner };

export function synthesizeGameFromPrompt(prompt) {
  const a = analyzePrompt(prompt);
  const built = (BUILDERS[a.archetype] || gameCatcher)(a);
  return {
    title: built.title || a.title,
    description: built.description,
    html: built.html,
    css: built.css,
    js: built.js,
    source: 'builtin',
    archetype: a.archetype
  };
}

/**
 * One entry point used by the Arcade editor.
 * Tries Gemini when a key is configured; falls back to the built-in
 * synthesizer (and reports honestly which path produced the game).
 */
export async function generateGameCode(prompt) {
  const cfg = await getAiConfig();
  if (cfg.apiKey) {
    try {
      const result = await generateWithGemini(prompt, cfg.apiKey, cfg.model);
      return { ...result, fallbackReason: null };
    } catch (err) {
      console.warn('[HubbleNest] Gemini generation failed, using the built-in game synthesizer:', err.message);
      const result = synthesizeGameFromPrompt(prompt);
      return { ...result, fallbackReason: err.message };
    }
  }
  return { ...synthesizeGameFromPrompt(prompt), fallbackReason: null };
}
