/* Monopoly UI: setup screen, board rendering, animation, panels, dialogs. */
(() => {
'use strict';
const G = Game, SP = G.SPACES, GC = G.GROUP_COLORS;
const TOKENS = ['🎩', '🚗', '🐕', '🚢', '🎸', '🦖', '🐈', '👢'];
const BOT_DELAY = 700;
const HOP_MS = 175;

let g = null;
const ui = {
  tab: null, lastTurn: -1, trade: null, modal: null, bid: '', seenCard: 0, overlayKey: '', timer: null, setup: null,
  busy: false, pos: [], prevCash: null, wake: null, screen: 'home', msg: '',
};

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '$' + Math.round(n).toLocaleString();
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Like sleep, but a click on the banner / card skips the wait.
function wait(ms) {
  return new Promise(r => {
    const t = setTimeout(() => { ui.wake = null; r(); }, ms);
    ui.wake = () => { clearTimeout(t); ui.wake = null; r(); };
  });
}
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// ------------------------------------------------------------ sound (tiny WebAudio synth)
const sfx = (() => {
  let ctx = null, muted = false;
  try { muted = localStorage.getItem('monopoly-mute') === '1'; } catch (e) { /* ignore */ }
  const C = () => {
    if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* no audio */ } }
    return ctx;
  };
  function tone(f, d, type, v, when, slide) {
    const c = C(); if (!c || muted) return;
    const t = c.currentTime + (when || 0);
    const o = c.createOscillator(), gn = c.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + d);
    gn.gain.setValueAtTime(v || .12, t);
    gn.gain.exponentialRampToValueAtTime(.0001, t + d);
    o.connect(gn); gn.connect(c.destination);
    o.start(t); o.stop(t + d + .02);
  }
  function noise(d, v, when) {
    const c = C(); if (!c || muted) return;
    const t = c.currentTime + (when || 0), len = Math.floor(c.sampleRate * d);
    const buf = c.createBuffer(1, len, c.sampleRate), dat = buf.getChannelData(0);
    for (let i = 0; i < len; i++) dat[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = c.createBufferSource(), f = c.createBiquadFilter(), gn = c.createGain();
    s.buffer = buf; f.type = 'bandpass'; f.frequency.value = 1700; gn.gain.value = v;
    s.connect(f); f.connect(gn); gn.connect(c.destination); s.start(t);
  }
  return {
    dice() { for (let i = 0; i < 10; i++) noise(.05, .3, i * .1 + Math.random() * .03); },
    hop() { tone(540, .09, 'triangle', .1, 0, 330); },
    coin() { tone(880, .1, 'square', .05); tone(1320, .2, 'square', .05, .09); },
    pay() { tone(330, .18, 'sawtooth', .06, 0, 180); },
    card() { tone(660, .12, 'sine', .12); tone(990, .22, 'sine', .12, .1); },
    jail() { tone(170, .55, 'sawtooth', .08, 0, 80); },
    buy() { tone(523, .1, 'triangle', .13); tone(784, .22, 'triangle', .13, .09); },
    toggle() { muted = !muted; try { localStorage.setItem('monopoly-mute', muted ? '1' : '0'); } catch (e) { /* ignore */ } return muted; },
    get muted() { return muted; },
  };
})();

// ------------------------------------------------------------ persistence (host only; guests keep nothing but a room code)
const HOST_KEY = 'monopoly-online-host-v1', GUEST_KEY = 'monopoly-online-guest-v1', PREF_KEY = 'monopoly-online-prefs-v1';
const lsGet = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } };
const lsDel = k => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } };

function save() {
  if (net && net.role === 'host' && net.started && g) lsSet(HOST_KEY, { code: net.code, g, owner: net.owner });
}

// ------------------------------------------------------------ rule options (host's lobby)
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

// ------------------------------------------------------------ online room plumbing (PeerJS = free peer-to-peer connections)
// The HOST's browser runs the real game (the rules engine). Friends send "I want to do X" messages to the host,
// and the host sends everyone the new game state. Nobody needs to install anything.
const PEER_PREFIX = 'monopolyhome-';
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
const newCid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const AWAY_GRACE_MS = 20000;   // how long a dropped player has to come back before the computer takes over

let net = null;   // null = not in a room
const mine = pi => !net || net.mine.has(pi);

const sendTo = (conn, o) => { try { if (conn && conn.open) conn.send(JSON.stringify(o)); } catch (e) { /* connection closing */ } };
const parse = d => { try { return typeof d === 'string' ? JSON.parse(d) : null; } catch (e) { return null; } };
// What friends get to see: everything except the secret card order.
const pubG = () => Object.assign({}, g, { log: g.log.slice(-60), decks: { chance: [], chest: [] } });
function broadcast() {
  if (!net || net.role !== 'host' || !g) return;
  const m = JSON.stringify({ t: 'state', g: pubG() });
  Object.values(net.conns).forEach(c => { try { if (c.open) c.send(m); } catch (e) { /* ignore */ } });
}

function prefs() { return Object.assign({ name: '', icon: TOKENS[0] }, lsGet(PREF_KEY)); }
function readMe() {
  const n = $('#myname'), ic = $('#myicon');
  if (!n) return prefs();
  const v = { name: n.value.trim().slice(0, 16) || 'Player', icon: ic.value };
  lsSet(PREF_KEY, v);
  return v;
}

function initSetup() {
  ui.screen = 'home'; ui.msg = '';
  ui.setup = { opts: Object.assign({}, G.DEFAULTS) };
}

function readOpts() {
  const s = ui.setup;
  OPTS.forEach(([k]) => { const el = $('#o-' + k); if (el) s.opts[k] = el.checked; });
  ['startCash', 'dealProps'].forEach(k => { const el = $('#o-' + k); if (el) s.opts[k] = +el.value; });
  NUMS.forEach(([k]) => { const el = $('#o-' + k); if (el) s.opts[k] = +el.value; });
}
function readSeats() {
  if (!net || net.role !== 'host' || net.started) return;
  net.seats.forEach((st, i) => {
    const nm = $('#sname' + i), ic = $('#sicon' + i);
    if (nm) st.name = nm.value.slice(0, 16);
    if (ic) st.icon = ic.value;
  });
}

const tokenOptions = sel => TOKENS.map(t => `<option ${t === sel ? 'selected' : ''}>${t}</option>`).join('');
const isWeb = () => /^https?:$/.test(location.protocol);
const inviteUrl = () => `${location.origin}${location.pathname}?join=${net.code}`;

