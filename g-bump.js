/* Bump Back: a card-driven race. Get your pawns from Start round the board and Home, bumping rivals on the way.
   Rules first (no screen code), then the computer players, then the board. */
(() => {
'use strict';
const { esc, sleep, sfx } = Core;

/* The track is 60 squares, numbered clockwise from the top-left corner; each of the 4 sides has 15.
   A side's squares: k = 0..14.  Slides start at k=1 (to k=4) and k=9 (to k=13).
   A pawn's own Safety Zone turns off at k=2 and its Start leads out onto k=4.
   Pawn position: {z:'start'} | {z:'track', t} (t = steps past its own exit, 0..59) | {z:'safe', t: 0..4} | {z:'home'} */
const ENTRY_REL = 58;   // the safety turn-off, counted from a pawn's own exit
const SLIDE_ENDS = { 1: 4, 9: 13 };
const SIDES = { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] };
const CARDS = ['1', '2', '3', '4', '5', '7', '8', '10', '11', '12', 'B'];
const CARD_TEXT = {
  1: 'Bring a pawn out of Start, or move 1.', 2: 'Bring a pawn out of Start, or move 2. Then draw again!',
  3: 'Move 3.', 4: 'Move 4 BACKWARDS.', 5: 'Move 5.', 7: 'Move 7, or split it between two pawns.', 8: 'Move 8.',
  10: 'Move 10, or go back 1.', 11: 'Move 11, or swap places with a rival.', 12: 'Move 12.',
  B: 'BUMP! Jump from Start onto a rival and send them back to their Start.',
};

const START = { z: 'start' }, HOME = { z: 'home' };
const exitOf = side => side * 15 + 4;
const absOf = (side, pos) => (exitOf(side) + pos.t) % 60;
const relOf = (side, abs) => (abs - exitOf(side) + 60) % 60;
const same = (a, b) => a.z === b.z && a.t === b.t;

function step(pos, dir) {
  if (pos.z === 'track') {
    if (dir > 0) return pos.t === ENTRY_REL ? { z: 'safe', t: 0 } : { z: 'track', t: (pos.t + 1) % 60 };
    return { z: 'track', t: (pos.t + 59) % 60 };
  }
  if (pos.z === 'safe') {
    if (dir > 0) return pos.t < 4 ? { z: 'safe', t: pos.t + 1 } : HOME;
    return pos.t > 0 ? { z: 'safe', t: pos.t - 1 } : { z: 'track', t: ENTRY_REL };
  }
  return null;   // pawns in Start or Home cannot walk
}

// ---------------------------------------------------------------- moving pawns
const copyPawns = s => s.players.map(p => p.pawns.map(x => ({ ...x })));
const allHome = list => list.every(x => x.z === 'home');
const partnerOf = (s, seat) => (s.teams ? (seat + 2) % 4 : -1);
// Whose pawns this seat moves: its own, or (in team play, once all of its own are home) its partner's.
const moverOwner = (s, pawns, seat) => (s.teams && allHome(pawns[seat]) ? partnerOf(s, seat) : seat);

// Put pawn (o, i) on `dest`, bumping and sliding as needed. Changes `pawns`. Returns null if not allowed.
function land(s, pawns, o, i, dest) {
  const bumped = [], side = s.players[o].side;
  const bump = (po, pi) => { bumped.push({ o: po, i: pi }); pawns[po][pi] = { ...START }; };
  const eachOnTrack = fn => pawns.forEach((list, po) => list.forEach((x, pi) => {
    if (!(po === o && pi === i) && x.z === 'track') fn(po, pi, absOf(s.players[po].side, x));
  }));
  if (dest.z === 'safe' && pawns[o].some((x, k) => k !== i && same(x, dest))) return null;
  if (dest.z !== 'track') { pawns[o][i] = { ...dest }; return { bumped, rest: dest, final: dest }; }
  const at = absOf(side, dest);
  if (pawns[o].some((x, k) => k !== i && x.z === 'track' && absOf(side, x) === at)) return null;   // can't land on your own colour
  eachOnTrack((po, pi, a) => { if (a === at) bump(po, pi); });
  let final = dest;
  const slideSide = Math.floor(at / 15), end = SLIDE_ENDS[at % 15];
  if (end !== undefined && slideSide !== side) {   // slides of other colours carry you along, knocking everyone off
    const endAbs = slideSide * 15 + end;
    eachOnTrack((po, pi, a) => { if (a > at && a <= endAbs) bump(po, pi); });
    final = { z: 'track', t: relOf(side, endAbs) };
  }
  pawns[o][i] = { ...final };
  return { bumped, rest: dest, final };
}

// Walk n squares (negative = backwards). Returns a description of the move, or null.
function walk(s, pawns, o, i, n) {
  let pos = pawns[o][i];
  const path = [], dir = n < 0 ? -1 : 1;
  for (let k = 0; k < Math.abs(n); k++) {
    pos = step(pos, dir);
    if (!pos) return null;   // not on the move, or it would overshoot Home
    path.push(pos);
  }
  const from = { ...pawns[o][i] }, r = land(s, pawns, o, i, pos);
  return r && { o, i, n, from, path, rest: r.rest, final: r.final, bumped: r.bumped };
}

// Every move allowed for the current card.
function legal(s) {
  if (s.phase !== 'move' || s.over) return [];
  const seat = s.turn, now = copyPawns(s), o = moverOwner(s, now, seat), card = s.card, out = [], seen = new Set();
  const add = (key, type, parts, pawns, extra) => {
    const sig = type + JSON.stringify(pawns);
    if (seen.has(sig)) return;
    seen.add(sig);
    out.push(Object.assign({ key, type, parts, pawns }, extra));
  };
  const mine = now[o].map((_, i) => i);
  const tryWalk = (i, n) => { const p = copyPawns(s), r = walk(s, p, o, i, n); if (r) add(`m:${i}:${n}`, 'move', [r], p); };
  const others = [];
  now.forEach((list, po) => { if (po !== o) list.forEach((x, pi) => { if (x.z === 'track') others.push({ o: po, i: pi }); }); });
  const waiting = mine.find(i => now[o][i].z === 'start');

  if (card === 'B') {
    if (waiting !== undefined) others.forEach(t => {
      const p = copyPawns(s), spot = { z: 'track', t: relOf(s.players[o].side, absOf(s.players[t.o].side, p[t.o][t.i])) };
      p[t.o][t.i] = { ...START };
      const r = land(s, p, o, waiting, spot);
      if (r) add(`b:${t.o}.${t.i}`, 'bump', [{ o, i: waiting, from: { ...START }, path: [spot], rest: spot, final: r.final, bumped: [t, ...r.bumped] }], p, { target: t });
    });
    return out;
  }
  const n = +card;
  if ((n === 1 || n === 2) && waiting !== undefined) {
    const p = copyPawns(s), spot = { z: 'track', t: 0 }, r = land(s, p, o, waiting, spot);
    if (r) add(`go:${waiting}`, 'start', [{ o, i: waiting, from: { ...START }, path: [spot], rest: spot, final: r.final, bumped: r.bumped }], p);
  }
  mine.forEach(i => tryWalk(i, n === 4 ? -4 : n));
  if (n === 10) mine.forEach(i => tryWalk(i, -1));
  if (n === 7) {
    mine.forEach(a => mine.forEach(b => {
      if (a === b) return;
      for (let k = 1; k < 7; k++) {
        const p = copyPawns(s), first = walk(s, p, o, a, k);
        if (!first) continue;
        const second = walk(s, p, o, b, 7 - k);
        if (second) add(`s:${a}:${k}:${b}`, 'split', [first, second], p);
      }
    }));
  }
  if (n === 11) {
    mine.filter(i => now[o][i].z === 'track').forEach(i => others.forEach(t => {
      const p = copyPawns(s), side = s.players[o].side;
      const theirAbs = absOf(s.players[t.o].side, p[t.o][t.i]), myAbs = absOf(side, p[o][i]);
      p[t.o][t.i] = { z: 'track', t: relOf(s.players[t.o].side, myAbs) };
      const spot = { z: 'track', t: relOf(side, theirAbs) }, from = { ...p[o][i] };
      const r = land(s, p, o, i, spot);
      if (r) add(`w:${i}:${t.o}.${t.i}`, 'swap', [{ o, i, from, path: [spot], rest: spot, final: r.final, bumped: r.bumped }], p, { target: t, targetTo: { ...p[t.o][t.i] } });
    }));
    // swapping is optional: if swaps are the only choice, you may skip
    if (out.length && out.every(m => m.type === 'swap')) add('pass', 'pass', [], copyPawns(s));
  }
  return out;
}

// ---------------------------------------------------------------- turn flow
function newDeck(rng) {
  const deck = [];
  CARDS.forEach(c => { for (let i = 0; i < (c === '1' ? 5 : 4); i++) deck.push(c); });
  for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  return deck;
}

function create(players, opts, rng = Math.random) {
  const count = +opts.pawns === 2 ? 2 : 4, sides = SIDES[players.length], teams = !!opts.teams && players.length === 4;
  const s = {
    players: players.map((p, k) => ({
      name: p.name, icon: p.icon, color: p.color, side: sides[k],
      pawns: Array.from({ length: count }, (_, i) => (opts.headStart && i === 0 ? { z: 'track', t: 0 } : { ...START })),
    })),
    teams, deck: newDeck(rng), card: null, phase: 'draw', turn: 0, seq: 0, last: null, over: false, winners: [],
    log: ['Draw a card. You need a 1, a 2 or a Bump! card to leave Start.'],
  };
  if (teams) s.log.push(`Teams: ${players[0].name} & ${players[2].name} against ${players[1].name} & ${players[3].name}.`);
  else if (opts.teams) s.log.push('Team play needs exactly 4 players, so this game is everyone for themselves.');
  return s;
}

const label = c => (c === 'B' ? 'Bump!' : c);
function finishCard(s) {
  const again = s.card === '2';
  s.phase = 'draw';
  if (again) s.log.push(`${s.players[s.turn].name} draws again.`);
  else s.turn = (s.turn + 1) % s.players.length;
}

function describe(s, m) {
  const who = s.players[s.turn].name, rivals = [...new Set(m.parts.flatMap(p => p.bumped.map(b => s.players[b.o].name)))];
  const bumpText = rivals.length ? ` Bumped ${rivals.join(' and ')}!` : '';
  const slid = m.parts.some(p => !same(p.rest, p.final)) ? ' Wheee, a slide!' : '';
  const home = m.parts.some(p => p.final.z === 'home') ? ' A pawn made it Home! 🏠' : '';
  if (m.type === 'pass') return `${who} chose not to swap.`;
  if (m.type === 'start') return `${who} brought a pawn out.${slid}${bumpText}`;
  if (m.type === 'bump') return `${who} used Bump!${bumpText}${slid}`;
  if (m.type === 'swap') return `${who} swapped places with ${s.players[m.target.o].name}.${slid}${bumpText}`;
  if (m.type === 'split') return `${who} split the 7 (${m.parts[0].n} and ${m.parts[1].n}).${slid}${bumpText}${home}`;
  const n = m.parts[0].n;
  return `${who} moved ${n < 0 ? 'back ' + -n : n}.${slid}${bumpText}${home}`;
}

function exec(s, seat, move, rng = Math.random) {
  if (s.over) return 'The game is over.';
  if (seat !== s.turn) return "It isn't your turn.";
  if (!move) return 'Unknown move.';
  if (move.k === 'draw') {
    if (s.phase !== 'draw') return 'Play your card first.';
    if (!s.deck.length) s.deck = newDeck(rng);
    s.card = s.deck.pop();
    s.phase = 'move';
    s.last = { type: 'draw', seat, card: s.card, stuck: false };
    s.log.push(`${s.players[seat].name} drew ${label(s.card)}.`);
    if (!legal(s).length) {
      s.last.stuck = true;
      s.log.push(`No move for ${s.players[seat].name}.`);
      finishCard(s);
    }
  } else if (move.k === 'play') {
    if (s.phase !== 'move') return 'Draw a card first.';
    const m = legal(s).find(x => x.key === move.key);
    if (!m) return "That move isn't allowed.";
    s.log.push(describe(s, m));
    m.pawns.forEach((list, i) => { s.players[i].pawns = list; });
    s.last = { type: 'play', seat, card: s.card, move: { type: m.type, parts: m.parts, target: m.target, targetTo: m.targetTo } };
    const done = i => allHome(s.players[i].pawns);
    const winner = s.players.map((_, i) => i).find(i => done(i) && (!s.teams || done(partnerOf(s, i))));
    if (winner !== undefined) {
      s.over = true;
      s.winners = s.teams ? [winner, partnerOf(s, winner)] : [winner];
      s.log.push(`🏆 ${s.winners.map(i => s.players[i].name).join(' & ')} got everyone Home!`);
      s.phase = 'draw';
    } else finishCard(s);
  } else return 'Unknown move.';
  if (s.log.length > 60) s.log.splice(0, s.log.length - 60);
  s.seq++;
  return null;
}

// ---------------------------------------------------------------- computer players
// Squares still to travel before Home. A pawn just behind its own exit is, usefully, almost there after one lap.
function toGo(pos) {
  if (pos.z === 'home') return 0;
  if (pos.z === 'safe') return 5 - pos.t;
  if (pos.z === 'start') return 72;
  return pos.t <= ENTRY_REL ? ENTRY_REL - pos.t + 6 : 65;
}
function danger(s, pawns, o, x) {
  const at = absOf(s.players[o].side, x);
  let risk = 0;
  pawns.forEach((list, po) => {
    if (po === o || (s.teams && po === partnerOf(s, o))) return;
    list.forEach(y => {
      if (y.z === 'track') {
        const behind = (at - absOf(s.players[po].side, y) + 60) % 60;
        if ([1, 2, 3, 5, 7, 8, 10, 11, 12].includes(behind)) risk += 1;   // a card exists for that distance
        if (behind === 56) risk += .5;   // could be hit by a backwards 4
      }
    });
    if (list.some(y => y.z === 'start')) { const d = (at - exitOf(s.players[po].side) + 60) % 60; if (d <= 2) risk += 1.5; }
  });
  return risk;
}
// How good a board is for `seat`. Hard cares more about stopping rivals, getting to safety and not being a target:
// the further along a pawn is, the more it matters if it could be hit.
function value(s, pawns, seat, level) {
  const hard = level === 'hard';
  const rivalWeight = hard ? .35 + .5 / (s.players.length - 1) : .35;
  let total = 0;
  pawns.forEach((list, o) => {
    const friend = o === seat || (s.teams && o === partnerOf(s, seat));
    list.forEach(x => {
      let v = 75 - toGo(x) + (x.z === 'safe' ? (hard ? 14 : 8) : x.z === 'home' ? (hard ? 22 : 14) : 0);
      if (hard && x.z === 'track') v -= Math.min(1, danger(s, pawns, o, x) * .18) * v * .3;
      total += friend ? v : -v * rivalWeight;
    });
  });
  return total;
}
function bot(s, seat, level, rng = Math.random) {
  if (s.phase === 'draw') return { k: 'draw' };
  const moves = legal(s);
  if (level === 'easy') {
    const real = moves.filter(m => m.type !== 'pass');
    return { k: 'play', key: real[Math.floor(rng() * real.length)].key };
  }
  let best = null, top = -Infinity;
  moves.forEach(m => { const v = value(s, m.pawns, seat, level) + rng() * .01; if (v > top) { top = v; best = m; } });
  return { k: 'play', key: best.key };
}

// ---------------------------------------------------------------- board geometry (1000 x 1000, a 16 x 16 grid)
const U = 62.5;
// turn a point on the top side round to side 0..3
function spin(side, x, y) {
  for (let i = 0; i < side; i++) [x, y] = [1000 - y, x];
  return { x, y };
}
const mid = c => (c + .5) * U;
const trackPoint = abs => spin(Math.floor(abs / 15), mid(abs % 15), mid(0));
const safePoint = (side, t) => spin(side, mid(2), mid(1 + t));
const startCentre = side => spin(side, mid(4), 2.2 * U);
const homeCentre = side => spin(side, mid(2), 7 * U);
const NEST = [[-24, -24], [24, -24], [-24, 24], [24, 24]];
function pointFor(side, pos, i) {
  if (pos.z === 'track') return trackPoint(absOf(side, pos));
  if (pos.z === 'safe') return safePoint(side, pos.t);
  const c = pos.z === 'start' ? startCentre(side) : homeCentre(side);
  return { x: c.x + NEST[i][0], y: c.y + NEST[i][1] };
}

function boardSVG(players) {
  const colour = side => { const p = players.find(x => x.side === side); return p ? p.color : '#9aa6c8'; };
  const box = (p, fill) => `<rect x="${p.x - U / 2 + 2}" y="${p.y - U / 2 + 2}" width="${U - 4}" height="${U - 4}" rx="9" fill="${fill}" stroke="#8d9bc4" stroke-width="2"/>`;
  let art = '';
  for (let abs = 0; abs < 60; abs++) art += box(trackPoint(abs), '#fff');
  for (let side = 0; side < 4; side++) {
    const c = colour(side);
    Object.entries(SLIDE_ENDS).forEach(([a, b]) => {
      const p = trackPoint(side * 15 + +a), q = trackPoint(side * 15 + b);
      art += `<line x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}" stroke="${c}" stroke-width="20" stroke-linecap="round" opacity=".8"/>
        <circle cx="${q.x}" cy="${q.y}" r="20" fill="${c}"/>
        <path d="M-20 -22 L20 0 L-20 22 Z" fill="${c}" stroke="#fff" stroke-width="3" transform="translate(${p.x} ${p.y}) rotate(${side * 90})"/>`;
    });
    for (let t = 0; t < 5; t++) art += box(safePoint(side, t), c + '66');
    const s = startCentre(side), h = homeCentre(side);
    art += `<circle cx="${s.x}" cy="${s.y}" r="62" fill="${c}44" stroke="${c}" stroke-width="7"/>
      <circle cx="${h.x}" cy="${h.y}" r="62" fill="${c}88" stroke="${c}" stroke-width="7"/>
      <text x="${s.x}" y="${s.y + 7}" font-size="21" font-weight="900" text-anchor="middle" fill="#1d2a55">START</text>
      <text x="${h.x}" y="${h.y + 7}" font-size="21" font-weight="900" text-anchor="middle" fill="#1d2a55">HOME</text>`;
  }
  return `<svg viewBox="0 0 1000 1000" role="img" aria-label="Bump Back board"><rect width="1000" height="1000" fill="#e8ecfb"/>${art}
    <text x="500" y="535" font-size="74" font-weight="900" text-anchor="middle" fill="#2b3a75" opacity=".55" transform="rotate(-28 500 500)">BUMP BACK</text></svg>`;
}

// ---------------------------------------------------------------- screen
function mount(root, api) {
  root.innerHTML = `
    <div class="gstage">
      <div class="gboard bb-board"><div class="bb-art"></div><div class="marks"></div><div class="pawns"></div><div class="callout" hidden></div></div>
      <div class="gcontrols">
        <div class="bb-card back">?</div>
        <div class="gtext"><div class="gstatus" aria-live="polite"></div><div class="bb-help"></div><button class="bigbtn"></button></div>
      </div>
      <div class="bb-choices"></div>
    </div>`;
  const q = x => root.querySelector(x);
  const art = q('.bb-art'), layer = q('.pawns'), marks = q('.marks'), button = q('.bigbtn'), status = q('.gstatus'), help = q('.bb-help'),
    call = q('.callout'), cardEl = q('.bb-card'), choices = q('.bb-choices');
  let state = null, shown = [], pawns = [], busy = false, dead = false, sent = false, moves = [], pick = null, built = '';

  const key = (o, i) => `${o}.${i}`;
  function build() {
    const sig = state.players.map(p => p.color + p.pawns.length).join();
    if (sig === built) return;
    built = sig;
    art.innerHTML = boardSVG(state.players);
    layer.innerHTML = state.players.map((p, o) => p.pawns.map((_, i) =>
      `<button class="pawn" data-p="${key(o, i)}" style="--c:${p.color}" aria-label="${esc(p.name)} pawn ${i + 1}">${p.icon}<b>${i + 1}</b></button>`).join('')).join('');
    pawns = state.players.map((p, o) => p.pawns.map((_, i) => layer.querySelector(`[data-p="${key(o, i)}"]`)));
  }
  function place(el, pt) { el.style.left = pt.x / 10 + '%'; el.style.top = pt.y / 10 + '%'; }
  const arrange = () => shown.forEach((list, o) => list.forEach((pos, i) => place(pawns[o][i], pointFor(state.players[o].side, pos, i))));
  function showCard(card) {
    cardEl.className = 'bb-card' + (card ? ' flip' : ' back');
    cardEl.textContent = card ? (card === 'B' ? 'B!' : card) : '?';
  }
  const send = move => { if (busy || sent || !api.canAct()) return; sent = true; button.disabled = true; clearPicks(); if (!api.move(move)) { sent = false; refresh(); } };
  const play = m => send({ k: 'play', key: m.key });
  function clearPicks() {
    marks.innerHTML = ''; choices.innerHTML = '';
    pawns.flat().forEach(el => el.classList.remove('can', 'sel', 'aim'));
  }

  // The pawn you tap to begin a move (for a Bump! card it is the rival you want to hit).
  const sourceOf = m => (m.type === 'bump' ? key(m.target.o, m.target.i) : m.type === 'pass' ? null : key(m.parts[0].o, m.parts[0].i));
  function pawnName(k) {
    const [o, i] = k.split('.').map(Number);
    return `${state.players[o].name} #${i + 1}`;
  }
  function optionText(m) {
    if (m.type === 'start') return '🚪 Come out of Start';
    if (m.type === 'swap') return `🔀 Swap with ${pawnName(key(m.target.o, m.target.i))}`;
    if (m.type === 'bump') return `💥 Bump ${pawnName(key(m.target.o, m.target.i))}`;
    const n = m.parts[0].n, p = m.parts[0];
    const extra = p.final.z === 'home' ? ' 🏠' : !same(p.rest, p.final) ? ' 🛝' : p.bumped.length ? ' 💥' : '';
    return `${n < 0 ? '⬅ Back ' + -n : '➡ Move ' + n}${extra}`;
  }

  // Draw what can be tapped: pick = null, or {src} (a pawn), or {src, k} (first part of a split 7)
  function showPicks() {
    clearPicks();
    if (!moves.length) return;
    const chip = (text, fn, cls) => { const b = document.createElement('button'); b.className = 'sm ' + (cls || 'sec'); b.textContent = text; b.addEventListener('click', fn); choices.appendChild(b); };
    const mark = (pt, text, fn) => { const b = document.createElement('button'); b.className = 'bb-mark'; b.textContent = text; b.setAttribute('aria-label', 'Move here: ' + text); b.addEventListener('click', fn); place(b, pt); marks.appendChild(b); };
    const el = k => pawns[k.split('.')[0]][k.split('.')[1]];
    const sources = [...new Set(moves.map(sourceOf).filter(Boolean))];
    if (pick && pick.k !== undefined) {   // choosing the second pawn of a split
      const seconds = moves.filter(m => m.type === 'split' && sourceOf(m) === pick.src && m.parts[0].n === pick.k);
      help.textContent = `Now tap the pawn that moves the other ${7 - pick.k}.`;
      el(pick.src).classList.add('sel');
      seconds.forEach(m => {
        const k = key(m.parts[1].o, m.parts[1].i);
        el(k).classList.add('can'); el(k)._tap = () => play(m);
        chip(`Pawn #${m.parts[1].i + 1} moves ${m.parts[1].n}`, () => play(m), 'ok');
      });
      chip('↩ Start over', () => { pick = null; showPicks(); });
      return;
    }
    sources.forEach(k => { el(k).classList.add('can'); el(k)._tap = () => choose(k); });
    if (moves.some(m => m.type === 'bump')) {
      help.textContent = 'Tap the rival pawn you want to bump.';
      moves.forEach(m => { el(sourceOf(m))._tap = () => play(m); chip(optionText(m), () => play(m)); });
      return;
    }
    if (!pick) {
      help.textContent = 'Tap a glowing pawn.';
      sources.forEach(k => chip(`Pawn #${+k.split('.')[1] + 1}`, () => choose(k)));
    } else {
      const list = moves.filter(m => sourceOf(m) === pick.src);
      help.textContent = 'Tap where to go, or use the buttons.';
      el(pick.src).classList.add('sel');
      list.filter(m => m.type === 'move' || m.type === 'start').forEach(m => {
        const p = m.parts[0], side = state.players[p.o].side;
        mark(pointFor(side, p.rest, p.i), m.type === 'start' ? '✓' : String(p.n), () => play(m));
        chip(optionText(m), () => play(m), 'ok');
      });
      const firsts = [...new Set(list.filter(m => m.type === 'split').map(m => m.parts[0].n))].sort((a, b) => a - b);
      firsts.forEach(n => {
        const m = list.find(x => x.type === 'split' && x.parts[0].n === n), p = m.parts[0];
        const go = () => { pick = { src: pick.src, k: n }; const rest = list.filter(x => x.type === 'split' && x.parts[0].n === n); if (rest.length === 1) play(rest[0]); else showPicks(); };
        mark(pointFor(state.players[p.o].side, p.rest, p.i), String(n), go);
        chip(`✂ Move ${n}, then ${7 - n}`, go);
      });
      list.filter(m => m.type === 'swap').forEach(m => {
        const k = key(m.target.o, m.target.i);
        el(k).classList.add('aim'); el(k)._tap = () => play(m);
        chip(optionText(m), () => play(m));
      });
      if (sources.length > 1) chip('↩ Other pawn', () => { pick = null; showPicks(); });
    }
    if (moves.some(m => m.type === 'pass')) chip('Skip the swap', () => play(moves.find(m => m.type === 'pass')));
  }
  function choose(src) { pick = { src }; showPicks(); }
  layer.addEventListener('click', e => { const b = e.target.closest('.pawn'); if (b && (b.classList.contains('can') || b.classList.contains('aim')) && b._tap) b._tap(); });

  function refresh() {
    if (busy || !state) return;
    sent = false;
    const p = state.players[state.turn], me = api.canAct();
    const drawing = state.phase === 'draw';
    showCard(drawing ? (state.last ? state.last.card : null) : state.card);
    status.textContent = state.over ? `🏆 ${state.winners.map(i => state.players[i].name).join(' & ')} win${state.winners.length > 1 ? '' : 's'}!`
      : me ? (drawing ? `${p.icon} ${p.name}, draw a card!` : `${p.icon} ${p.name}: ${CARD_TEXT[state.card]}`)
        : drawing ? `Waiting for ${p.icon} ${p.name}…` : `${p.icon} ${p.name} is choosing. ${CARD_TEXT[state.card]}`;
    moves = me && !drawing ? legal(state) : [];
    button.hidden = !(drawing || moves.length === 1);
    button.disabled = !me;
    button.textContent = drawing ? 'Draw a card' : moves.length === 1 ? `Play: ${moves[0].type === 'split' ? 'split the 7' : moves[0].type === 'pass' ? 'skip' : optionText(moves[0])}` : '';
    help.textContent = '';
    // keep a choice in progress if the screen redraws; start fresh if it no longer applies
    if (pick && !moves.some(m => sourceOf(m) === pick.src)) pick = null;
    if (!pick) { const src = [...new Set(moves.map(sourceOf).filter(Boolean))]; if (src.length === 1 && !moves.some(m => m.type === 'bump')) pick = { src: src[0] }; }
    showPicks();
    pawns.forEach((list, o) => list.forEach(el => el.classList.toggle('turn', !state.over && o === state.turn)));
  }
  function primary() {
    if (!state || !api.canAct()) return;
    if (state.phase === 'draw') send({ k: 'draw' });
    else if (moves.length === 1) play(moves[0]);
  }
  button.addEventListener('click', primary);
  const onKey = e => {
    if (e.target.matches('input, select, textarea, button') || document.querySelector('#modal:not(:empty)')) return;
    if (e.code === 'Space' || e.key.toLowerCase() === 'r') { e.preventDefault(); primary(); }
  };
  document.addEventListener('keydown', onKey);
  const shout = (text, cls) => { call.textContent = text; call.className = 'callout ' + cls; call.hidden = false; };

  async function update(next) {
    const last = next.last;
    state = next; pick = null;
    if (!last) { reset(next); return; }
    busy = true; moves = []; clearPicks(); help.textContent = ''; button.disabled = true; call.hidden = true;
    const who = state.players[last.seat];
    if (last.type === 'draw') {
      showCard(null); void cardEl.offsetWidth; showCard(last.card); sfx.card();
      status.textContent = `${who.icon} ${who.name} drew ${label(last.card)}`;
      await sleep(900);
      if (last.stuck) { shout(`No move with ${label(last.card)}`, 'bad'); sfx.nope(); await sleep(1100); }
    } else {
      const m = last.move;
      for (const part of m.parts) {
        const el = pawns[part.o][part.i], side = state.players[part.o].side;
        el.classList.add('moving');
        if (m.type === 'move' || m.type === 'split') {
          for (const pos of part.path) {
            if (dead) return;
            shown[part.o][part.i] = pos; place(el, pointFor(side, pos, part.i)); sfx.hop(); await sleep(170);
          }
        } else {
          if (m.type === 'bump') { shout('💥 BUMP!', 'bad'); sfx.boom(); }
          el.classList.add('flying'); shown[part.o][part.i] = part.rest; place(el, pointFor(side, part.rest, part.i)); await sleep(750); el.classList.remove('flying');
        }
        if (m.type === 'swap') {
          const t = m.target;
          pawns[t.o][t.i].classList.add('flying'); shown[t.o][t.i] = m.targetTo; place(pawns[t.o][t.i], pointFor(state.players[t.o].side, m.targetTo, t.i)); sfx.slide();
          await sleep(750); pawns[t.o][t.i].classList.remove('flying');
        }
        if (!same(part.rest, part.final)) {
          shout('🛝 Slide!', 'good'); sfx.slide(); el.classList.add('flying');
          shown[part.o][part.i] = part.final; place(el, pointFor(side, part.final, part.i)); await sleep(750); el.classList.remove('flying');
        }
        if (part.bumped.length) {
          if (m.type !== 'bump') { shout('💥 Bumped!', 'bad'); sfx.boom(); }
          part.bumped.forEach(b => { pawns[b.o][b.i].classList.add('flying'); shown[b.o][b.i] = { ...START }; place(pawns[b.o][b.i], pointFor(state.players[b.o].side, START, b.i)); });
          await sleep(750);
          part.bumped.forEach(b => pawns[b.o][b.i].classList.remove('flying'));
        }
        if (part.final.z === 'home') { shout('🏠 Home safe!', 'good'); sfx.climb(); await sleep(700); }
        el.classList.remove('moving');
      }
      await sleep(250);
    }
    if (dead) return;
    shown = copyPawns(state); arrange();
    call.hidden = true; busy = false;
    refresh();
  }

  function reset(next) {
    state = next; busy = false; pick = null;
    build();
    shown = copyPawns(state); arrange(); call.hidden = true;
    refresh();
  }

  return {
    reset, update, refresh,
    status: (s, i) => `🏠 ${s.players[i].pawns.filter(x => x.z === 'home').length}/${s.players[i].pawns.length}${s.teams ? ` · Team ${i % 2 ? 'B' : 'A'}` : ''}`,
    destroy() { dead = true; document.removeEventListener('keydown', onKey); root.innerHTML = ''; },
  };
}

Core.register({
  id: 'bump', name: 'Bump Back', emoji: '🎯', color: '#ff4d6d',
  blurb: 'Race your pawns Home with cards, and bump rivals back to Start.',
  min: 2, max: 4, levels: true,
  rules: [
    'Draw a card, then move a pawn. You need a 1, 2 or Bump! to leave Start.',
    'Land on a rival to send them back to Start. Another colour’s slide carries you along and bumps everyone on it.',
    '4 moves backwards, 7 can be split, 10 can go back 1, 11 can swap. You need the exact number to get Home.',
  ],
  options: [
    { key: 'pawns', type: 'select', label: 'Pawns each', default: 4, choices: [[4, '4 pawns (standard)'], [2, '2 pawns (quicker game)']] },
    { key: 'headStart', type: 'check', label: 'Head start', help: 'Everyone begins with one pawn already out of Start.', default: false },
    { key: 'teams', type: 'check', label: '2-on-2 teams (needs 4 players)', help: 'Players 1 and 3 against 2 and 4. When your pawns are all Home, you move your partner’s.', default: false },
  ],
  create, exec,
  turn: s => s.turn,
  bot,
  view: s => Object.assign({}, s, { deck: [] }),
  mount,
  legal, step, absOf,
});
})();
