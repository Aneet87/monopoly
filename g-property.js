/* Property Tycoon inside the shared rooms. The rules live in property-game.js; this file connects them to the room
   and draws the board, dice, banners, property panels, auctions and trades. */
(() => {
'use strict';
const { esc, sleep, sfx, toast } = Core;
const G = Game, SP = G.SPACES, GC = G.GROUP_COLORS;
const HOP_MS = 175;
const money = n => '$' + Math.round(n).toLocaleString();
const LEVEL_TAG = { easy: 'EASY', medium: 'MED', hard: 'HARD' };

// ------------------------------------------------------------ rule options shown in the lobby
const OPTS = [
  ['incomeTaxChoice', 'Income Tax: $200 or 10%', 'Classic rule: choose a flat $200 or 10% of your total worth. Turn off for a flat $200.'],
  ['auction', 'Auction unbought properties', 'If a player declines to buy, everyone bids on it.'],
  ['freeParking', 'Free Parking jackpot', 'Taxes and fines pile up in the middle; land on Free Parking to win the pot.'],
  ['doubleGo', 'Double salary on GO', 'Land exactly on GO to collect double the normal salary.'],
  ['setBonus', 'Double rent on full colour sets', 'Standard rule: owning a whole set doubles rent on its unbuilt lots.'],
  ['fpRefill', 'Refill Free Parking after it is won', 'The bank puts the starting jackpot back each time someone wins it.'],
  ['rentInJail', 'Collect rent while in jail', 'Standard rule. Turn off and jailed owners collect nothing.'],
  ['evenBuild', 'Even building rule', 'Houses must be built and sold evenly within a colour set.'],
  ['limitedHouses', 'Limited buildings (32 houses, 12 hotels)', 'Standard bank supply, which can cause house shortages.'],
  ['randomOrder', 'Random turn order', 'Shuffle who goes first.'],
];
// Dropdown settings: [key, label, choices, formatter]
const NUMS = [
  ['fpStart', 'Free Parking starting jackpot', [0, 100, 200, 500, 1000, 2000, 5000], v => (v ? money(v) : '$0 (standard)')],
  ['goSalary', 'GO salary', [100, 200, 300, 500], v => money(v) + (v === 200 ? ' (standard)' : '')],
  ['jailFine', 'Jail fine', [50, 100, 200, 500], v => money(v) + (v === 50 ? ' (standard)' : '')],
  ['rentPct', 'Rent multiplier', [50, 100, 150, 200, 300], v => v + '%' + (v === 100 ? ' (standard)' : '')],
];
const BASE = { startCash: 1500, dealProps: 0, auction: true, freeParking: false, doubleGo: false, rentInJail: true, evenBuild: true, limitedHouses: true, randomOrder: false, incomeTaxChoice: true, setBonus: true, fpRefill: false, fpStart: 0, goSalary: 200, jailFine: 50, rentPct: 100 };
const PRESETS = {
  Classic: { ...BASE },
  'Quick game': { ...BASE, dealProps: 3 },
  'Party house rules': { ...BASE, startCash: 2000, freeParking: true, fpStart: 500, fpRefill: true, doubleGo: true, limitedHouses: false, randomOrder: true },
  'High stakes': { ...BASE, startCash: 3000, freeParking: true, fpStart: 1000, goSalary: 300, jailFine: 200, rentPct: 150 },
};


const themeKey = key => (THEMES[key] ? key : 'classic');
// Space and card names depend on the theme, so set it before running or drawing a game.
const useTheme = s => G.applyTheme(themeKey(s.options.theme));
const optionList = [
  { key: 'theme', type: 'select', label: 'Board theme', default: 'classic', top: true,
    choices: Object.keys(THEMES).map(k => [k, `${THEMES[k].emoji} ${THEMES[k].name}`]) },
  { key: 'startCash', type: 'select', label: 'Starting cash', default: 1500, choices: [500, 1000, 1500, 2000, 3000, 5000].map(v => [v, money(v)]) },
  { key: 'dealProps', type: 'select', label: 'Deal random properties at the start', default: 0, choices: [0, 2, 3, 5].map(v => [v, v ? `${v} each` : 'None (standard)']) },
  ...NUMS.map(([key, label, values, format]) => ({ key, type: 'select', label, default: BASE[key], choices: values.map(v => [v, format(v)]) })),
  ...OPTS.map(([key, label, help]) => ({ key, type: 'check', label, help, default: !!BASE[key] })),
];

// ------------------------------------------------------------ how the room runs the game
function create(players, opts) {
  const options = Object.assign({}, G.DEFAULTS, opts, { randomOrder: false });   // the room shuffles seats itself
  G.applyTheme(themeKey(options.theme));
  const s = G.create(players.map(p => ({ name: p.name, icon: p.icon, color: p.color })), options);
  return Object.assign(s, { seq: 0, over: false, winners: [] });
}
function changed(s) {
  s.seq++;
  if (s.status === 'over') { s.over = true; s.winners = [s.winner]; }
}
function exec(s, seat, move) {
  if (!move || typeof move.type !== 'string') return 'Unknown move.';
  useTheme(s);
  const err = G.exec(s, seat, move);
  if (!err) changed(s);
  return err || null;
}
// Computer players: let whichever computer needs to act (bid, answer a trade, take its turn) do one thing.
function step(s) {
  // an offer waiting on a person holds the computers until it is answered
  if (s.trade && !s.players[s.trade.to].bot) return false;
  useTheme(s);
  const did = G.botStep(s);
  if (did) changed(s);
  return did;
}
// Tell the rules who the computer is playing for right now.
function sync(s, seats) {
  s.players.forEach((p, i) => {
    const m = seats[i];
    p.bot = !m || m.kind === 'bot' || !!m.covering;
    p.away = !!(m && m.away && m.kind !== 'bot');
    p.level = (m && m.kind === 'bot' && m.level) || 'medium';
  });
}
// Whose answer the game is waiting for.
const turnOf = s => (s.trade ? s.trade.to : s.phase === 'auction' && s.auction ? s.auction.cur : s.turn);
// Several people may act (manage properties, offer or answer trades, bid); the rules check each move.
const canMove = (s, seat) => !!s.players[seat] && !s.players[seat].bankrupt && s.status === 'playing';
const view = s => Object.assign({}, s, { log: s.log.slice(-60), decks: { chance: [], chest: [] }, tradeMemory: [] });
function resultHTML(s) {
  useTheme(s);
  const rank = s.players.map((p, i) => i).sort((a, b) => (b === s.winner) - (a === s.winner) || G.netWorth(s, b) - G.netWorth(s, a));
  return `<div class="standings">${rank.map(i => `<div>${s.players[i].icon} ${esc(s.players[i].name)}: ${s.players[i].bankrupt ? 'bankrupt' : money(G.netWorth(s, i)) + ' net worth'}</div>`).join('')}</div>`;
}

// ------------------------------------------------------------ screen
function mount(root, api) {
let g = null, signature = '';
const ui = { tab: null, lastTurn: -1, trade: null, modal: null, bid: '', seenCard: 0, overlayKey: '', busy: false, pos: [], prevCash: null, wake: null, themeKey: 'classic', dead: false };

root.innerHTML = '<div class="pt"><div id="boardwrap"><div id="board"><div id="cells"></div><div id="tokens"></div><div id="banner"></div></div></div></div>';
api.side.innerHTML = '<div class="pt" id="pt-side"></div>';
const layers = document.createElement('div');
layers.className = 'pt pt-layers';
layers.innerHTML = '<div id="pt-overlay"></div><div id="pt-modal"></div><div id="pt-cardpop"></div>';
document.body.appendChild(layers);
const areas = [root.firstElementChild, api.side.firstElementChild, layers];

const $ = s => document.querySelector(s);
const mine = pi => api.mySeats.includes(pi);
// Like sleep, but a click on the banner / card skips the wait.
function wait(ms) {
  return new Promise(r => {
    if (document.hidden) ms = 0;
    const t = setTimeout(() => { ui.wake = null; r(); }, ms);
    ui.wake = () => { clearTimeout(t); ui.wake = null; r(); };
  });
}
// Switch the board theme: renames spaces and cards, and recolours the board.
function setTheme(key) {
  const T = THEMES[themeKey(key)];
  G.applyTheme(themeKey(key));
  ICON.rr = T.rr; ICON.util = T.util;
  areas.forEach(el => ['accent', 'accent2', 'c1', 'c2', 'c3'].forEach(k => el.style.setProperty('--' + k, T[k])));
  ui.themeKey = themeKey(key);
}
function act(as, msg) {
  if (ui.busy) return false;
  if (!mine(as)) { toast("That isn't your player"); return false; }
  if (api.hold) { toast('The game is on hold until everyone rejoins.'); return false; }
  return api.move(msg, as);
}
const snap = () => ({ pos: g.players.map(p => p.pos), rollSeq: g.rollSeq, turn: g.turn });

const BANNER_KINDS = new Set(['pay', 'owe', 'go', 'fp', 'jail', 'buy', 'bankrupt']);

// Plays back what the last engine action did: dice, pawn movement, card, then result banners.
async function present(before) {
  const evs = (g.ev || []).filter(e => BANNER_KINDS.has(e.k));
  const rolled = g.rollSeq !== before.rollSeq;
  const mover = g.players.findIndex((p, i) => p.pos !== before.pos[i]);
  if (!rolled && mover < 0 && !evs.length) {
    ui.pos = g.players.map(p => p.pos);
    renderAll();
    return;
  }
  ui.busy = true;
  try {
    ui.pos = before.pos.slice();
    renderCells(); updateTokens();
    if (rolled) {
      sfx.dice();
      await throwDice();
      if (g.dice[0] === g.dice[1]) document.querySelectorAll('#center .dwrap').forEach(d => d.classList.add('dbl'));
      await sleep(450);
    }
    if (mover >= 0) await moveToken(mover, before.pos[mover], evs);
    ui.pos = g.players.map(p => p.pos);
    updateTokens();
    renderSide();
    for (const e of evs.slice(0, 4)) await showBanner(e);
  } finally {
    ui.busy = false;
    if (!ui.dead) {
      ui.pos = g.players.map(p => p.pos);
      renderAll();
    }
  }
}

async function moveToken(i, start, evs) {
  const final = g.players[i].pos;
  const sum = g.dice[0] + g.dice[1];
  const triple = evs.some(e => e.k === 'jail' && e.cause === 'triple');
  if (triple) { await glide(i, final); flashCell(final); return; }
  const land = (start + sum) % 40;
  await walk(i, start, land, 1);
  flashCell(land);
  await sleep(300);
  if (g.lastCard && g.lastCard.seq !== ui.seenCard && g.lastCard.pi === i) await showCardPopup();
  if (final !== land) {
    const jailed = evs.some(e => e.k === 'jail');
    const fwd = (final - land + 40) % 40, back = (land - final + 40) % 40;
    if (jailed) { sfx.jail(); await glide(i, final); }
    else if (back <= 3) await walk(i, land, final, -1);
    else if (fwd <= 12) await walk(i, land, final, 1);
    else await glide(i, final);
    flashCell(final);
    await sleep(250);
  }
}

async function walk(i, from, to, dir) {
  let p = from;
  while (p !== to) {
    p = (p + dir + 40) % 40;
    ui.pos[i] = p;
    updateTokens();
    const el = $('#tk' + i);
    if (el) { el.classList.remove('hop'); void el.offsetWidth; el.classList.add('hop'); }
    sfx.hop();
    await sleep(HOP_MS);
  }
}

async function glide(i, to) {
  const el = $('#tk' + i);
  if (el) el.style.transition = 'left .75s cubic-bezier(.6,0,.2,1), top .75s cubic-bezier(.6,0,.2,1)';
  ui.pos[i] = to;
  updateTokens();
  await sleep(800);
  if (el) el.style.transition = '';
}

function flashCell(i) {
  const el = document.querySelector(`.cell[data-i="${i}"]`);
  if (!el) return;
  el.classList.remove('land'); void el.offsetWidth; el.classList.add('land');
}

async function showCardPopup() {
  const c = g.lastCard, el = $('#pt-cardpop');
  ui.seenCard = c.seq;
  el.innerHTML = `<div class="card-pop ${c.deck}" data-pa="closeCard"><h3>${c.deck === 'chance' ? 'Surprise' : 'Town Fund'}</h3><p>${esc(c.text)}</p></div>`;
  sfx.card();
  await wait(3200);
  el.innerHTML = '';
}

// --- dice ---
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
// rotation [x, y] (deg) that brings each face toward the viewer
const FACE_ROT = { 1: [0, 0], 2: [0, -90], 3: [-90, 0], 4: [90, 0], 5: [0, 90], 6: [0, 180] };

function dieHTML(v) {
  const faces = [1, 2, 3, 4, 5, 6].map(n =>
    `<div class="f f${n}">${[...Array(9).keys()].map(k => `<i class="${PIPS[n].includes(k) ? 'p' : ''}"></i>`).join('')}</div>`).join('');
  const [rx, ry] = FACE_ROT[v];
  return `<div class="dwrap"><div class="die" style="transform:rotateX(${rx}deg) rotateY(${ry}deg)">${faces}</div></div>`;
}

function throwDice() {
  const bw = $('#board').clientWidth;
  const dies = [...document.querySelectorAll('#center .die')];
  const T = (x, y, rx, ry, rz, s) => `translate3d(${x}px,${y}px,0) scale(${s}) rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg)`;
  const anims = dies.map((el, k) => {
    const [fx, fy] = FACE_ROT[g.dice[k]];
    const dir = k ? -1 : 1, turns = 2 + k;
    const frames = [
      { transform: T(-bw * .55, dir * bw * .12, fx - 40, fy + 20, -30, 1.35), offset: 0 },
      { transform: T(-bw * .2, -dir * bw * .06, fx + 360 * turns * .45, fy + 360 * turns * .5, 80, 1.5), offset: .38 },
      { transform: T(-bw * .06, dir * bw * .03, fx + 360 * turns * .75, fy + 360 * turns * .8, -25, 1.15), offset: .62 },
      { transform: T(bw * .02 * dir, -bw * .035, fx + 360 * turns * .92, fy + 360 * turns * .95, 10, 1.22), offset: .8 },
      { transform: T(0, 0, fx + 360 * turns, fy + 360 * turns, 0, 1), offset: 1 },
    ];
    const dur = 1350 + k * 220;
    const a = el.animate(frames, { duration: dur, easing: 'cubic-bezier(.3,.55,.35,1)' });
    // never let a paused/background tab leave the game stuck waiting on the animation
    return Promise.race([a.finished.catch(() => {}), sleep(dur + 600)]);
  });
  return Promise.all(anims);
}

// --- banners ---
const who = i => `<span class="who" style="--c:${g.players[i].color}">${g.players[i].icon} ${esc(g.players[i].name)}</span>`;
const propChip = idx => `<i class="chip" style="background:${GC[SP[idx].group] || '#999'}"></i>${esc(SP[idx].name)}`;

function bannerFor(e) {
  const toName = c => (typeof c === 'number' ? who(c) : c === 'each' ? 'every other player' : c === 'pot' && g.options.freeParking ? 'Free Parking' : 'the bank');
  switch (e.k) {
    case 'pay': {
      let icon = '💸', sub = '';
      if (e.why === 'rent') { icon = SP[e.idx].type === 'rr' ? '🚂' : SP[e.idx].type === 'util' ? '💡' : '🏠'; sub = `Rent for ${propChip(e.idx)}`; }
      else if (e.why === 'tax') { icon = '🧾'; sub = esc(SP[e.idx].name); }
      else if (e.why === 'jailfee') { icon = '🚔'; sub = 'Jail fine'; }
      else if (e.why === 'repairs') { icon = '🔧'; sub = 'Property repairs'; }
      else if (e.why === 'card') { icon = '🃏'; sub = 'Card payment'; }
      return { cls: 'pay', icon, title: `${who(e.from)} paid ${toName(e.to)}`, amt: money(e.amt), sub, ms: e.why === 'rent' ? 2600 : 2000, snd: 'pay' };
    }
    case 'owe':
      return { cls: 'warn', icon: '⚠️', title: `${who(e.from)} owes ${toName(e.to)}`, amt: money(e.amt), sub: 'Sell buildings or mortgage properties to raise the cash', ms: 2400, snd: 'pay' };
    case 'go':
      return { cls: 'gain', icon: '💰', title: `${who(e.pi)} passed GO`, amt: '+' + money(e.amt), sub: 'Salary collected', ms: 1500, snd: 'coin' };
    case 'fp':
      return { cls: 'gain', icon: '🅿️', title: `${who(e.pi)} hit the Free Parking jackpot!`, amt: '+' + money(e.amt), sub: '', ms: 2000, snd: 'coin' };
    case 'jail':
      return { cls: 'pay', icon: '🚔', title: `${who(e.pi)} goes to Jail`, amt: '', sub: e.cause === 'triple' ? 'Three doubles in a row!' : e.cause === 'card' ? 'Sent there by a card' : 'Landed on Go To Jail', ms: 1900, snd: 'jail' };
    case 'buy':
      return { cls: 'gain', icon: '🏷️', title: `${who(e.pi)} ${e.auction ? 'won the auction for' : 'bought'}`, amt: money(e.price), sub: propChip(e.idx), ms: 1700, snd: 'buy' };
    case 'bankrupt':
      return { cls: 'pay', icon: '💥', title: `${who(e.pi)} is bankrupt!`, amt: '', sub: 'Their properties are gone from the game', ms: 2400, snd: 'jail' };
  }
  return null;
}

async function showBanner(e) {
  const b = bannerFor(e);
  if (!b) return;
  const el = $('#banner');
  el.innerHTML = `<div class="bn ${b.cls}"><div class="bi">${b.icon}</div><div class="bt">${b.title}</div>${b.amt ? `<div class="ba">${b.amt}</div>` : ''}<div class="bs">${b.sub}</div></div>`;
  el.classList.add('show');
  if (b.snd) sfx[b.snd]();
  await wait(b.ms);
  el.classList.remove('show');
  await sleep(220);
}

// ------------------------------------------------------------ rendering
function cellPos(i) {
  if (i <= 10) return [11, 11 - i];
  if (i < 20) return [11 - (i - 10), 1];
  if (i <= 30) return [1, 1 + (i - 20)];
  return [1 + (i - 30), 11];
}
function sideOf(i) {
  if (i % 10 === 0) return 'c';
  return i < 10 ? 'b' : i < 20 ? 'l' : i < 30 ? 't' : 'r';
}
// centre of a cell as % of the board (grid tracks are 1.6fr, 9 x 1fr, 1.6fr)
function cellCenter(i) {
  const [r, c] = cellPos(i), W = 12.2;
  const f = k => (k === 1 ? .8 : k === 11 ? 1.6 + 9 + .8 : 1.6 + (k - 2) + .5) / W * 100;
  return { x: f(c), y: f(r) };
}
const ICON = { go: '🚀', chance: '❓', chest: '📦', jail: '🔒', free: '🅿️', gotojail: '👮', tax: '💰', rr: '🚂', util: '💡' };
// where up to 8 pawns stand when they share a space
const OFFS = [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5], [0, -2.4], [0, 2.4], [-2.6, 0], [2.6, 0]];

function cellsHTML() {
  let h = '';
  for (let i = 0; i < 40; i++) {
    const s = SP[i], pr = g.props[i], [r, c] = cellPos(i);
    const cls = ['cell', sideOf(i), 't-' + s.type, pr && pr.mortgaged ? 'mort' : '', pr && pr.owner >= 0 ? 'owned' : ''].join(' ');
    let inner = '';
    if (s.type === 'prop') {
      const hs = pr.houses === 5 ? '<i class="h hotel"></i>' : '<i class="h"></i>'.repeat(pr.houses);
      inner += `<div class="bar" style="background-color:${GC[s.group]}">${hs}</div>`;
    }
    let extra = '';
    if (s.group) extra = `<div class="px">${money(s.price)}</div>`;
    if (s.type === 'tax') extra = `<div class="px">${money(s.tax)}</div>`;
    if (s.type === 'free' && g.options.freeParking) extra = `<div class="px">Pot ${money(g.pot)}</div>`;
    const ico = ICON[s.type] && s.type !== 'prop' ? `<div class="ico">${ICON[s.type]}</div>` : '';
    inner += `<div class="info">${ico}<div class="nm">${esc(s.name)}</div>${extra}</div>`;
    if (pr && pr.owner >= 0) {
      const o = g.players[pr.owner];
      inner += `<div class="own" style="background:${o.color}"></div><div class="badge" style="--c:${o.color}" title="Owned by ${esc(o.name)}">${esc(Array.from(o.name.trim() || '?')[0].toUpperCase())}</div>`;
    }
    h += `<div class="${cls}" style="grid-row:${r};grid-column:${c}" data-pa="deed" data-i="${i}">${inner}</div>`;
  }
  return h + centerHTML();
}

function renderCells() { $('#cells').innerHTML = cellsHTML(); }

function updateTokens() {
  const layer = $('#tokens');
  const groups = {};
  g.players.forEach((p, i) => { if (!p.bankrupt) (groups[ui.pos[i]] = groups[ui.pos[i]] || []).push(i); });
  const live = new Set();
  Object.keys(groups).forEach(pos => {
    const list = groups[pos], c = cellCenter(+pos);
    list.forEach((i, k) => {
      live.add('tk' + i);
      let el = $('#tk' + i);
      if (!el) {
        el = document.createElement('div');
        el.id = 'tk' + i; el.className = 'pawn';
        el.style.setProperty('--c', g.players[i].color);
        el.innerHTML = `<span>${g.players[i].icon}</span>`;
        layer.appendChild(el);
      }
      const [ox, oy] = list.length > 1 ? OFFS[k % OFFS.length] : [0, 0];
      el.classList.toggle('crowd', list.length > 4);
      el.style.left = (c.x + ox) + '%';
      el.style.top = (c.y + oy) + '%';
      el.classList.toggle('active', i === g.turn && g.status === 'playing');
    });
  });
  [...layer.children].forEach(el => { if (!live.has(el.id)) el.remove(); });
}

const kbd = k => `<kbd>${k}</kbd>`;

function centerHTML() {
  const p = g.players[g.turn];
  const human = !p.bot && mine(g.turn);   // online: only the person who owns this seat gets the buttons
  let status = '', btns = '';
  if (ui.busy) {
    status = `${p.icon} ${esc(p.name)}`;
  } else {
    if (api.hold && g.status === 'playing') {
      const away = g.players.filter(x => x.away && !x.bot && !x.bankrupt).map(x => esc(x.name)).join(', ');
      status = `⏸ Game on hold<small>Waiting for ${away || 'everyone'} to rejoin…</small>`;
      if (api.isHost) btns = `<button data-room="unhold">▶ Start anyway</button>`;
    } else switch (g.phase) {
      case 'roll':
        status = `${p.icon} ${esc(p.name)}'s turn${p.inJail ? `<small>In Jail (attempt ${p.jailTurns + 1}/3) — roll doubles, pay ${money(g.options.jailFine)}, or use a card</small>` : ''}`;
        if (human) {
          btns = `<button data-pa="roll">🎲 ${p.inJail ? 'Roll for doubles' : 'Roll dice'} ${kbd('R')}</button>`;
          if (p.inJail) {
            btns += `<button class="sec" data-pa="payJail" ${p.cash < g.options.jailFine ? 'disabled' : ''}>Pay ${money(g.options.jailFine)} ${kbd('J')}</button>`;
            if (p.jailCards.length) btns += `<button class="sec" data-pa="useCard">Use Get Out of Jail card ${kbd('C')}</button>`;
          }
        }
        break;
      case 'buy': {
        const s = SP[g.buy.idx];
        status = `${esc(p.name)} landed on <b>${esc(s.name)}</b><small>Price ${money(s.price)} · you have ${money(p.cash)}</small>`;
        if (human) btns = `<button class="ok" data-pa="buy" ${p.cash < s.price ? 'disabled' : ''}>Buy for ${money(s.price)} ${kbd('B')}</button><button class="sec" data-pa="decline">${g.options.auction ? 'Auction it' : 'Pass'} ${kbd('A')}</button>`;
        break;
      }
      case 'tax': {
        const pct = G.incomeTaxPercent(g, g.turn);
        status = `${esc(p.name)} landed on <b>Income Tax</b><small>Pay a flat $200, or 10% of your total worth (cash + property + buildings) = ${money(pct)}</small>`;
        if (human) btns = `<button data-pa="taxFlat">Pay $200</button><button class="sec" data-pa="taxPercent">Pay 10% (${money(pct)})</button>`;
        break;
      }
      case 'post':
        status = g.rolledDoubles ? `${p.icon} ${esc(p.name)} rolled doubles — roll again!` : `${p.icon} ${esc(p.name)}<small>Manage properties or trade, then end your turn</small>`;
        if (human) btns = g.rolledDoubles ? `<button data-pa="roll">🎲 Roll again ${kbd('R')}</button>` : `<button data-pa="endTurn">End turn ➜ ${kbd('E')}</button>`;
        break;
      case 'debt': {
        const d = g.debt;
        const to = typeof d.creditor === 'number' ? g.players[d.creditor].name : d.creditor === 'each' ? 'the other players' : 'the bank';
        status = `${esc(p.name)} owes ${money(d.amt)} to ${esc(to)}<small>Has ${money(p.cash)}. Sell buildings or mortgage properties (right panel) — it pays automatically once you have enough.</small>`;
        if (human) btns = `<button class="danger" data-pa="bankrupt">Declare bankruptcy</button>`;
        break;
      }
      case 'auction':
        status = `Auction for <b>${esc(SP[g.auction.idx].name)}</b>`;
        break;
      case 'over':
        status = `🏆 ${esc(g.players[g.winner].name)} wins!`;
        break;
    }
    if (g.status === 'playing' && g.phase !== 'auction' && !api.hold) {
      if (p.bot) status += '<small>🤖 Computer is thinking…</small>';
      else if (!human) status += p.away ? `<small>⏳ ${esc(p.name)} lost connection. Waiting for them to come back…</small>` : `<small>⏳ Waiting for ${esc(p.name)}…</small>`;
    }
  }
  const pot = g.options.freeParking ? `<div class="pot">🅿️ Free Parking pot: ${money(g.pot)}</div>` : '';
  return `<div id="center">
    <div class="title">TYCOON</div>${ui.themeKey && ui.themeKey !== 'classic' && THEMES[ui.themeKey] ? `<div class="sub">${THEMES[ui.themeKey].emoji} ${esc(THEMES[ui.themeKey].name)}</div>` : ''}
    <div class="dicebox">${dieHTML(g.dice[0])}${dieHTML(g.dice[1])}</div>
    <div class="status">${status}</div>
    <div class="actions">${btns}</div>${pot}</div>`;
}

function sideHTML() {
  const players = g.players.map((p, i) => {
    const dots = G.owned(g, i).map(j => `<i class="${g.props[j].mortgaged ? 'm' : ''}" style="background:${GC[SP[j].group]}" data-pa="deed" data-i="${j}" title="${esc(SP[j].name)}"></i>`).join('');
    const tags = [api.mySeats.includes(i) ? 'YOU' : '', p.away ? 'AWAY' : p.bot ? `BOT · ${LEVEL_TAG[p.level || 'medium']}` : '', p.inJail ? 'JAIL' : '', p.jailCards.length ? `🎟️×${p.jailCards.length}` : '', p.bankrupt ? 'OUT' : ''].filter(Boolean).map(t => `<span class="tag">${t}</span>`).join('');
    const prev = ui.prevCash ? ui.prevCash[i] : null;
    const flash = prev == null || prev === p.cash ? '' : p.cash > prev ? 'up' : 'down';
    return `<div class="pl ${i === g.turn && !p.bankrupt && g.status === 'playing' ? 'turn' : ''} ${p.bankrupt ? 'out' : ''}" style="--c:${p.color}">
      <span class="ic">${p.icon}</span>
      <div class="mid"><div class="nm">${esc(p.name)}${tags}</div><div class="dots">${dots}</div></div>
      <div class="cash ${flash}" title="Net worth ${money(G.netWorth(g, i))}">${money(p.cash)}</div></div>`;
  }).join('');
  return `<div class="panel"><h4>Players</h4>${players}</div>${manageHTML()}
    <div class="panel"><h4>Game log</h4><div class="ptlog" id="pt-log">${g.log.slice(-60).map(l => `<div>${esc(l)}</div>`).join('')}</div></div>`;
}

function renderSide() {
  const keep = $('#pt-side').scrollTop;
  $('#pt-side').innerHTML = sideHTML();
  $('#pt-side').scrollTop = keep;
  ui.prevCash = g.players.map(p => p.cash);
  const log = $('#pt-log'); if (log) log.scrollTop = log.scrollHeight;
}

function manageHTML() {
  const a = g.status === 'playing' ? (g.phase === 'auction' ? g.auction.cur : g.turn) : g.turn;
  let mp = ui.tab == null ? a : ui.tab;
  if (ui.tab == null && !mine(a)) {   // show my own properties by default
    const m = api.mySeats.find(i => !g.players[i].bankrupt);
    if (m != null) mp = m;
  }
  if (g.players[mp].bankrupt) mp = a;
  const p = g.players[mp];
  const tabs = G.alive(g).map(i => `<button class="sm sec ${i === mp ? 'on' : ''}" data-pa="tab" data-p="${i}">${g.players[i].icon} ${esc(g.players[i].name)}</button>`).join('');
  const myProps = G.owned(g, mp);
  const canAct = !p.bot && g.status === 'playing' && !ui.busy && mine(mp);
  const rows = myProps.map(i => {
    const s = SP[i], pr = g.props[i];
    const btn = (type, label, cls) => {
      const err = G.manage(g, mp, type, i, true);
      return `<button class="sm ${cls || 'sec'}" data-pa="mg" data-t="${type}" data-i="${i}" data-p="${mp}" ${err ? `disabled title="${esc(err)}"` : ''}>${label}</button>`;
    };
    let b = '';
    if (canAct) {
      if (s.type === 'prop' && G.ownsGroup(g, mp, s.group)) b += btn('build', `🏠 ${money(s.hc)}`, 'ok');
      if (pr.houses > 0) b += btn('sell', `Sell +${money(s.hc / 2)}`);
      if (pr.mortgaged) b += btn('unmortgage', `Unmortgage ${money(G.unmortgageCost(i))}`);
      else if (pr.houses === 0) b += btn('mortgage', `Mortgage +${money(G.mortgageValue(i))}`);
    }
    const hs = pr.houses === 5 ? ' 🏨' : pr.houses ? ' 🏠×' + pr.houses : '';
    return `<div class="mrow"><span class="sw" style="background:${GC[s.group]}" data-pa="deed" data-i="${i}"></span>
      <span class="n ${pr.mortgaged ? 'm' : ''}">${esc(s.name)}${hs}</span><span class="btns">${b}</span></div>`;
  }).join('') || '<div class="empty">No properties yet.</div>';
  const others = G.alive(g).length > 1 && canAct && !g.trade && g.phase !== 'auction';
  const ub = canAct && G.lastBuild(g, mp);
  const undoRow = ub ? `<div class="undo"><button class="sm sec" data-pa="undoBuild" data-p="${mp}">↩ Undo: ${ub.hotel ? 'hotel' : 'house'} on ${esc(SP[ub.idx].name)} (+${money(ub.cost)})</button><small>Changed your mind? You can undo purchases until your turn ends.</small></div>` : '';
  return `<div class="panel"><h4>Properties ${others ? `<button class="sm" data-pa="trade" data-p="${mp}">🤝 Propose trade</button>` : ''}</h4>
    <div class="tabs">${tabs}</div>${undoRow}${rows}
    ${p.bot ? '<div class="empty">Computer players manage their own properties.</div>' : !mine(mp) ? `<div class="empty">Only ${esc(p.name)} can manage these.</div>` : ''}</div>`;
}

// ------------------------------------------------------------ deeds & dialogs
function deedHTML(i) {
  const s = SP[i], pr = g.props[i];
  if (!s.group) {
    return `<div class="deed"><div class="hd">${esc(s.name)}</div><div class="bd" style="text-align:center">${s.type === 'tax' ? `Pay ${money(s.tax)}` : ''}</div></div>`;
  }
  let rows = '';
  if (s.type === 'prop') {
    rows = `<div><span>Rent</span><b>${money(s.rent[0])}</b></div><div><span>Full colour set</span><b>${money(s.rent[0] * 2)}</b></div>` +
      [1, 2, 3, 4].map(n => `<div><span>With ${n} house${n > 1 ? 's' : ''}</span><b>${money(s.rent[n])}</b></div>`).join('') +
      `<div><span>With hotel</span><b>${money(s.rent[5])}</b></div><div><span>House / hotel cost</span><b>${money(s.hc)}</b></div>`;
  } else if (s.type === 'rr') {
    rows = [1, 2, 3, 4].map(n => `<div><span>${n} railroad${n > 1 ? 's' : ''} owned</span><b>${money(25 * Math.pow(2, n - 1))}</b></div>`).join('');
  } else {
    rows = '<div><span>1 utility owned</span><b>4× dice</b></div><div><span>2 utilities owned</span><b>10× dice</b></div>';
  }
  const owner = pr.owner >= 0 ? `${g.players[pr.owner].icon} ${esc(g.players[pr.owner].name)}${pr.mortgaged ? ' (mortgaged)' : ''}` : 'Unowned';
  const light = s.group === 'lblue' || s.group === 'yellow' || s.group === 'util';
  return `<div class="deed"><div class="hd" style="background:${GC[s.group]};color:${light ? '#111' : '#fff'}">${esc(s.name)}</div>
    <div class="bd">${rows}<div><span>Price</span><b>${money(s.price)}</b></div><div><span>Mortgage value</span><b>${money(s.price / 2)}</b></div><div><span>Owner</span><b>${owner}</b></div></div></div>`;
}

// A property shown as a card in its set's colour. The colour is written out too, so nobody has to tell shades apart.
function tradeCard(i) {
  const group = SP[i].group, light = group === 'lblue' || group === 'yellow' || group === 'util';
  return `<div class="tcard"><div class="tband ${light ? 'light' : ''}" style="background:${GC[group]}">${esc(G.GROUP_NAMES[group])}</div>
    <div class="tname">${esc(SP[i].name)}${g.props[i].mortgaged ? '<small>Mortgaged</small>' : ''}</div></div>`;
}
function sideText(s) {
  const parts = s.props.slice().sort((a, b) => a - b).map(tradeCard);   // board order keeps each colour together
  if (s.cash) parts.push(`<div class="tcard extra">💵 ${money(s.cash)}</div>`);
  if (s.cards) parts.push(`<div class="tcard extra">🎟️ ${s.cards} Get Out of Jail card${s.cards > 1 ? 's' : ''}</div>`);
  return parts.join('') || '<div class="tcard extra">Nothing</div>';
}

function renderOverlay() {
  const el = $('#pt-overlay');
  let key = '', html = '';
  if (g.status === 'over') {
    key = 'over';
  } else if (g.trade) {
    const t = g.trade, A = g.players[t.from], B = g.players[t.to];
    key = 'trade' + JSON.stringify(t);
    html = `<div class="ov"><div class="dlg"><h2>🤝 Trade offer</h2>
      <div class="tside"><p><b>${A.icon} ${esc(A.name)}</b> gives:</p><div class="tcards">${sideText(t.offer)}</div></div>
      <div class="tside"><p><b>${B.icon} ${esc(B.name)}</b> gives:</p><div class="tcards">${sideText(t.request)}</div></div>
      <div class="btns">${B.bot ? '<span class="empty">🤖 Waiting for the computer…</span>' : !mine(t.to) ? `<span class="empty">⏳ Waiting for ${esc(B.name)} to answer…</span>` : `<button class="ok" data-pa="tAccept">${esc(B.name)}: Accept</button><button class="sec" data-pa="tDecline">${esc(B.name)}: Decline</button>`}
      ${A.bot || !mine(t.from) ? '' : `<button class="sec" data-pa="tCancel">Cancel offer</button>`}</div></div></div>`;
  } else if (g.phase === 'auction') {
    const a = g.auction, p = g.players[a.cur];
    key = 'auction' + JSON.stringify(a);
    const bidder = a.bidder >= 0 ? `${g.players[a.bidder].icon} ${esc(g.players[a.bidder].name)}` : 'no one yet';
    const quick = [10, 50, 100].map(k => `<button class="sec" data-pa="bid" data-amt="${a.high + k}" ${a.high + k > p.cash ? 'disabled' : ''}>+${money(k)} → ${money(a.high + k)}</button>`).join('');
    html = `<div class="ov"><div class="dlg"><h2>🔨 Auction</h2>${deedHTML(a.idx)}
      <div class="big">Highest bid: ${money(a.high)}</div><div>Leader: ${bidder}</div>
      <p>Still in: ${a.active.map(i => g.players[i].icon).join(' ')} · <b>${p.icon} ${esc(p.name)}'s bid</b> (cash ${money(p.cash)})</p>
      ${p.bot ? '<div class="empty">🤖 Computer is deciding…</div>' : !mine(a.cur) ? `<div class="empty">⏳ Waiting for ${esc(p.name)} to bid or pass…</div>` : `<div class="bidbtns">${quick}</div>
      <div class="bidbtns"><input type="number" id="bidin" min="${a.high + 1}" max="${p.cash}" placeholder="Custom" value="${esc(ui.bid)}"><button data-pa="bidc">Bid</button><button class="danger" data-pa="pass">Pass</button></div>`}</div></div>`;
  }
  if (key !== ui.overlayKey) { ui.overlayKey = key; el.innerHTML = html; }
}

// trade builder -------------------------------------------------
function openTrade(from) {
  const to = G.alive(g).find(i => i !== from);
  ui.trade = { from, to, offer: { cash: 0, props: [], cards: 0 }, request: { cash: 0, props: [], cards: 0 } };
  ui.modal = 'trade';
  renderModal();
}

function tradeSideHTML(pi, key) {
  const p = g.players[pi], s = ui.trade[key];
  const props = G.owned(g, pi).map(i => {
    const blocked = G.hasBuildings(g, SP[i].group);
    return `<label class="chk ${blocked ? 'dis' : ''}"><input type="checkbox" data-k="${key}" data-i="${i}" ${s.props.includes(i) ? 'checked' : ''} ${blocked ? 'disabled' : ''}>
      <span class="sw tsw" style="background:${GC[SP[i].group]}"></span><span>${esc(SP[i].name)}${g.props[i].mortgaged ? ' (mortgaged)' : ''}<small class="tgroup">${esc(G.GROUP_NAMES[SP[i].group])}</small></span></label>`;
  }).join('') || '<div class="empty">No properties</div>';
  return `<div class="col"><h5>${p.icon} ${esc(p.name)} gives</h5>${props}
    <div class="field">Cash $<input type="number" min="0" max="${p.cash}" value="${s.cash || ''}" data-k="${key}" data-f="cash" placeholder="0"> <small>(has ${money(p.cash)})</small></div>
    ${p.jailCards.length ? `<div class="field">Jail cards <input type="number" min="0" max="${p.jailCards.length}" value="${s.cards || ''}" data-k="${key}" data-f="cards" placeholder="0"></div>` : ''}</div>`;
}

function renderModal() {
  const el = $('#pt-modal');
  if (!ui.modal) { el.innerHTML = ''; return; }
  if (ui.modal === 'trade') {
    const t = ui.trade;
    const partners = G.alive(g).filter(i => i !== t.from).map(i => `<button class="sm ${i === t.to ? '' : 'sec'}" data-pa="trTo" data-p="${i}">${g.players[i].icon} ${esc(g.players[i].name)}</button>`).join(' ');
    el.innerHTML = `<div class="ov"><div class="dlg" style="width:min(760px,100%)"><h2>🤝 New trade</h2>
      <div style="margin-bottom:10px">Trade with: ${partners}</div>
      <div class="cols">${tradeSideHTML(t.from, 'offer')}${tradeSideHTML(t.to, 'request')}</div>
      <p class="empty">Properties in a colour set with buildings can't be traded. Mortgaged properties cost the receiver a 10% fee.</p>
      <div class="btns"><button data-pa="trSend">Send offer</button><button class="sec" data-pa="closeModal">Cancel</button></div></div></div>`;
  } else if (ui.modal && ui.modal.deed != null) {
    el.innerHTML = `<div class="ov" data-pa="closeModal"><div class="dlg" style="width:340px">${deedHTML(ui.modal.deed)}<div class="btns" style="justify-content:center"><button class="sec" data-pa="closeModal">Close</button></div></div></div>`;
  }
}

// Fallback for a card that wasn't shown during an animation (e.g. after resuming a save).
function showCard() {
  if (!g.lastCard || g.lastCard.seq === ui.seenCard) return;
  ui.seenCard = g.lastCard.seq;
}

function renderAll(skipOverlay) {
  if (ui.lastTurn !== g.turn) { ui.lastTurn = g.turn; ui.tab = null; ui.bid = ''; }
  renderCells(); updateTokens(); renderSide();
  if (!skipOverlay) { renderOverlay(); showCard(); }
}

// ------------------------------------------------------------ buttons and keys
function onClick(e) {
  const el = e.target.closest('[data-pa]');
  if (!el) {
    if (e.target.closest('#banner') && ui.wake) ui.wake();
    return;
  }
  if (el.disabled) return;
  const d = el.dataset, a = d.pa;
  if (a === 'closeModal') { if (el.classList.contains('ov') && e.target !== el) return; ui.modal = null; renderModal(); return; }
  if (a === 'closeCard') { if (ui.wake) ui.wake(); else $('#pt-cardpop').innerHTML = ''; return; }
  if (!g) return;
  switch (a) {
    case 'roll': case 'endTurn': case 'buy': case 'decline': case 'payJail': case 'useCard': case 'taxFlat': case 'taxPercent':
      act(g.turn, { type: a }); break;
    case 'bankrupt':
      if (confirm(`${g.players[g.turn].name} will be out of the game. Continue?`)) act(g.turn, { type: 'bankrupt' });
      break;
    case 'bid': act(g.auction.cur, { type: 'bid', amount: +d.amt }); break;
    case 'bidc': act(g.auction.cur, { type: 'bid', amount: +$('#bidin').value }); break;
    case 'pass': act(g.auction.cur, { type: 'pass' }); break;
    case 'mg': act(+d.p, { type: d.t, idx: +d.i }); break;
    case 'undoBuild': act(+d.p, { type: 'undoBuild' }); break;
    case 'tab': ui.tab = +d.p; renderSide(); break;
    case 'deed': ui.modal = { deed: +d.i }; renderModal(); break;
    case 'trade': openTrade(+d.p); break;
    case 'trTo': ui.trade.to = +d.p; ui.trade.request = { cash: 0, props: [], cards: 0 }; renderModal(); break;
    case 'trSend': {
      const t = ui.trade;
      if (act(t.from, { type: 'propose', to: t.to, offer: t.offer, request: t.request })) { ui.modal = null; renderModal(); }
      break;
    }
    case 'tAccept': act(g.trade.to, { type: 'tradeAccept' }); break;
    case 'tDecline': act(g.trade.to, { type: 'tradeDecline' }); break;
    case 'tCancel': act(g.trade.from, { type: 'tradeDecline' }); break;
  }
}
function onChange(e) {
  const el = e.target;
  if (!ui.trade || ui.modal !== 'trade' || !el.dataset.k) return;
  const side = ui.trade[el.dataset.k];
  if (el.dataset.i != null) {
    const i = +el.dataset.i;
    side.props = el.checked ? side.props.concat(i) : side.props.filter(x => x !== i);
  } else {
    side[el.dataset.f] = Math.max(0, Math.floor(+el.value || 0));
  }
}
areas.forEach(el => {
  el.addEventListener('click', onClick);
  el.addEventListener('change', onChange);
  el.addEventListener('input', e => { if (e.target.id === 'bidin') ui.bid = e.target.value; });
});
// Keyboard shortcuts: R roll, B buy, A auction (or pass), E end turn, J pay jail fine, C jail card.
const KEYS = { r: 'roll', b: 'buy', a: 'decline', e: 'endTurn', j: 'payJail', c: 'useCard' };
function onKey(e) {
  if (e.key === 'Enter' && e.target.id === 'bidin') { e.preventDefault(); act(g.auction.cur, { type: 'bid', amount: +e.target.value }); return; }
  if (e.key === 'Escape' && ui.modal) { ui.modal = null; renderModal(); return; }
  const wanted = KEYS[e.key.toLowerCase()];
  if (!wanted || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  if (!g || ui.busy || ui.modal || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) || document.querySelector('#modal:not(:empty)')) return;
  const btn = document.querySelector(`#center .actions [data-pa="${wanted}"]`);
  if (btn && !btn.disabled) { e.preventDefault(); btn.click(); }
}
document.addEventListener('keydown', onKey);

// ------------------------------------------------------------ what the room calls
const sigNow = () => JSON.stringify([g.seq, api.hold, api.isHost, api.mySeats, g.players.map(p => [p.bot, p.away, p.level])]);
function reset(next) {
  g = next;
  setTheme(g.options.theme);
  ui.busy = false; ui.overlayKey = ''; ui.modal = null; ui.prevCash = null;
  ui.seenCard = g.lastCard ? g.lastCard.seq : 0;
  ui.pos = g.players.map(p => p.pos);
  $('#tokens').innerHTML = ''; $('#banner').className = ''; $('#pt-cardpop').innerHTML = ''; $('#pt-modal').innerHTML = '';
  renderAll();
  signature = sigNow();
}
async function update(next) {
  const before = snap();
  g = next;
  useTheme(g);
  await present(before);
  if (!ui.dead) signature = sigNow();
}
// The room calls this often; only redraw when something shown here has changed.
function refresh() {
  if (ui.busy || !g || ui.dead) return;
  const now = sigNow();
  if (now === signature) return;
  signature = now;
  renderAll();
}
return {
  reset, update, refresh,
  destroy() {
    ui.dead = true;
    if (ui.wake) ui.wake();
    document.removeEventListener('keydown', onKey);
    layers.remove(); api.side.innerHTML = ''; root.innerHTML = '';
  },
};
}

Core.register({
  id: 'property', name: 'Property Tycoon', emoji: '🏙️', color: '#ffb020',
  blurb: 'Buy streets, build houses, collect rent, and make deals.',
  min: 2, max: 8, levels: true, ownSide: true,
  rules: [
    'Roll the dice, buy streets and charge rent to anyone who lands on them.',
    'Own a whole colour set to build houses. Trade with others to complete your sets.',
    'The last player who is not bankrupt wins.',
  ],
  options: optionList, foldOptions: 'House rules and settings', presets: PRESETS,
  shuffle: opts => !!opts.randomOrder,
  create, exec, step, sync, view, canMove, resultHTML,
  turn: turnOf,
  mount,
});
})();