function homeHTML() {
  const p = prefs(), hs = lsGet(HOST_KEY), gs = lsGet(GUEST_KEY);
  const joinCode = (new URLSearchParams(location.search).get('join') || '').toUpperCase();
  return `
    <h1>🌐 Monopoly Online</h1>
    <p class="lead">Play with friends in different places, 2–4 players. One person hosts and shares a room code. No accounts, no installs.</p>
    ${ui.msg ? `<div class="notice">${esc(ui.msg)}</div>` : ''}
    ${hs && hs.g && hs.g.status === 'playing' ? `<div class="card"><h3>Your hosted game is still saved</h3><div class="prow"><button class="ok" data-a="resumeHost">▶ Resume hosting (room ${esc(hs.code)})</button><button class="sec" data-a="dropHost">Discard</button></div></div>` : ''}
    ${gs ? `<div class="card"><h3>You were in a game</h3><div class="prow"><button class="ok" data-a="rejoin">↩ Rejoin room ${esc(gs.code)}</button><button class="sec" data-a="dropGuest">Forget it</button></div></div>` : ''}
    <div class="card"><h3>Your player</h3>
      <div class="prow"><select class="icon" id="myicon">${tokenOptions(p.icon)}</select><input type="text" id="myname" value="${esc(p.name)}" maxlength="16" placeholder="Your name"></div></div>
    <div class="card"><h3>Join a friend's game</h3>
      <div class="prow"><input type="text" id="jcode" value="${esc(joinCode)}" maxlength="8" placeholder="Room code" autocapitalize="characters" autocomplete="off" style="text-transform:uppercase"><button data-a="joinRoom">Join</button></div></div>
    <div class="card"><h3>Host a game</h3><p class="hint" style="margin-top:0">You choose the rules and send friends your room code. Keep this page open while you play, because your browser runs the game.</p>
      <button class="bigstart" data-a="hostRoom">Create a room</button></div>`;
}

function seatTag(st) {
  return st.kind === 'host' ? 'You (host)' : st.kind === 'remote' ? (st.away ? 'Disconnected' : '🟢 Online') : st.kind === 'local' ? 'On this device' : '🤖 Computer';
}

function hostLobbyHTML() {
  const s = ui.setup, seats = net.seats;
  const rows = seats.map((st, i) => {
    const editable = st.kind !== 'remote';
    return `<div class="prow">${editable
      ? `<select class="icon" id="sicon${i}">${tokenOptions(st.icon)}</select><input type="text" id="sname${i}" value="${esc(st.name)}" maxlength="16">`
      : `<span class="ic">${st.icon}</span><span class="nm">${esc(st.name)}</span>`}
      <span class="seat-tag">${seatTag(st)}</span>${st.kind === 'host' ? '' : `<button class="sm sec" data-a="rmSeat" data-i="${i}" title="Remove">✕</button>`}</div>`;
  }).join('');
  const opts = OPTS.map(([k, t, d]) => `
    <label class="opt"><input type="checkbox" id="o-${k}" ${s.opts[k] ? 'checked' : ''}><span>${t}<small>${d}</small></span></label>`).join('');
  return `
    <h1>🌐 Monopoly Online</h1>
    <div class="card invite"><h3>Room code — share it with your friends</h3>
      <div class="code">${esc(net.code)}</div>
      <div class="prow" style="justify-content:center"><button data-a="copycode">Copy code</button>${isWeb() ? '<button class="sec" data-a="copylink">Copy invite link</button>' : ''}</div>
      ${isWeb() ? '' : '<p class="hint">This page is open from a file on your computer, so friends need the web address where you put the game online, then this code. See HOW-TO-PLAY-ONLINE.txt.</p>'}</div>
    <div class="card"><h3>Players (${seats.length}/4)</h3>${rows}
      <div class="prow">${seats.length < 4 ? '<button class="sec" data-a="addBot">+ Computer player</button><button class="sec" data-a="addLocal">+ Another player on this device</button>' : ''}</div>
      <p class="hint">Friends appear here as soon as they join with your code.</p></div>
    <div class="card"><h3>Game style</h3>
      <div class="presets">${Object.keys(PRESETS).map(n => `<button class="sec" data-a="preset" data-n="${esc(n)}">${n}</button>`).join('')}</div></div>
    <div class="card"><h3>Rules</h3><div class="opts">${opts}</div>
      <div class="row2">
        <label>Starting cash<select id="o-startCash">${[500, 1000, 1500, 2000, 3000, 5000].map(v => `<option value="${v}" ${v === s.opts.startCash ? 'selected' : ''}>${money(v)}</option>`).join('')}</select></label>
        <label>Deal random properties at start<select id="o-dealProps">${[0, 2, 3, 5].map(v => `<option value="${v}" ${v === s.opts.dealProps ? 'selected' : ''}>${v ? v + ' each' : 'None (standard)'}</option>`).join('')}</select></label>
      </div>
      <div class="row2">${NUMS.map(([k, t, vals, f]) => `<label>${t}<select id="o-${k}">${vals.map(v => `<option value="${v}" ${v === s.opts[k] ? 'selected' : ''}>${f(v)}</option>`).join('')}</select></label>`).join('')}</div>
      <p class="hint">Free Parking options only apply when "Free Parking jackpot" is ticked.</p>
    </div>
    <button class="bigstart" data-a="startOnline" ${seats.length < 2 ? 'disabled' : ''}>${seats.length < 2 ? 'Waiting for at least one more player…' : `Start game (${seats.length} players)`}</button>
    <p class="hint" style="text-align:center"><button class="sm sec" data-a="leave">Close room</button></p>`;
}

function guestLobbyHTML() {
  const l = net.lobby || { seats: [], you: -1 };
  const rows = l.seats.map((st, i) => `<div class="prow"><span class="ic">${st.icon}</span><span class="nm">${esc(st.name)}${i === l.you ? ' <b>(you)</b>' : ''}</span><span class="seat-tag">${seatTag(st)}</span></div>`).join('');
  return `
    <h1>🌐 Monopoly Online</h1>
    <div class="card invite"><h3>You're in room</h3><div class="code">${esc(net.code)}</div>
      <p class="hint" style="text-align:center">${net.status === 'online' ? '🟢 Connected' : '🟠 Reconnecting…'}</p></div>
    <div class="card"><h3>Players</h3>${rows || '<div class="empty">Connecting…</div>'}
      <p class="hint">⏳ Waiting for the host to start the game. Keep this page open.</p></div>
    <p class="hint" style="text-align:center"><button class="sm sec" data-a="leave">Leave room</button></p>`;
}

