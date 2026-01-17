const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");
const W = canvas.width, H = canvas.height;

const uiHP = document.getElementById("hp");
const uiEHP = document.getElementById("ehp");
const uiCombo = document.getElementById("combo");

const keys = new Set();

function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
function lerp(a,b,t){ return a + (b-a)*t; }

const world = {
  g: 2200,
  floorY: H - 70,
  time: 0,
  slowT: 0,
  shake: 0,
  shakeT: 0,
};

const fx = [];      // particelle & slash
const proj = [];    // proiettili
const hitboxes = []; // hitbox attive (melee/ability)

function addFX(p){ fx.push(p); }
function addShake(power, t=0.2){ world.shake = Math.max(world.shake, power); world.shakeT = Math.max(world.shakeT, t); }

function sfxText(x,y,txt,life=0.5){
  addFX({type:"text", x, y, txt, vy:-80, life, t:0});
}

function spawnSlash(x,y,dir){
  addFX({type:"slash", x, y, dir, life:0.18, t:0});
}

function spawnBurst(x,y,n=18){
  for(let i=0;i<n;i++){
    const a = Math.random()*Math.PI*2;
    const sp = 180 + Math.random()*420;
    addFX({type:"p", x, y, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp, life:0.5+Math.random()*0.4, t:0});
  }
}

function rectsOverlap(a,b){
  return a.x < b.x+b.w && a.x+a.w > b.x && a.y < b.y+b.h && a.y+a.h > b.y;
}

function makeFighter(x, team){
  return {
    team,
    x, y: world.floorY,
    vx: 0, vy: 0,
    facing: team === "P" ? 1 : -1,
    hp: 100,
    onGround: true,

    // anim pose
    pose: "idle",
    poseT: 0,

    // combo
    combo: 0,
    comboT: 0,
    invT: 0,

    // cooldowns
    cd: { dash:0, shock:0, fire:0 },

    // AI
    aiT: 0,
  };
}

let P = makeFighter(220, "P");
let E = makeFighter(740, "E");

function reset(){
  P = makeFighter(220, "P");
  E = makeFighter(740, "E");
  fx.length = 0;
  proj.length = 0;
  hitboxes.length = 0;
  world.time = 0;
  world.slowT = 0;
  world.shake = 0;
  world.shakeT = 0;
}
reset();

// ---- INPUT ----
window.addEventListener("keydown", (e) => {
  keys.add(e.key.toLowerCase());
  if (e.key.toLowerCase() === "r") reset();
});
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

// ---- COMBAT SYSTEM ----
function hurt(target, dmg, knockX, knockY, attacker){
  if (target.invT > 0) return;

  target.hp = Math.max(0, target.hp - dmg);
  target.invT = 0.25;

  target.vx += knockX;
  target.vy += knockY;

  // combo solo per player
  if (attacker && attacker.team === "P"){
    attacker.combo += 1;
    attacker.comboT = 1.2;
    uiCombo.textContent = String(attacker.combo);
  }

  spawnBurst(target.x, target.y - 60, 14);
  sfxText(target.x, target.y - 120, `-${dmg}`, 0.6);
  addShake(10, 0.15);

  if (dmg >= 18){ // "cinematic moment"
    world.slowT = 0.18;
    addShake(18, 0.25);
  }
}

function addHitbox(owner, x,y,w,h, life, dmg, kx, ky){
  hitboxes.push({owner, x,y,w,h, life, dmg, kx, ky});
}

function attackBasic(f){
  // combo 1-2-3
  const step = (f.combo % 3) + 1;
  f.pose = "atk" + step;
  f.poseT = 0.12;

  const dir = f.facing;
  const hbW = step === 3 ? 90 : 70;
  const dmg = step === 3 ? 22 : 14;
  const kx = dir * (step === 3 ? 520 : 340);
  const ky = step === 3 ? -520 : -220;

  spawnSlash(f.x + dir*34, f.y - 82, dir);
  addHitbox(f, f.x + dir*30, f.y - 140, hbW, 120, 0.10, dmg, kx, ky);

  if (step === 3){
    addShake(16, 0.22);
    world.slowT = Math.max(world.slowT, 0.12);
  }
}

function abilityDash(f){
  if (f.cd.dash > 0) return;
  f.cd.dash = 2.4;
  f.pose = "dash";
  f.poseT = 0.18;

  const dir = f.facing;
  f.vx = dir * 980;
  spawnSlash(f.x + dir*45, f.y - 95, dir);
  addHitbox(f, f.x + dir*40, f.y - 150, 120, 140, 0.12, 18, dir*720, -280);

  addShake(12, 0.18);
  world.slowT = Math.max(world.slowT, 0.10);
}

function abilityShockwave(f){
  if (f.cd.shock > 0) return;
  f.cd.shock = 5.0;
  f.pose = "shock";
  f.poseT = 0.22;

  // onda a terra: grande hitbox davanti + FX
  const dir = f.facing;
  const x = f.x + dir*40;
  const y = f.y - 22;
  addHitbox(f, x, y, 220, 40, 0.16, 20, dir*520, -420);

  addFX({type:"ring", x, y, life:0.35, t:0});
  addShake(18, 0.25);
  world.slowT = Math.max(world.slowT, 0.14);
}

function abilityFireball(f){
  if (f.cd.fire > 0) return;
  f.cd.fire = 3.8;
  f.pose = "cast";
  f.poseT = 0.18;

  const dir = f.facing;
  proj.push({
    x: f.x + dir*42, y: f.y - 100,
    vx: dir*760, vy: -40,
    r: 12,
    owner: f,
    life: 1.5,
  });
  spawnBurst(f.x + dir*36, f.y - 100, 10);
}

// ---- PLAYER CONTROL ----
function controlPlayer(dt){
  const speed = 620;
  const jumpV = -920;

  if (keys.has("a")) { P.vx = lerp(P.vx, -speed, 0.18); P.facing = -1; }
  else if (keys.has("d")) { P.vx = lerp(P.vx, speed, 0.18); P.facing = 1; }
  else P.vx = lerp(P.vx, 0, 0.22);

  if (keys.has("w") && P.onGround){
    P.vy = jumpV;
    P.onGround = false;
    P.pose = "jump";
    P.poseT = 0.12;
  }

  // attacco e abilità
  if (consumeKey("j")) attackBasic(P);
  if (consumeKey("k")) abilityDash(P);
  if (consumeKey("l")) abilityShockwave(P);
  if (consumeKey("i")) abilityFireball(P);

  // combo decay
  P.comboT = Math.max(0, P.comboT - dt);
  if (P.comboT === 0 && P.combo !== 0){
    P.combo = 0;
    uiCombo.textContent = "0";
  }
}

function consumeKey(k){
  if (keys.has(k)){
    keys.delete(k); // one-shot
    return true;
  }
  return false;
}

// ---- ENEMY AI ----
function controlEnemy(dt){
  E.aiT -= dt;
  const dx = P.x - E.x;
  const dist = Math.abs(dx);
  E.facing = dx >= 0 ? 1 : -1;

  // muovi verso player
  const desire = clamp(dx, -1, 1) * 420;
  if (dist > 120) E.vx = lerp(E.vx, desire, 0.08);
  else E.vx = lerp(E.vx, 0, 0.12);

  // decide azione
  if (E.aiT <= 0){
    E.aiT = 0.25 + Math.random()*0.35;

    // abilità a caso se disponibili
    if (dist < 200 && E.cd.shock <= 0 && Math.random() < 0.25) abilityShockwave(E);
    else if (dist < 220 && E.cd.dash <= 0 && Math.random() < 0.25) abilityDash(E);
    else if (dist > 260 && E.cd.fire <= 0 && Math.random() < 0.25) abilityFireball(E);
    else if (dist < 140 && Math.random() < 0.65) attackBasic(E);
  }
}

// ---- PHYSICS & UPDATE ----
function stepFighter(f, dt){
  // cooldowns
  f.cd.dash = Math.max(0, f.cd.dash - dt);
  f.cd.shock = Math.max(0, f.cd.shock - dt);
  f.cd.fire = Math.max(0, f.cd.fire - dt);

  f.invT = Math.max(0, f.invT - dt);

  // pose timer
  f.poseT = Math.max(0, f.poseT - dt);
  if (f.poseT === 0 && f.pose !== "idle") f.pose = "idle";

  // gravità
  f.vy += world.g * dt;
  f.x += f.vx * dt;
  f.y += f.vy * dt;

  // limiti
  f.x = clamp(f.x, 80, W-80);

  // floor
  if (f.y >= world.floorY){
    f.y = world.floorY;
    f.vy = 0;
    f.onGround = true;
  } else f.onGround = false;

  // attrito
  if (f.onGround) f.vx *= 0.90;
}