function renderSetup(skipRead) {
  if (!skipRead && ui.screen === 'hostlobby' && net && $('#sname0')) { readSeats(); readOpts(); }
  let html;
  if (ui.screen === 'hostlobby' && net) html = hostLobbyHTML();
  else if (ui.screen === 'guestlobby' && net) html = guestLobbyHTML();
  else html = homeHTML();
  $('#setup').innerHTML = html;
  $('#setup').hidden = false; $('#game').hidden = true;
}

// --- host side
function makeHostPeer(code, retries, ok, fail) {
  let peer, opened = false;
  try { peer = new Peer(PEER_PREFIX + code, { debug: 0 }); } catch (e) { fail('error'); return; }
  peer.on('open', () => { opened = true; ok(peer); });
  peer.on('error', err => {
    if (opened) { console.warn('peer error', err); return; }
    try { peer.destroy(); } catch (e) { /* ignore */ }
    if (err.type === 'unavailable-id') {
      if (retries > 0) setTimeout(() => makeHostPeer(code, retries - 1, ok, fail), 1500); else fail('taken');
    } else fail('error');
  });
}

function wireHostPeer(peer) {
  peer.on('connection', conn => {
    conn.on('data', d => hostData(conn, parse(d)));
    conn.on('close', () => { if (net && net.role === 'host' && conn._cid && net.conns[conn._cid] === conn) hostDropped(conn._cid); });
  });
  peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { /* ignore */ } });
}

function hostRoom() {
  if (typeof Peer === 'undefined') { ui.msg = 'The online helper did not load. Check your internet connection and reload this page.'; renderSetup(); return; }
  const me = readMe();
  ui.msg = 'Creating your room…'; renderSetup();
  const attempt = n => {
    const code = newCode();
    makeHostPeer(code, 0, peer => {
      net = { role: 'host', code, peer, conns: {}, seats: [{ kind: 'host', name: me.name, icon: me.icon, cid: null }], started: false, queue: [], timers: {}, owner: [], mine: new Set() };
      ui.setup = { opts: Object.assign({}, G.DEFAULTS) };
      ui.screen = 'hostlobby'; ui.msg = '';
      wireHostPeer(peer);
      renderSetup();
    }, why => {
      if (why === 'taken' && n < 4) attempt(n + 1);
      else { ui.msg = 'Could not reach the matchmaking service to create a room. Check your internet connection and try again.'; renderSetup(); }
    });
  };
  attempt(0);
}

function resumeHost() {
  const sv = lsGet(HOST_KEY);
  if (!sv || !sv.g) return;
  if (typeof Peer === 'undefined') { ui.msg = 'The online helper did not load. Check your internet connection and reload.'; renderSetup(); return; }
  ui.msg = 'Reopening your room…'; renderSetup();
  makeHostPeer(sv.code, 8, peer => {
    g = sv.g; g.options = Object.assign({}, G.DEFAULTS, g.options);
    net = { role: 'host', code: sv.code, peer, conns: {}, seats: [], started: true, queue: [], timers: {}, owner: sv.owner, mine: new Set() };
    sv.owner.forEach((o, i) => { if (o && (o.kind === 'host' || o.kind === 'local')) net.mine.add(i); });
    wireHostPeer(peer);
    sv.owner.forEach((o, i) => {   // friends have a short time to rejoin, then the computer covers for them
      if (o && o.kind === 'remote' && !g.players[i].bankrupt) { g.players[i].away = true; net.timers[i] = setTimeout(() => takeover(i), AWAY_GRACE_MS * 1.5); }
    });
    ui.msg = ''; ui.seenCard = g.lastCard ? g.lastCard.seq : 0;
    enterGame();
    broadcast();
  }, () => { ui.msg = 'Could not reopen the room. Wait a few seconds and try again.'; renderSetup(); });
}

function sendLobbyAll() {
  const seats = net.seats.map(s => ({ name: s.name, icon: s.icon, kind: s.kind, away: !!s.away }));
  net.seats.forEach((st, i) => { if (st.kind === 'remote') sendTo(net.conns[st.cid], { t: 'lobby', seats, you: i }); });
}

function attachConn(cid, conn) {
  const old = net.conns[cid];
  conn._cid = cid; net.conns[cid] = conn;
  if (old && old !== conn) { try { old.close(); } catch (e) { /* ignore */ } }
}
function rejectConn(conn, reason) {
  sendTo(conn, { t: 'rejected', reason });
  setTimeout(() => { try { conn.close(); } catch (e) { /* ignore */ } }, 400);
}

function hostData(conn, m) {
  if (!m || !net || net.role !== 'host') return;
  if (m.t === 'join') { hostJoin(conn, m); return; }
  const cid = conn._cid;
  if (!cid || net.conns[cid] !== conn) return;
  if (m.t === 'act') { net.queue.push({ cid, as: m.as, msg: m.msg }); hostDrain(); }
  else if (m.t === 'leave') hostLeft(cid);
}

function hostJoin(conn, m) {
  const cid = String(m.cid || '').slice(0, 40);
  if (!cid) return;
  const name = String(m.name || '').trim().slice(0, 16) || 'Player';
  if (!net.started) {
    let i = net.seats.findIndex(s => s.cid === cid);
    if (i < 0) {
      if (net.seats.length >= 4) { rejectConn(conn, 'This room is full (4 players).'); return; }
      const taken = new Set(net.seats.map(s => s.icon));
      const icon = TOKENS.includes(m.icon) && !taken.has(m.icon) ? m.icon : TOKENS.find(t => !taken.has(t));
      net.seats.push({ kind: 'remote', cid, name, icon, away: false });
      i = net.seats.length - 1;
    }
    net.seats[i].away = false;
    attachConn(cid, conn);
    sendLobbyAll();
    if (ui.screen === 'hostlobby') renderSetup();
    return;
  }
  const pi = net.owner.findIndex(o => o && o.kind === 'remote' && o.cid === cid);
  if (pi < 0) { rejectConn(conn, 'That game has already started.'); return; }
  attachConn(cid, conn);
  clearTimeout(net.timers[pi]);
  const p = g.players[pi];
  if (p.away || p.bot) { p.away = false; p.bot = false; g.log.push(`${p.name} is back in the game.`); }
  sendTo(conn, { t: 'start', mine: [pi], g: pubG() });
  broadcast();
  if (!ui.busy) { renderAll(); scheduleBots(); }
}

function takeover(pi) {
  if (!net || net.role !== 'host' || !g) return;
  const p = g.players[pi];
  if (!p || p.bankrupt || p.bot) return;
  p.away = true; p.bot = true;
  g.log.push(`${p.name} left, so the computer is playing for them.`);
  broadcast();
  if (!ui.busy) { renderAll(); scheduleBots(); }
}