function stepHitboxes(dt){
  for (const hb of hitboxes){
    hb.life -= dt;
    hb.x += hb.owner.vx * dt * 0.0; // hitbox ancorata quasi al momento
  }
  // collisione
  for (const hb of hitboxes){
    if (hb.life <= 0) continue;
    const target = hb.owner.team === "P" ? E : P;
    const targetRect = { x: target.x-18, y: target.y-150, w: 36, h: 150 };
    const hbRect = { x: hb.x, y: hb.y, w: hb.w, h: hb.h };
    if (rectsOverlap(targetRect, hbRect)){
      hb.life = 0; // una sola hit
      hurt(target, hb.dmg, hb.kx, hb.ky, hb.owner);
    }
  }
  // cleanup
  for (let i=hitboxes.length-1;i>=0;i--){
    if (hitboxes[i].life <= 0) hitboxes.splice(i,1);
  }
}

function stepProjectiles(dt){
  for (const p of proj){
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 260 * dt; // leggera gravità

    // collisione con target
    const target = p.owner.team === "P" ? E : P;
    const targetRect = { x: target.x-18, y: target.y-150, w: 36, h: 150 };
    const pr = { x: p.x-p.r, y: p.y-p.r, w: p.r*2, h: p.r*2 };
    if (p.life > 0 && rectsOverlap(targetRect, pr)){
      p.life = 0;
      spawnBurst(p.x, p.y, 24);
      addShake(14, 0.18);
      hurt(target, 16, p.owner.facing*520, -420, p.owner);
    }

    // fuori schermo
    if (p.x < -50 || p.x > W+50 || p.y > H+50) p.life = 0;
  }
  for (let i=proj.length-1;i>=0;i--){
    if (proj[i].life <= 0) proj.splice(i,1);
  }
}

function stepFX(dt){
  for (const p of fx){
    p.t += dt;
    p.life -= dt;
    if (p.type === "p"){
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 980 * dt;
      p.vx *= 0.98;
    } else if (p.type === "text"){
      p.y += p.vy * dt;
    }
  }
  for (let i=fx.length-1;i>=0;i--){
    if (fx[i].life <= 0) fx.splice(i,1);
  }
}

// ---- CAMERA / CINEMATIC ----
function applyCamera(dt){
  world.time += dt;

  if (world.shakeT > 0){
    world.shakeT -= dt;
  } else {
    world.shake = Math.max(0, world.shake - 40*dt);
  }

  const s = world.shake;
  const ox = (Math.random()*2-1) * s;
  const oy = (Math.random()*2-1) * s;

  // finto zoom con slow motion: non scalare davvero la canvas, ma “spostiamo” leggermente la camera verso l’azione
  const focusX = (P.x + E.x) * 0.5;
  const camX = lerp(W/2, focusX, 0.08);
  const camY = H/2;

  ctx.setTransform(1,0,0,1,0,0);
  ctx.translate((W/2 - camX) * 0.12 + ox, (H/2 - camY) * 0.06 + oy);
}

// ---- DRAW ----
function drawArena(){
  // bg gradient
  const g = ctx.createLinearGradient(0,0,0,H);
  g.addColorStop(0, "#07102a");
  g.addColorStop(1, "#050814");
  ctx.fillStyle = g;
  ctx.fillRect(0,0,W,H);

  // stars
  ctx.globalAlpha = 0.16;
  for (let i=0;i<80;i++){
    const x = (i*97) % W;
    const y = (i*151) % (H-120);
    ctx.fillStyle = "#fff";
    ctx.fillRect(x,y,2,2);
  }
  ctx.globalAlpha = 1;

  // floor
  ctx.fillStyle = "#0b1635";
  ctx.fillRect(0, world.floorY, W, H - world.floorY);

  // “neon line”
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = "#8fb0ff";
  ctx.fillRect(0, world.floorY-2, W, 2);
  ctx.globalAlpha = 1;
}

function drawStickman(f){
  const headR = 14;
  const x = f.x, y = f.y;

  // invincibility blink
  if (f.invT > 0 && Math.floor(world.time*24) % 2 === 0) ctx.globalAlpha = 0.35;

  // color per team
  ctx.strokeStyle = (f.team === "P") ? "rgba(255,255,255,0.9)" : "rgba(255,180,180,0.9)";
  ctx.lineWidth = 4;

  // head
  ctx.beginPath();
  ctx.arc(x, y-150, headR, 0, Math.PI*2);
  ctx.stroke();

  // body
  ctx.beginPath();
  ctx.moveTo(x, y-136);
  ctx.lineTo(x, y-92);
  ctx.stroke();

  // arms (pose-based)
  const dir = f.facing;
  const armY = y-120;
  ctx.beginPath();
  ctx.moveTo(x, armY);

  if (f.pose.startsWith("atk")){
    ctx.lineTo(x + dir*40, armY - 10);
    ctx.lineTo(x + dir*70, armY + 10);
  } else if (f.pose === "dash"){
    ctx.lineTo(x + dir*60, armY);
    ctx.lineTo(x + dir*90, armY);
  } else if (f.pose === "cast"){
    ctx.lineTo(x + dir*40, armY - 18);
    ctx.lineTo(x + dir*55, armY - 22);
  } else {
    ctx.lineTo(x + dir*26, armY + 6);
    ctx.lineTo(x + dir*42, armY + 20);
  }
  ctx.stroke();

  // back arm
  ctx.globalAlpha *= 0.7;
  ctx.beginPath();
  ctx.moveTo(x, armY);
  ctx.lineTo(x - dir*24, armY + 10);
  ctx.lineTo(x - dir*40, armY + 26);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // legs
  ctx.beginPath();
  ctx.moveTo(x, y-92);
  ctx.lineTo(x + 18, y-52);
  ctx.lineTo(x + 10, y);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x, y-92);
  ctx.lineTo(x - 18, y-52);
  ctx.lineTo(x - 10, y);
  ctx.stroke();

  ctx.globalAlpha = 1;
  ctx.lineWidth = 1;
}

function drawFX(){
  for (const p of fx){
    if (p.type === "p"){
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = "rgba(143,176,255,0.9)";
      ctx.fillRect(p.x, p.y, 3, 3);
      ctx.globalAlpha = 1;
    } else if (p.type === "slash"){
      ctx.globalAlpha = Math.max(0, p.life/0.18);
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      const len = 90;
      ctx.moveTo(p.x - p.dir*20, p.y - 10);
      ctx.lineTo(p.x + p.dir*len, p.y + 30);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.globalAlpha = 1;
    } else if (p.type === "ring"){
      ctx.globalAlpha = Math.max(0, p.life/0.35);
      ctx.strokeStyle = "rgba(143,176,255,0.8)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 18 + p.t*260, 0, Math.PI*2);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.globalAlpha = 1;
    } else if (p.type === "text"){
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.font = "16px system-ui";
      ctx.fillText(p.txt, p.x-12, p.y);
      ctx.globalAlpha = 1;
    }
  }
}

function drawProjectiles(){
  for (const p of proj){
    ctx.fillStyle = "rgba(255,220,140,0.95)";
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
    ctx.fill();

    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    ctx.arc(p.x - p.owner.facing*14, p.y + 3, p.r*1.6, 0, Math.PI*2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function drawUIBars(){
  uiHP.textContent = String(P.hp);
  uiEHP.textContent = String(E.hp);

  // overlay message in-canvas
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = "16px system-ui";
  ctx.fillText("J combo (1-2-3)  K dash  L shockwave  I fireball", 18, 28);

  // cooldown indicator simple
  const cd = P.cd;
  ctx.font = "14px system-ui";
  ctx.fillStyle = "rgba(152,167,194,0.9)";
  ctx.fillText(`CD K:${cd.dash.toFixed(1)}  L:${cd.shock.toFixed(1)}  I:${cd.fire.toFixed(1)}`, 18, 50);

  if (P.hp <= 0 || E.hp <= 0){
    ctx.font = "28px system-ui";
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    const msg = P.hp <= 0 ? "YOU LOSE (R)" : "YOU WIN (R)";
    ctx.fillText(msg, W/2 - 92, H/2);
  }
}

// ---- LOOP ----
let last = performance.now();
function tick(now){
  let dt = Math.min(0.033, (now - last)/1000);
  last = now;

  // slow motion
  if (world.slowT > 0){
    world.slowT = Math.max(0, world.slowT - dt);
    dt *= 0.55;
  }

  // update
  if (P.hp > 0 && E.hp > 0){
    controlPlayer(dt);
    controlEnemy(dt);
  }

  stepFighter(P, dt);
  stepFighter(E, dt);
  stepHitboxes(dt);
  stepProjectiles(dt);
  stepFX(dt);

  // draw
  applyCamera(dt);
  drawArena();
  drawProjectiles();
  drawFX();
  drawStickman(P);
  drawStickman(E);
  drawUIBars();

  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