function hostDropped(cid) {
  if (!net.started) {
    const i = net.seats.findIndex(s => s.cid === cid);
    if (i >= 0) { net.seats.splice(i, 1); delete net.conns[cid]; sendLobbyAll(); if (ui.screen === 'hostlobby') renderSetup(); }
    return;
  }
  const pi = net.owner.findIndex(o => o && o.kind === 'remote' && o.cid === cid);
  if (pi < 0 || g.players[pi].bot) return;
  g.players[pi].away = true;
  g.log.push(`${g.players[pi].name} lost connection. Waiting for them to come back…`);
  clearTimeout(net.timers[pi]);
  net.timers[pi] = setTimeout(() => takeover(pi), AWAY_GRACE_MS);
  broadcast();
  if (!ui.busy) renderAll();
}

function hostLeft(cid) {
  if (!net.started) { hostDropped(cid); return; }
  const pi = net.owner.findIndex(o => o && o.kind === 'remote' && o.cid === cid);
  if (pi >= 0) { delete net.conns[cid]; takeover(pi); }
}

// Runs friends' actions through the real rules engine (one at a time, after any animation finishes).
function hostDrain() {
  while (net && net.role === 'host' && g && !ui.busy && net.queue.length) {
    const { cid, as, msg } = net.queue.shift();
    const o = net.owner[as];
    if (!o || o.kind !== 'remote' || o.cid !== cid) { sendTo(net.conns[cid], { t: 'err', msg: "That's not your player." }); continue; }
    const before = snap();
    let err;
    try { err = G.exec(g, as, msg); } catch (e) { err = 'Something went wrong with that move.'; }
    if (err) { sendTo(net.conns[cid], { t: 'err', msg: err }); continue; }
    save(); broadcast(); present(before);
  }
}

function hostStart() {
  readSeats(); readOpts();
  const seats = net.seats;
  if (seats.length < 2) { toast('You need at least 2 players'); return; }
  if (new Set(seats.map(s => s.icon)).size !== seats.length) { toast('Each player needs a different token'); return; }
  const defs = seats.map((s, i) => ({ name: s.name.trim() || `Player ${i + 1}`, bot: s.kind === 'bot', icon: s.icon }));
  g = G.create(defs, ui.setup.opts);
  // randomOrder may have shuffled the players, so match seats back up by token
  net.owner = g.players.map(p => { const s = seats.find(x => x.icon === p.icon); return { kind: s.kind, cid: s.cid || null }; });
  net.mine = new Set(); net.owner.forEach((o, i) => { if (o.kind === 'host' || o.kind === 'local') net.mine.add(i); });
  net.started = true; ui.seenCard = 0;
  Object.keys(net.conns).forEach(cid => {
    const pi = net.owner.findIndex(o => o.cid === cid);
    sendTo(net.conns[cid], { t: 'start', mine: pi >= 0 ? [pi] : [], g: pubG() });
  });
  save();
  enterGame();
}

function addSeat(kind) {
  readSeats();
  if (net.seats.length >= 4) return;
  const taken = new Set(net.seats.map(s => s.icon));
  const icon = TOKENS.find(t => !taken.has(t));
  const n = net.seats.filter(s => s.kind === kind).length + 1;
  net.seats.push({ kind, cid: null, icon, name: kind === 'bot' ? `Computer ${n}` : `Local ${n}` });
  sendLobbyAll(); renderSetup();
}
function removeSeat(i) {
  readSeats();
  const st = net.seats[i];
  if (!st || st.kind === 'host') return;
  if (st.kind === 'remote') { rejectConn(net.conns[st.cid], 'The host removed you from the room.'); delete net.conns[st.cid]; }
  net.seats.splice(i, 1);
  sendLobbyAll(); renderSetup();
}

// --- guest side
function joinRoom(saved) {
  if (typeof Peer === 'undefined') { ui.msg = 'The online helper did not load. Check your internet connection and reload this page.'; renderSetup(); return; }
  const me = readMe();
  const code = (saved ? saved.code : ($('#jcode') ? $('#jcode').value : '')).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length < 4) { toast('Type the room code your host gave you'); return; }
  net = { role: 'guest', code, cid: saved ? saved.cid : newCid(), peer: null, conn: null, mine: new Set(), lobby: null, started: false, queue: [], status: 'connecting', joined: false, left: false, retries: 0, name: me.name, icon: me.icon };
  ui.msg = `Connecting to room ${code}…`; ui.screen = 'home'; renderSetup();
  guestOpen();
}

function guestFail(msg, forget) {
  const n = net;
  if (n) { n.left = true; clearTimeout(n.retryTimer); try { n.peer && n.peer.destroy(); } catch (e) { /* ignore */ } }
  if (forget) lsDel(GUEST_KEY);
  net = null; g = null; ui.busy = false;
  ['#overlay', '#modal', '#cardpop'].forEach(s => { $(s).innerHTML = ''; }); $('#banner').className = '';
  ui.screen = 'home'; ui.msg = msg; render();
}

function guestOpen() {
  const n = net;
  if (!n || n.left || n.role !== 'guest') return;
  const start = () => {
    if (net !== n || n.left) return;
    let opened = false;
    const conn = n.peer.connect(PEER_PREFIX + n.code, { reliable: true });
    n.conn = conn;
    conn.on('open', () => { opened = true; n.status = 'online'; n.retries = 0; sendTo(conn, { t: 'join', cid: n.cid, name: n.name, icon: n.icon }); });
    conn.on('data', d => guestData(n, parse(d)));
    conn.on('close', () => { if (n.conn === conn) guestLost(n); });
    setTimeout(() => {
      if (opened || net !== n || n.conn !== conn) return;
      try { conn.close(); } catch (e) { /* ignore */ }
      if (n.joined) guestLost(n);
      else guestFail('Could not connect to that room. Check the code, and ask the host to keep their page open. If it keeps failing, try a different Wi-Fi or mobile data.');
    }, 15000);
  };
  if (!n.peer || n.peer.destroyed) {
    n.peer = new Peer({ debug: 0 });
    n.peer.on('open', start);
    n.peer.on('error', err => {
      if (net !== n || n.left) return;
      if (err.type === 'peer-unavailable') {
        if (!n.joined) guestFail(`Room "${n.code}" was not found. Check the code and make sure the host has their page open.`);
        else guestLost(n);
      } else if (!n.joined && err.type !== 'webrtc') guestFail('Could not reach the matchmaking service. Check your internet connection and try again.');
      else if (n.joined) guestLost(n);
    });
    n.peer.on('disconnected', () => { try { n.peer.reconnect(); } catch (e) { /* ignore */ } });
  } else start();
}

function guestLost(n) {
  if (net !== n || n.left || n.retryTimer) return;
  n.status = 'reconnecting'; n.retries++;
  if (n.retries > 40) { guestFail('Lost connection to the host.', false); return; }
  if (g) renderSide(); else if (ui.screen === 'guestlobby') renderSetup();
  n.retryTimer = setTimeout(() => { n.retryTimer = null; guestOpen(); }, 3000);
}

function guestData(n, m) {
  if (net !== n || !m) return;
  switch (m.t) {
    case 'lobby':
      n.joined = true; n.lobby = m; n.status = 'online';
      lsSet(GUEST_KEY, { code: n.code, cid: n.cid });
      if (!n.started) { ui.screen = 'guestlobby'; ui.msg = ''; renderSetup(); }
      break;
    case 'rejected': guestFail(m.reason || 'Could not join that room.', true); break;
    case 'start':
      n.joined = true; n.started = true; n.status = 'online'; n.mine = new Set(m.mine || []);
      lsSet(GUEST_KEY, { code: n.code, cid: n.cid });
      if (!g) { g = m.g; ui.seenCard = g.lastCard ? g.lastCard.seq : 0; enterGame(); } else applyState(m.g);
      break;
    case 'state': if (n.started) applyState(m.g); break;
    case 'err': toast(m.msg || 'Not allowed'); break;
    case 'closed': guestFail('The host ended the game.', true); break;
  }
}

function applyState(s) {
  if (ui.busy || !g) { net.queue.push(s); if (!g) netDrain(); return; }
  const before = snap();
  g = s;
  present(before);
}

function netDrain() {
  if (!net) return;
  if (net.role === 'host') { hostDrain(); return; }
  if (ui.busy || !net.queue.length) return;
  let s = net.queue.shift();
  if (!g) { g = s; ui.seenCard = g.lastCard ? g.lastCard.seq : 0; enterGame(); return; }
  while (net.queue.length) { g = s; s = net.queue.shift(); }   // if we fell behind, skip straight to the newest state
  const before = snap();
  g = s;
  present(before);
}

// Leave the room (host closing it ends the game for everyone).
function leaveToHome(msg) {
  const n = net;
  if (n) {
    n.left = true; clearTimeout(n.retryTimer);
    Object.values(n.timers || {}).forEach(clearTimeout);
    if (n.role === 'host') { Object.values(n.conns).forEach(c => sendTo(c, { t: 'closed' })); lsDel(HOST_KEY); }
    else { sendTo(n.conn, { t: 'leave' }); lsDel(GUEST_KEY); }
    setTimeout(() => { try { n.peer.destroy(); } catch (e) { /* ignore */ } }, 500);
  }
  clearTimeout(ui.timer);
  net = null; g = null; ui.busy = false; ui.overlayKey = ''; ui.modal = null;
  ['#overlay', '#modal', '#cardpop'].forEach(s => { $(s).innerHTML = ''; }); $('#banner').className = '';
  ui.screen = 'home'; ui.msg = msg || ''; render();
}

function enterGame() {
  ui.screen = 'game';
  ui.tab = null; ui.lastTurn = -1; ui.overlayKey = ''; ui.busy = false; ui.prevCash = null;
  $('#tokens').innerHTML = ''; $('#banner').className = ''; $('#cardpop').innerHTML = '';
  ui.pos = g.players.map(p => p.pos);
  renderAll();
  scheduleBots();
}

// ------------------------------------------------------------ actions & animation flow
function snap() {
  return { pos: g.players.map(p => p.pos), rollSeq: g.rollSeq, turn: g.turn };
}

function act(as, msg) {
  if (ui.busy) return false;
  if (net && !mine(as)) { toast("That isn't your player"); return false; }
  if (net && net.role === 'guest') {          // friends ask the host to run the move
    sendTo(net.conn, { t: 'act', as, msg });
    return true;
  }
  const before = snap();
  const err = G.exec(g, as, msg);
  if (err) { toast(err); return false; }
  save(); broadcast();
  present(before);
  return true;
}

function scheduleBots() {
  clearTimeout(ui.timer);
  if (!g || g.status !== 'playing' || ui.busy) return;
  if (!net || net.role !== 'host' || !net.started) return;   // only the host's browser runs computer players
  ui.timer = setTimeout(() => {
    if (ui.busy || !g) return;
    const before = snap();
    if (G.botStep(g)) { save(); broadcast(); present(before); }
  }, BOT_DELAY);
}

const BANNER_KINDS = new Set(['pay', 'owe', 'go', 'fp', 'jail', 'buy', 'bankrupt']);

// Plays back what the last engine action did: dice, pawn movement, card, then result banners.
async function present(before) {
  await presentInner(before);
  netDrain();   // run any friends' moves that arrived while we were animating
}

async function presentInner(before) {
  const evs = (g.ev || []).filter(e => BANNER_KINDS.has(e.k));
  const rolled = g.rollSeq !== before.rollSeq;
  const mover = g.players.findIndex((p, i) => p.pos !== before.pos[i]);
  if (!rolled && mover < 0 && !evs.length) {
    ui.pos = g.players.map(p => p.pos);
    renderAll();
    scheduleBots();
    return;
  }
  ui.busy = true;
  clearTimeout(ui.timer);
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
    if (g) {
      ui.pos = g.players.map(p => p.pos);
      renderAll();
      scheduleBots();
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
  const c = g.lastCard, el = $('#cardpop');
  ui.seenCard = c.seq;
  el.innerHTML = `<div class="card-pop ${c.deck}" data-a="closeCard"><h3>${c.deck === 'chance' ? 'Chance' : 'Community Chest'}</h3><p>${esc(c.text)}</p></div>`;
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
const OFFS = [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]];

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
    h += `<div class="${cls}" style="grid-row:${r};grid-column:${c}" data-a="deed" data-i="${i}">${inner}</div>`;
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
      const [ox, oy] = list.length > 1 ? OFFS[k] : [0, 0];
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
    switch (g.phase) {
      case 'roll':
        status = `${p.icon} ${esc(p.name)}'s turn${p.inJail ? `<small>In Jail (attempt ${p.jailTurns + 1}/3) — roll doubles, pay ${money(g.options.jailFine)}, or use a card</small>` : ''}`;
        if (human) {
          btns = `<button data-a="roll">🎲 ${p.inJail ? 'Roll for doubles' : 'Roll dice'} ${kbd('R')}</button>`;
          if (p.inJail) {
            btns += `<button class="sec" data-a="payJail" ${p.cash < g.options.jailFine ? 'disabled' : ''}>Pay ${money(g.options.jailFine)} ${kbd('J')}</button>`;
            if (p.jailCards.length) btns += `<button class="sec" data-a="useCard">Use Get Out of Jail card ${kbd('C')}</button>`;
          }
        }
        break;
      case 'buy': {
        const s = SP[g.buy.idx];
        status = `${esc(p.name)} landed on <b>${esc(s.name)}</b><small>Price ${money(s.price)} · you have ${money(p.cash)}</small>`;
        if (human) btns = `<button class="ok" data-a="buy" ${p.cash < s.price ? 'disabled' : ''}>Buy for ${money(s.price)} ${kbd('B')}</button><button class="sec" data-a="decline">${g.options.auction ? 'Auction it' : 'Pass'} ${kbd('A')}</button>`;
        break;
      }
      case 'tax': {
        const pct = G.incomeTaxPercent(g, g.turn);
        status = `${esc(p.name)} landed on <b>Income Tax</b><small>Pay a flat $200, or 10% of your total worth (cash + property + buildings) = ${money(pct)}</small>`;
        if (human) btns = `<button data-a="taxFlat">Pay $200</button><button class="sec" data-a="taxPercent">Pay 10% (${money(pct)})</button>`;
        break;
      }
      case 'post':
        status = g.rolledDoubles ? `${p.icon} ${esc(p.name)} rolled doubles — roll again!` : `${p.icon} ${esc(p.name)}<small>Manage properties or trade, then end your turn</small>`;
        if (human) btns = g.rolledDoubles ? `<button data-a="roll">🎲 Roll again ${kbd('R')}</button>` : `<button data-a="endTurn">End turn ➜ ${kbd('E')}</button>`;
        break;
      case 'debt': {
        const d = g.debt;
        const to = typeof d.creditor === 'number' ? g.players[d.creditor].name : d.creditor === 'each' ? 'the other players' : 'the bank';
        status = `${esc(p.name)} owes ${money(d.amt)} to ${esc(to)}<small>Has ${money(p.cash)}. Sell buildings or mortgage properties (right panel) — it pays automatically once you have enough.</small>`;
        if (human) btns = `<button class="danger" data-a="bankrupt">Declare bankruptcy</button>`;
        break;
      }
      case 'auction':
        status = `Auction for <b>${esc(SP[g.auction.idx].name)}</b>`;
        break;
      case 'over':
        status = `🏆 ${esc(g.players[g.winner].name)} wins!`;
        break;
    }
    if (g.status === 'playing' && g.phase !== 'auction') {
      if (p.bot) status += '<small>🤖 Computer is thinking…</small>';
      else if (!human) status += p.away ? `<small>⏳ ${esc(p.name)} lost connection. Waiting for them to come back…</small>` : `<small>⏳ Waiting for ${esc(p.name)}…</small>`;
    }
  }
  const pot = g.options.freeParking ? `<div class="pot">🅿️ Free Parking pot: ${money(g.pot)}</div>` : '';
  return `<div id="center">
    <div class="title">MONOPOLY</div>
    <div class="dicebox">${dieHTML(g.dice[0])}${dieHTML(g.dice[1])}</div>
    <div class="status">${status}</div>
    <div class="actions">${btns}</div>${pot}</div>`;
}

function sideHTML() {
  const players = g.players.map((p, i) => {
    const dots = G.owned(g, i).map(j => `<i class="${g.props[j].mortgaged ? 'm' : ''}" style="background:${GC[SP[j].group]}" data-a="deed" data-i="${j}" title="${esc(SP[j].name)}"></i>`).join('');
    const tags = [net && net.mine.has(i) ? 'YOU' : '', p.away ? 'AWAY' : p.bot ? 'BOT' : '', p.inJail ? 'JAIL' : '', p.jailCards.length ? `🎟️×${p.jailCards.length}` : '', p.bankrupt ? 'OUT' : ''].filter(Boolean).map(t => `<span class="tag">${t}</span>`).join('');
    const prev = ui.prevCash ? ui.prevCash[i] : null;
    const flash = prev == null || prev === p.cash ? '' : p.cash > prev ? 'up' : 'down';
    return `<div class="pl ${i === g.turn && !p.bankrupt && g.status === 'playing' ? 'turn' : ''} ${p.bankrupt ? 'out' : ''}" style="--c:${p.color}">
      <span class="ic">${p.icon}</span>
      <div class="mid"><div class="nm">${esc(p.name)}${tags}</div><div class="dots">${dots}</div></div>
      <div class="cash ${flash}" title="Net worth ${money(G.netWorth(g, i))}">${money(p.cash)}</div></div>`;
  }).join('');
  return `${roomHTML()}<div class="panel"><h4>Players <button class="sm sec" data-a="mute" title="Sound on/off">${sfx.muted ? '🔇' : '🔊'}</button></h4>${players}</div>${manageHTML()}
    <div class="panel"><h4>Game log <button class="sm sec" data-a="newgame">${net ? (net.role === 'host' ? 'End game' : 'Leave') : 'New game'}</button></h4><div id="log">${g.log.slice(-60).map(l => `<div>${esc(l)}</div>`).join('')}</div></div>`;
}

function roomHTML() {
  if (!net) return '';
  const st = net.role === 'guest' ? (net.status === 'online' ? '🟢 Connected to the host' : '🟠 Connection lost, reconnecting…') : '🟢 You are hosting. Keep this page open.';
  return `<div class="panel room"><h4>Room <b class="rc">${esc(net.code)}</b> <button class="sm sec" data-a="${isWeb() ? 'copylink' : 'copycode'}">${isWeb() ? 'Copy invite link' : 'Copy code'}</button></h4><div class="empty">${st}</div></div>`;
}

function renderSide() {
  const keep = $('#side').scrollTop;
  $('#side').innerHTML = sideHTML();
  $('#side').scrollTop = keep;
  ui.prevCash = g.players.map(p => p.cash);
  const log = $('#log'); if (log) log.scrollTop = log.scrollHeight;
}

function manageHTML() {
  const a = g.status === 'playing' ? (g.phase === 'auction' ? g.auction.cur : g.turn) : g.turn;
  let mp = ui.tab == null ? a : ui.tab;
  if (ui.tab == null && net && !mine(a)) {   // online: show my own properties by default
    const m = [...net.mine].find(i => !g.players[i].bankrupt);
    if (m != null) mp = m;
  }
  if (g.players[mp].bankrupt) mp = a;
  const p = g.players[mp];
  const tabs = G.alive(g).map(i => `<button class="sm sec ${i === mp ? 'on' : ''}" data-a="tab" data-p="${i}">${g.players[i].icon} ${esc(g.players[i].name)}</button>`).join('');
  const myProps = G.owned(g, mp);
  const canAct = !p.bot && g.status === 'playing' && !ui.busy && mine(mp);
  const rows = myProps.map(i => {
    const s = SP[i], pr = g.props[i];
    const btn = (type, label, cls) => {
      const err = G.manage(g, mp, type, i, true);
      return `<button class="sm ${cls || 'sec'}" data-a="mg" data-t="${type}" data-i="${i}" data-p="${mp}" ${err ? `disabled title="${esc(err)}"` : ''}>${label}</button>`;
    };
    let b = '';
    if (canAct) {
      if (s.type === 'prop' && G.ownsGroup(g, mp, s.group)) b += btn('build', `🏠 ${money(s.hc)}`, 'ok');
      if (pr.houses > 0) b += btn('sell', `Sell +${money(s.hc / 2)}`);
      if (pr.mortgaged) b += btn('unmortgage', `Unmortgage ${money(G.unmortgageCost(i))}`);
      else if (pr.houses === 0) b += btn('mortgage', `Mortgage +${money(G.mortgageValue(i))}`);
    }
    const hs = pr.houses === 5 ? ' 🏨' : pr.houses ? ' 🏠×' + pr.houses : '';
    return `<div class="mrow"><span class="sw" style="background:${GC[s.group]}" data-a="deed" data-i="${i}"></span>
      <span class="n ${pr.mortgaged ? 'm' : ''}">${esc(s.name)}${hs}</span><span class="btns">${b}</span></div>`;
  }).join('') || '<div class="empty">No properties yet.</div>';
  const others = G.alive(g).length > 1 && canAct && !g.trade && g.phase !== 'auction';
  return `<div class="panel"><h4>Properties ${others ? `<button class="sm" data-a="trade" data-p="${mp}">🤝 Propose trade</button>` : ''}</h4>
    <div class="tabs">${tabs}</div>${rows}
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

function sideText(s) {
  const parts = [];
  s.props.forEach(i => parts.push(esc(SP[i].name)));
  if (s.cash) parts.push(money(s.cash));
  if (s.cards) parts.push(`${s.cards} Get Out of Jail card${s.cards > 1 ? 's' : ''}`);
  return parts.join(', ') || 'nothing';
}

function renderOverlay() {
  const el = $('#overlay');
  let key = '', html = '';
  if (g.status === 'over') {
    key = 'over' + g.winner;
    const rank = g.players.map((p, i) => i).sort((a, b) => G.netWorth(g, b) - G.netWorth(g, a));
    html = `<div class="ov"><div class="dlg" style="text-align:center"><div style="font-size:60px">🏆</div><h2>${esc(g.players[g.winner].name)} wins!</h2>
      ${rank.map(i => `<div>${g.players[i].icon} ${esc(g.players[i].name)} — ${g.players[i].bankrupt ? 'bankrupt' : money(G.netWorth(g, i)) + ' net worth'}</div>`).join('')}
      <div class="btns" style="justify-content:center"><button data-a="newgame2">Back to menu</button></div></div></div>`;
  } else if (g.trade) {
    const t = g.trade, A = g.players[t.from], B = g.players[t.to];
    key = 'trade' + JSON.stringify(t);
    html = `<div class="ov"><div class="dlg"><h2>🤝 Trade offer</h2>
      <p><b>${A.icon} ${esc(A.name)}</b> gives: ${sideText(t.offer)}</p>
      <p><b>${B.icon} ${esc(B.name)}</b> gives: ${sideText(t.request)}</p>
      <div class="btns">${B.bot ? '<span class="empty">🤖 Waiting for the computer…</span>' : !mine(t.to) ? `<span class="empty">⏳ Waiting for ${esc(B.name)} to answer…</span>` : `<button class="ok" data-a="tAccept">${esc(B.name)}: Accept</button><button class="sec" data-a="tDecline">${esc(B.name)}: Decline</button>`}
      ${A.bot || !mine(t.from) ? '' : `<button class="sec" data-a="tCancel">Cancel offer</button>`}</div></div></div>`;
  } else if (g.phase === 'auction') {
    const a = g.auction, p = g.players[a.cur];
    key = 'auction' + JSON.stringify(a);
    const bidder = a.bidder >= 0 ? `${g.players[a.bidder].icon} ${esc(g.players[a.bidder].name)}` : 'no one yet';
    const quick = [10, 50, 100].map(k => `<button class="sec" data-a="bid" data-amt="${a.high + k}" ${a.high + k > p.cash ? 'disabled' : ''}>+${money(k)} → ${money(a.high + k)}</button>`).join('');
    html = `<div class="ov"><div class="dlg"><h2>🔨 Auction</h2>${deedHTML(a.idx)}
      <div class="big">Highest bid: ${money(a.high)}</div><div>Leader: ${bidder}</div>
      <p>Still in: ${a.active.map(i => g.players[i].icon).join(' ')} · <b>${p.icon} ${esc(p.name)}'s bid</b> (cash ${money(p.cash)})</p>
      ${p.bot ? '<div class="empty">🤖 Computer is deciding…</div>' : !mine(a.cur) ? `<div class="empty">⏳ Waiting for ${esc(p.name)} to bid or pass…</div>` : `<div class="bidbtns">${quick}</div>
      <div class="bidbtns"><input type="number" id="bidin" min="${a.high + 1}" max="${p.cash}" placeholder="Custom" value="${esc(ui.bid)}"><button data-a="bidc">Bid</button><button class="danger" data-a="pass">Pass</button></div>`}</div></div>`;
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
      <span class="sw" style="background:${GC[SP[i].group]}"></span>${esc(SP[i].name)}${g.props[i].mortgaged ? ' (M)' : ''}</label>`;
  }).join('') || '<div class="empty">No properties</div>';
  return `<div class="col"><h5>${p.icon} ${esc(p.name)} gives</h5>${props}
    <div class="field">Cash $<input type="number" min="0" max="${p.cash}" value="${s.cash || ''}" data-k="${key}" data-f="cash" placeholder="0"> <small>(has ${money(p.cash)})</small></div>
    ${p.jailCards.length ? `<div class="field">Jail cards <input type="number" min="0" max="${p.jailCards.length}" value="${s.cards || ''}" data-k="${key}" data-f="cards" placeholder="0"></div>` : ''}</div>`;
}

function renderModal() {
  const el = $('#modal');
  if (!ui.modal) { el.innerHTML = ''; return; }
  if (ui.modal === 'trade') {
    const t = ui.trade;
    const partners = G.alive(g).filter(i => i !== t.from).map(i => `<button class="sm ${i === t.to ? '' : 'sec'}" data-a="trTo" data-p="${i}">${g.players[i].icon} ${esc(g.players[i].name)}</button>`).join(' ');
    el.innerHTML = `<div class="ov"><div class="dlg" style="width:min(760px,100%)"><h2>🤝 New trade</h2>
      <div style="margin-bottom:10px">Trade with: ${partners}</div>
      <div class="cols">${tradeSideHTML(t.from, 'offer')}${tradeSideHTML(t.to, 'request')}</div>
      <p class="empty">Properties in a colour set with buildings can't be traded. Mortgaged properties cost the receiver a 10% fee.</p>
      <div class="btns"><button data-a="trSend">Send offer</button><button class="sec" data-a="closeModal">Cancel</button></div></div></div>`;
  } else if (ui.modal && ui.modal.deed != null) {
    el.innerHTML = `<div class="ov" data-a="closeModal"><div class="dlg" style="width:340px">${deedHTML(ui.modal.deed)}<div class="btns" style="justify-content:center"><button class="sec" data-a="closeModal">Close</button></div></div></div>`;
  }
}

// Fallback for a card that wasn't shown during an animation (e.g. after resuming a save).
function showCard() {
  if (!g.lastCard || g.lastCard.seq === ui.seenCard) return;
  ui.seenCard = g.lastCard.seq;
}

function renderAll(skipOverlay) {
  $('#setup').hidden = true; $('#game').hidden = false;
  if (ui.lastTurn !== g.turn) { ui.lastTurn = g.turn; ui.tab = null; ui.bid = ''; }
  renderCells(); updateTokens(); renderSide();
  if (!skipOverlay) { renderOverlay(); showCard(); }
}

function render() {
  if (ui.busy) return;
  if (!g) { renderSetup(); return; }
  ui.pos = g.players.map(p => p.pos);
  renderAll();
}

// ------------------------------------------------------------ events
document.addEventListener('click', e => {
  const el = e.target.closest('[data-a]');
  if (!el) {
    if (e.target.closest('#banner') && ui.wake) ui.wake();
    return;
  }
  const d = el.dataset, a = d.a;
  if (a === 'closeModal') { if (el.classList.contains('ov') && e.target !== el) return; ui.modal = null; renderModal(); return; }
  if (a === 'closeCard') { if (ui.wake) ui.wake(); else $('#cardpop').innerHTML = ''; return; }
  // lobby / menu buttons
  switch (a) {
    case 'hostRoom': hostRoom(); return;
    case 'joinRoom': joinRoom(); return;
    case 'rejoin': { const gs = lsGet(GUEST_KEY); if (gs) joinRoom(gs); return; }
    case 'dropGuest': lsDel(GUEST_KEY); renderSetup(); return;
    case 'resumeHost': resumeHost(); return;
    case 'dropHost': lsDel(HOST_KEY); renderSetup(); return;
    case 'addBot': addSeat('bot'); return;
    case 'addLocal': addSeat('local'); return;
    case 'rmSeat': removeSeat(+d.i); return;
    case 'startOnline': hostStart(); return;
    case 'preset': readSeats(); readOpts(); Object.assign(ui.setup.opts, PRESETS[d.n]); renderSetup(true); return;
    case 'leave':
      if (net && net.role === 'host' && !confirm('Close the room? Everyone will be disconnected.')) return;
      leaveToHome(); return;
    case 'copycode': case 'copylink': {
      if (!net) return;
      const text = a === 'copylink' ? inviteUrl() : net.code;
      const done = () => toast(a === 'copylink' ? 'Invite link copied!' : `Room code ${net.code} copied!`);
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => prompt('Copy this:', text));
      else prompt('Copy this:', text);
      return;
    }
  }
  if (!g) return;
  switch (a) {
    case 'roll': case 'endTurn': case 'buy': case 'decline': case 'payJail': case 'useCard': case 'taxFlat': case 'taxPercent':
      act(g.turn, { type: a }); break;
    case 'bankrupt':
      if (confirm(`${g.players[g.turn].name} will be eliminated. Continue?`)) act(g.turn, { type: 'bankrupt' });
      break;
    case 'bid': act(g.auction.cur, { type: 'bid', amount: +d.amt }); break;
    case 'bidc': act(g.auction.cur, { type: 'bid', amount: +$('#bidin').value }); break;
    case 'pass': act(g.auction.cur, { type: 'pass' }); break;
    case 'mg': act(+d.p, { type: d.t, idx: +d.i }); break;
    case 'tab': ui.tab = +d.p; renderSide(); break;
    case 'mute': sfx.toggle(); renderSide(); break;
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
    case 'newgame':
      if (g.status === 'playing' && !confirm(net.role === 'host' ? 'End the game for everyone and close the room?' : 'Leave this game? The computer will take over your player.')) return;
      leaveToHome();
      break;
    case 'newgame2':
      leaveToHome();
      break;
  }
});

document.addEventListener('change', e => {
  const el = e.target;
  if (!ui.trade || ui.modal !== 'trade' || !el.dataset.k) return;
  const side = ui.trade[el.dataset.k];
  if (el.dataset.i != null) {
    const i = +el.dataset.i;
    side.props = el.checked ? side.props.concat(i) : side.props.filter(x => x !== i);
  } else {
    side[el.dataset.f] = Math.max(0, Math.floor(+el.value || 0));
  }
});

document.addEventListener('input', e => {
  if (e.target.id === 'bidin') ui.bid = e.target.value;
});
// Keyboard shortcuts: R roll, B buy, A auction (or pass), E end turn, J pay jail fine, C jail card.
const KEYS = { r: 'roll', b: 'buy', a: 'decline', e: 'endTurn', j: 'payJail', c: 'useCard' };
document.addEventListener('keydown', e => {
  const act_ = KEYS[e.key.toLowerCase()];
  if (!act_ || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  if (!g || ui.busy || ui.modal || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
  const btn = document.querySelector(`#center .actions [data-a="${act_}"]`);
  if (btn && !btn.disabled) { e.preventDefault(); btn.click(); }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.id === 'bidin') { e.preventDefault(); act(g.auction.cur, { type: 'bid', amount: +e.target.value }); }
  if (e.key === 'Escape' && ui.modal) { ui.modal = null; renderModal(); }
});

initSetup();
render();
window.__mono = { get g() { return g; }, get net() { return net; }, ui, G, sfx, render };
})();
