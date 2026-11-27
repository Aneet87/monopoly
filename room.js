/* ROOMS: the game menu, the lobby, joining and rejoining, pause/resume, computer players,
   emoji reactions and the night's scoreboard. Shared by every game.

   The HOST's browser is the referee. It keeps `H.room`, runs each game's rules, and sends every device a
   "snapshot". The host draws its own screen from the same kind of snapshot, so everyone sees the same thing.

   A game is an object registered with Core.register():
     id, name, emoji, blurb, min, max, levels (true if computer skill matters), rules [text], options [..]
     create(players, options) -> state      (state needs: seq, over, winners [seat numbers], log [])
     turn(state) -> seat number whose move it is
     exec(state, seat, move) -> error text, or null
     canMove(state, seat) -> (optional) true if that seat may move now, for steps everyone does at once
     step(state) -> (optional, instead of bot) let one computer player do something; true if it did
     sync(state, seats) -> (optional) told which seats the computer is playing
     shuffle(options) -> (optional) true to mix up the seating order
     presets, foldOptions, resultHTML(state), ownSide (the game draws its own player list and log)
     bot(state, seat, level) -> move
     view(state, seats) -> what those seats are allowed to see (hides secret cards, ships...)
     mount(element, api) -> { reset(state), update(state) (may animate, returns a promise), refresh(), destroy() }
*/
(() => {
'use strict';
const { $, esc, lsGet, lsSet, lsDel, toast, sfx } = Core;

const HOST_KEY = 'gn-host-v1', GUEST_KEY = 'gn-guest-v1', PREF_KEY = 'gn-prefs-v1';
const MAX_ROOM = 8;
const AWAY_GRACE_MS = 20000;   // how long a dropped player has before the computer covers for them
const LOBBY_GRACE_MS = 60000;  // how long a dropped player keeps their place in the lobby
const BOT_DELAY = 900;
const ICONS = ['🦊', '🐼', '🐸', '🦁', '🐙', '🦄', '🐧', '🐯', '🦖', '🐝', '🚀', '⭐'];
const COLORS = ['#ff4d6d', '#3d8bfd', '#2fbf71', '#ffb020', '#a45cf0', '#12b8c9', '#ff7ac3', '#8b6b4a'];
const REACTIONS = ['👏', '😂', '😮', '😭', '🎉', '🔥', '👍', '🐢'];
const LEVELS = [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']];
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const randomFrom = (chars, n) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

let H = null;   // host only: { code, link, chans: {cid: channel}, room, timers: {}, botTimer }
let J = null;   // guest only: { code, cid, link, ch, joined, retries, retryTimer, name, icon, status }
let S = null;   // the latest snapshot this screen has drawn
const ui = { screen: 'home', msg: '', test: '', picked: null, queue: [], pumping: false, view: null, viewKey: '', claims: null, resultKey: '', lastTurnKey: '', lastReact: 0 };

// ---------------------------------------------------------------- player preferences
function prefs() { return Object.assign({ name: '', icon: ICONS[Math.floor(Math.random() * ICONS.length)] }, lsGet(PREF_KEY)); }
function readMe() {
  const n = $('#myname'), ic = $('#myicon');
  if (!n) return prefs();
  const v = { name: n.value.trim().slice(0, 14) || 'Player', icon: ic.value };
  lsSet(PREF_KEY, v);
  return v;
}
const iconOptions = sel => ICONS.map(t => `<option ${t === sel ? 'selected' : ''}>${t}</option>`).join('');

// ================================================================ HOST
const member = id => H.room.roster.find(m => m.id === id);
const memberByCid = cid => H.room.roster.find(m => m.cid === cid);
const freeIcon = want => {
  const taken = new Set(H.room.roster.map(m => m.icon));
  return ICONS.includes(want) && !taken.has(want) ? want : ICONS.find(i => !taken.has(i));
};
const freeColor = () => { const taken = new Set(H.room.roster.map(m => m.color)); return COLORS.find(c => !taken.has(c)) || COLORS[0]; };

function addMember(kind, name, icon, cid) {
  if (H.room.roster.length >= MAX_ROOM) return null;
  const m = { id: newId(), kind, cid: cid || null, name, icon: freeIcon(icon), color: freeColor(), level: 'medium', away: false, covering: false, wins: 0, played: 0 };
  H.room.roster.push(m);
  return m;
}
function defaultOptions(game) {
  const o = {};
  (game.options || []).forEach(d => { o[d.key] = d.default; });
  return o;
}
const optionsFor = id => Object.assign(defaultOptions(Core.game(id)), H.room.opts[id]);

// Who would play if the host pressed Start now: connected people and computers, in list order, up to the game's limit.
const lineup = () => H.room.roster.filter(m => !m.away).slice(0, Core.game(H.room.gameId).max);

const matchSeatOf = id => (H.room.match ? H.room.match.seats.indexOf(id) : -1);
const waitingFor = () => {
  const mt = H.room.match;
  return mt ? mt.seats.map(member).filter(m => m && m.kind === 'remote' && m.away && !m.covering) : [];
};
const claimable = () => {
  const mt = H.room.match;
  return mt && !mt.state.over ? mt.seats.map(member).filter(m => m && m.kind === 'remote' && (m.away || m.covering)) : [];
};

function snapshot(mineIds) {
  const r = H.room, mt = r.match;
  let match = null;
  if (mt) {
    const seats = mt.seats.map((id, i) => (mineIds.includes(id) ? i : -1)).filter(i => i >= 0);
    const game = Core.game(mt.gameId);
    match = { n: mt.n, gameId: mt.gameId, seats: mt.seats, hold: mt.hold, mySeats: seats, turn: game.turn(mt.state), state: game.view(mt.state, seats) };
  }
  return {
    code: H.code, gameId: r.gameId, opts: optionsFor(r.gameId), mine: mineIds, match,
    roster: r.roster.map(({ id, kind, name, icon, color, level, away, covering, wins, played }) => ({ id, kind, name, icon, color, level, away, covering, wins, played })),
  };
}
const hostMine = () => H.room.roster.filter(m => m.kind === 'host' || m.kind === 'local').map(m => m.id);

// Let a game know which seats the computer is playing right now.
function syncSeats() {
  const mt = H && H.room.match;
  if (!mt) return;
  const game = Core.game(mt.gameId);
  if (game.sync) game.sync(mt.state, mt.seats.map(member));
}

// Send everyone the latest picture (each device only gets what it is allowed to see) and save the room.
function publish() {
  if (!H) return;
  syncSeats();
  H.room.roster.forEach(m => { if (m.kind === 'remote' && H.chans[m.cid]) H.chans[m.cid].send({ t: 'snap', s: snapshot([m.id]) }); });
  lsSet(HOST_KEY, { code: H.code, room: H.room });
  receive(JSON.parse(JSON.stringify(snapshot(hostMine()))));
}

function openRoom(code, room) {
  const mine = { code, room, chans: {}, timers: {}, botTimer: null, link: null };
  return Link.host(code, {
    data: (ch, m) => { if (H === mine) hostData(ch, m); },
    closed: ch => { if (H === mine && ch.cid && H.chans[ch.cid] === ch) hostDropped(ch.cid); },
  }).then(link => { mine.link = link; H = mine; return mine; });
}

function createRoom(gameId) {
  if (!Link.available()) { ui.msg = 'The online helper did not load. Check your internet connection and reload this page.'; renderMenu(); return; }
  if (ui.creating) return;
  const me = readMe();
  ui.creating = true; ui.msg = 'Creating your room…'; renderMenu();
  const attempt = n => {
    const room = { gameId, opts: {}, roster: [], match: null, matches: 0 };
    openRoom(randomFrom(CODE_CHARS, 5), room).then(() => {
      ui.creating = false; ui.msg = '';
      addMember('host', me.name, me.icon);
      publish();
    }, why => {
      if (why === 'taken' && n < 4) attempt(n + 1);
      else { ui.creating = false; ui.msg = why === 'taken' ? 'Could not create a room. Please try again.' : Link.explain(why); renderMenu(); }
    });
  };
  attempt(0);
}

function resumeRoom() {
  const sv = lsGet(HOST_KEY);
  if (!sv || !sv.room || ui.creating) return;
  if (!Link.available()) { ui.msg = 'The online helper did not load. Check your internet connection and reload.'; renderMenu(); return; }
  ui.creating = true; ui.msg = 'Reopening your room…'; renderMenu();
  openRoom(sv.code, sv.room).then(() => {
    ui.creating = false; ui.msg = '';
    H.room.roster.forEach(m => { if (m.kind === 'remote') { m.away = true; m.covering = false; } });
    const mt = H.room.match;
    if (mt) {
      if (!Core.game(mt.gameId)) H.room.match = null;
      else mt.hold = !mt.state.over && waitingFor().length > 0;
    }
    H.room.roster.forEach(m => { if (m.kind === 'remote' && matchSeatOf(m.id) < 0) startLobbyTimer(m); });
    publish();
  }, why => { ui.creating = false; ui.msg = why === 'taken' ? 'Could not reopen that room code. Discard the saved night and start a new one.' : Link.explain(why); renderMenu(); });
}

function startLobbyTimer(m) {
  clearTimeout(H.timers[m.id]);
  H.timers[m.id] = setTimeout(() => {
    if (!H || !m.away || matchSeatOf(m.id) >= 0) return;
    H.room.roster = H.room.roster.filter(x => x !== m);
    publish();
  }, LOBBY_GRACE_MS);
}

function attach(cid, ch) {
  const old = H.chans[cid];
  ch.cid = cid; H.chans[cid] = ch;
  if (old && old !== ch) old.close();
}
function reject(ch, reason) {
  ch.send({ t: 'rejected', reason });
  setTimeout(() => ch.close(), 500);
}

function hostData(ch, m) {
  if (m.t === 'join') { hostJoin(ch, m); return; }
  const cid = ch.cid || String(m.cid || '').slice(0, 40);
  if (m.t === 'claim') {
    const target = claimable().find(x => x.id === m.id);
    if (!cid || !target) { reject(ch, 'That player is no longer available.'); return; }
    target.cid = cid;
    welcomeBack(ch, target);
    return;
  }
  if (m.t === 'newcomer') { addNewcomer(ch, cid, m); return; }
  if (!ch.cid || H.chans[ch.cid] !== ch) return;
  const who = memberByCid(ch.cid);
  if (!who) return;
  if (m.t === 'move') {
    const err = who.id === (H.room.match && H.room.match.seats[m.seat]) ? hostMove(m.seat, m.move) : "That's not your player.";
    if (err) ch.send({ t: 'err', msg: err });
  } else if (m.t === 'react') relayReaction(who, m.e);
  else if (m.t === 'leave') hostLeft(who);
}

function hostJoin(ch, m) {
  const cid = String(m.cid || '').slice(0, 40);
  if (!cid) return;
  const known = memberByCid(cid);
  if (known) { welcomeBack(ch, known); return; }
  const open = claimable();
  if (open.length) {   // a new device during a game: maybe one of the absent players
    ch.send({ t: 'claimlist', seats: open.map(x => ({ id: x.id, name: x.name, icon: x.icon })) });
    return;
  }
  addNewcomer(ch, cid, m);
}

function addNewcomer(ch, cid, m) {
  if (!cid) return;
  if (memberByCid(cid)) { welcomeBack(ch, memberByCid(cid)); return; }
  const name = String(m.name || '').trim().slice(0, 14) || 'Player';
  const who = addMember('remote', name, m.icon, cid);
  if (!who) { reject(ch, `This room is full (${MAX_ROOM} people).`); return; }
  attach(cid, ch);
  sfx.pop();
  publish();
}

function welcomeBack(ch, who) {
  attach(who.cid, ch);
  clearTimeout(H.timers[who.id]);
  const mt = H.room.match;
  if (mt && (who.away || who.covering) && matchSeatOf(who.id) >= 0) mt.state.log.push(`${who.name} is back.`);
  who.away = false; who.covering = false;
  if (mt && mt.hold && !waitingFor().length) mt.hold = false;
  publish();
}

function cover(who) {
  const mt = H && H.room.match;
  if (!mt || who.covering || matchSeatOf(who.id) < 0) return;
  who.away = true; who.covering = true;
  mt.state.log.push(`${who.name} is away, so the computer is playing for them.`);
  if (mt.hold && !waitingFor().length) mt.hold = false;
  publish();
}

function hostDropped(cid) {
  delete H.chans[cid];
  const who = memberByCid(cid);
  if (!who) return;
  who.away = true;
  if (matchSeatOf(who.id) >= 0 && !H.room.match.state.over) {
    clearTimeout(H.timers[who.id]);
    const room = H;
    H.timers[who.id] = setTimeout(() => { if (H === room && who.away) cover(who); }, AWAY_GRACE_MS);
  } else startLobbyTimer(who);
  publish();
}

function hostLeft(who) {
  const ch = H.chans[who.cid];
  delete H.chans[who.cid];
  if (ch) setTimeout(() => ch.close(), 300);
  if (matchSeatOf(who.id) >= 0 && !H.room.match.state.over) cover(who);
  else { H.room.roster = H.room.roster.filter(x => x !== who); publish(); }
}

// ---------------------------------------------------------------- running a game
function startMatch() {
  const game = Core.game(H.room.gameId), players = lineup();
  if (players.length < game.min) { toast(`${game.name} needs at least ${game.min} players`); return; }
  if (game.shuffle && game.shuffle(optionsFor(game.id))) {
    for (let i = players.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [players[i], players[j]] = [players[j], players[i]]; }
  }
  const state = game.create(players.map(({ name, icon, color }) => ({ name, icon, color })), optionsFor(game.id));
  H.room.matches++;
  H.room.roster.forEach(m => { m.covering = false; });
  H.room.match = { n: H.room.matches, gameId: game.id, seats: players.map(m => m.id), state, hold: false, counted: false };
  publish();
}

function hostMove(seat, move) {
  const mt = H && H.room.match;
  if (!mt) return 'No game is running.';
  if (mt.hold) return 'The game is on hold until everyone has rejoined.';
  syncSeats();
  let err;
  try { err = Core.game(mt.gameId).exec(mt.state, seat, move); } catch (e) { console.error(e); err = 'Something went wrong with that move.'; }
  if (err) return err;
  settleMatch(mt);
  return null;
}

// After any change: keep score if the game just ended, then show everyone.
function settleMatch(mt) {
  if (mt.state.over && !mt.counted) {
    mt.counted = true;
    mt.seats.forEach((id, i) => { const m = member(id); if (m) { m.played++; if (mt.state.winners.includes(i)) m.wins++; } });
  }
  publish();
}

// Computer players (and cover for absent friends). Waits until the host's own animation has finished.
function scheduleBot() {
  if (!H) return;
  clearTimeout(H.botTimer);
  const mt = H.room.match;
  if (!mt || mt.hold || mt.state.over || ui.pumping) return;
  const game = Core.game(mt.gameId);
  if (game.step) {   // this game decides for itself which computer player acts next
    if (!mt.seats.some(id => { const m = member(id); return !m || m.kind === 'bot' || m.covering; })) return;
    const room = H;
    H.botTimer = setTimeout(() => {
      if (H !== room || H.room.match !== mt || ui.pumping || mt.hold) return;
      syncSeats();
      try { if (game.step(mt.state)) settleMatch(mt); } catch (e) { console.error(e); }
    }, BOT_DELAY);
    return;
  }
  const seat = game.turn(mt.state), who = member(mt.seats[seat]);
  if (who && who.kind !== 'bot' && !who.covering) return;
  const room = H;
  H.botTimer = setTimeout(() => {
    if (H !== room || H.room.match !== mt || ui.pumping || mt.hold) return;
    const err = hostMove(seat, game.bot(mt.state, seat, who && who.kind === 'bot' ? who.level : 'medium'));
    if (err) console.warn('computer move refused:', err);
  }, BOT_DELAY);
}

function backToLobby() {
  clearTimeout(H.botTimer);
  H.room.match = null;
  // anyone the computer was covering who never came back loses their place after a short wait
  H.room.roster.forEach(m => { m.covering = false; if (m.kind === 'remote' && !H.chans[m.cid]) { m.away = true; startLobbyTimer(m); } });
  publish();
}

// ---------------------------------------------------------------- reactions
function relayReaction(who, e) {
  if (!REACTIONS.includes(e)) return;
  const now = Date.now();
  if (now - (who.reactedAt || 0) < 700) return;
  who.reactedAt = now;
  const msg = { t: 'react', e, name: who.name, color: who.color };
  Object.values(H.chans).forEach(c => c.send(msg));
  showReaction(msg);
}
function react(e) {
  if (H) relayReaction(member(hostMine()[0]), e);
  else if (J && J.ch) J.ch.send({ t: 'react', e });
}
function showReaction(m) {
  const el = document.createElement('div');
  el.className = 'floater';
  el.style.left = (8 + Math.random() * 74) + '%';
  el.innerHTML = `<span>${esc(m.e)}</span><small style="--c:${esc(m.color)}">${esc(m.name)}</small>`;
  $('#reactions').appendChild(el);
  sfx.pop();
  setTimeout(() => el.remove(), 2600);
}

// ================================================================ GUEST
function joinRoom(saved) {
  if (!Link.available()) { ui.msg = 'The online helper did not load. Check your internet connection and reload this page.'; renderMenu(); return; }
  const me = readMe();
  const code = (saved ? saved.code : ($('#jcode') ? $('#jcode').value : '')).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length < 4) { toast('Type the room code your host gave you'); return; }
  if (J) J.link.close();
  J = { code, cid: saved ? saved.cid : newId(), name: me.name, icon: me.icon, joined: false, retries: 0, status: 'connecting', ch: null, link: null };
  ui.msg = `Connecting to room ${code}…`; ui.screen = 'home'; renderMenu();
  guestConnect(J);
}

function guestConnect(n) {
  n.link = Link.join(n.code, {
    open: ch => { if (J !== n) return; n.ch = ch; n.status = 'online'; n.retries = 0; ch.send({ t: 'join', cid: n.cid, name: n.name, icon: n.icon }); },
    data: m => guestData(n, m),
    lost: () => guestLost(n),
    fail: reason => {
      if (J !== n) return;
      if (n.joined) { guestLost(n); return; }
      goHome(reason === 'notfound' ? `Room "${n.code}" was not found. Check the code and make sure the host has the game open.` : Link.explain(reason));
    },
  });
}

function guestLost(n) {
  if (J !== n || n.retryTimer) return;
  n.ch = null; n.status = 'reconnecting';
  if (++n.retries > 20) { goHome('Lost the connection to the host. Use "Rejoin" to try again.'); return; }
  if (S) renderChrome();
  n.retryTimer = setTimeout(() => { n.retryTimer = null; if (J === n) guestConnect(n); }, Math.min(3000 * n.retries, 30000));
}

function guestData(n, m) {
  if (J !== n) return;
  if (m.t === 'snap') {
    n.joined = true; n.status = 'online';
    lsSet(GUEST_KEY, { code: n.code, cid: n.cid });
    receive(m.s);
  } else if (m.t === 'claimlist') { n.joined = true; ui.claims = m.seats; ui.screen = 'claim'; ui.msg = ''; renderMenu(); }
  else if (m.t === 'rejected') { lsDel(GUEST_KEY); goHome(m.reason || 'Could not join that room.'); }
  else if (m.t === 'err') toast(m.msg || 'Not allowed');
  else if (m.t === 'react') showReaction(m);
  else if (m.t === 'paused') goHome('⏸ The host paused the night and saved it. When they are ready, open this page and tap "Rejoin".');
  else if (m.t === 'closed') { lsDel(GUEST_KEY); goHome('The host closed the room.'); }
}

// ================================================================ leaving
function goHome(msg) {
  if (H) { clearTimeout(H.botTimer); Object.values(H.timers).forEach(clearTimeout); const link = H.link; setTimeout(() => link.close(), 500); H = null; }
  if (J) { clearTimeout(J.retryTimer); if (J.link) J.link.close(); J = null; }
  S = null; ui.queue = []; ui.claims = null; ui.screen = 'home'; ui.msg = msg || ''; ui.resultKey = '';
  destroyView();
  $('#modal').innerHTML = '';
  renderMenu();
}

function pauseRoom() {
  lsSet(HOST_KEY, { code: H.code, room: H.room });
  Object.values(H.chans).forEach(c => c.send({ t: 'paused' }));
  goHome('⏸ Saved. Come back on this same device and browser, then tap "Resume hosting".');
}
function closeRoom() {
  if (!confirm('Close the room for everyone? The scoreboard and any game in progress will be erased.')) return;
  Object.values(H.chans).forEach(c => c.send({ t: 'closed' }));
  lsDel(HOST_KEY);
  goHome('Room closed.');
}
function leaveRoom() {
  if (J.ch) J.ch.send({ t: 'leave' });
  const midGame = S && S.match && S.match.mySeats.length && !S.match.state.over;
  if (!midGame) lsDel(GUEST_KEY);
  goHome(midGame ? 'You left. Tap "Rejoin" any time to get your player back.' : '');
}

// ================================================================ SCREEN
function destroyView() {
  if (ui.view) { try { ui.view.destroy(); } catch (e) { console.error(e); } }
  ui.view = null; ui.viewKey = '';
  $('#stage').innerHTML = ''; $('#gameside').innerHTML = '';
}

// Snapshots are drawn one at a time so that each animation finishes before the next one starts.
function receive(s) {
  ui.queue.push(s);
  pump();
}
async function pump() {
  if (ui.pumping) return;
  ui.pumping = true;
  while (ui.queue.length) {
    const behind = ui.queue.length > 3;
    const s = ui.queue.shift();
    try { await draw(s, behind); } catch (e) { console.error(e); }
  }
  ui.pumping = false;
  if (S) { renderChrome(); showResult(); }
  scheduleBot();
}

async function draw(s, skipAnimation) {
  if (!H && !J) return;
  S = s;
  if (!s.match) {
    destroyView();
    ui.screen = 'lobby'; $('#modal').innerHTML = ''; ui.resultKey = '';
    renderMenu();
    return;
  }
  ui.screen = 'game';
  $('#menu').hidden = true; $('#play').hidden = false;
  const key = `${s.code}:${s.match.n}`;
  const game = Core.game(s.match.gameId);
  if (!game) { toast('Refresh this page to get the newest version of the site.'); return; }
  if (ui.viewKey !== key) {
    destroyView();
    $('#modal').innerHTML = '';
    ui.viewKey = key;
    ui.view = game.mount($('#stage'), api);
    ui.view.reset(s.match.state);
    ui.seenSeq = s.match.state.seq;
    renderChrome();
    return;
  }
  renderTop();
  if (s.match.state.seq !== ui.seenSeq) {
    ui.seenSeq = s.match.state.seq;
    if (skipAnimation) ui.view.reset(s.match.state);
    else await ui.view.update(s.match.state);
  }
  renderChrome();
}

// What a game's screen is allowed to ask the room.
const api = {
  get side() { return $('#gameside'); },
  get hold() { return !!(S && S.match && S.match.hold); },
  get isHost() { return !!H; },
  get mySeats() { return S && S.match ? S.match.mySeats : []; },
  get turn() { return S && S.match ? S.match.turn : -1; },
  // true when this device should be offered a move for that seat right now (default: whoever's turn it is)
  canAct(seat) {
    if (!S || !S.match || ui.queue.length || S.match.hold || S.match.state.over) return false;
    if (J && J.status !== 'online') return false;
    const i = seat === undefined ? S.match.turn : seat, game = Core.game(S.match.gameId);
    const may = game.canMove ? game.canMove(S.match.state, i) : i === S.match.turn;
    const m = S.roster.find(x => x.id === S.match.seats[i]);
    return may && S.match.mySeats.includes(i) && !!m && !m.covering;
  },
  move(move, seat) {
    const i = seat === undefined ? (S && S.match ? S.match.turn : -1) : seat;
    if (!api.canAct(i)) return false;
    if (H) { const err = hostMove(i, move); if (err) { toast(err); return false; } return true; }
    if (J.ch) { J.ch.send({ t: 'move', seat: i, move }); return true; }
    return false;
  },
};

const memberTag = m => m.kind === 'bot' ? '🤖 Computer' : m.covering ? '🤖 Covering' : m.away ? '🔌 Away' : m.kind === 'host' ? '👑 Host' : m.kind === 'local' ? 'On host device' : '🟢 Online';

function renderTop() {
  const bar = $('#topbar');
  bar.innerHTML = `<button class="logo" data-a="${H || J ? 'noop' : 'home'}">🎲 <span>Game Night</span></button>
    <span class="spacer"></span>
    ${S ? `<span class="roomchip">Room <b>${esc(S.code)}</b></span>` : ''}
    ${J && J.status !== 'online' ? '<span class="roomchip warn">Reconnecting…</span>' : ''}
    <button class="sec sm" data-a="mute" aria-label="Sound on or off" title="Sound on or off">${sfx.muted ? '🔇 Muted' : '🔊 Sound'}</button>`;
}

function gameCard(g, action, extra) {
  const count = g.soon ? '' : `<span class="meta">${g.min === g.max ? g.min : g.min + '–' + g.max} players</span>`;
  return `<button class="gcard ${g.soon ? 'soon' : ''} ${extra || ''}" style="--g:${g.color}" ${g.soon ? 'disabled' : `data-a="${action}" data-id="${g.id}"`}>
    <span class="gi">${g.emoji}</span><b>${esc(g.name)}</b><small>${esc(g.blurb)}</small>${g.soon ? '<span class="meta">Coming soon</span>' : count}</button>`;
}

function homeHTML() {
  const p = prefs(), hs = lsGet(HOST_KEY), gs = lsGet(GUEST_KEY);
  const joinCode = (new URLSearchParams(location.search).get('join') || '').toUpperCase();
  return `
    <h1>Pick a game, invite your people</h1>
    <p class="lead">Play together on phones, tablets and laptops, at home or far apart.</p>
    ${ui.msg ? `<div class="notice" role="status">${esc(ui.msg)}</div>` : ''}
    ${hs && hs.room ? `<div class="card"><h3>Your saved game night</h3><div class="prow"><button class="ok" data-a="resume">▶ Resume hosting (room ${esc(hs.code)})</button><button class="sec" data-a="dropHost">Discard</button></div></div>` : ''}
    ${gs ? `<div class="card"><h3>You were in a room</h3><div class="prow"><button class="ok" data-a="rejoin">↩ Rejoin room ${esc(gs.code)}</button><button class="sec" data-a="dropGuest">Forget it</button></div></div>` : ''}
    <div class="two">
      <div class="card"><h3>1. Who are you?</h3>
        <div class="prow"><select class="icon" id="myicon" aria-label="Your picture">${iconOptions(p.icon)}</select><input type="text" id="myname" value="${esc(p.name)}" maxlength="14" placeholder="Your name" aria-label="Your name"></div></div>
      <div class="card"><h3>Joining a friend?</h3>
        <div class="prow"><input type="text" id="jcode" class="codein" value="${esc(joinCode)}" maxlength="8" placeholder="Room code" aria-label="Room code" autocapitalize="characters" autocomplete="off"><button data-a="join">Join</button></div></div>
    </div>
    <h2>2. Starting a game night? Tap a game</h2>
    <div class="shelf">${Core.games.map(g => gameCard(g, g.href ? 'open' : 'create')).join('')}</div>
    <div class="card"><h3>Trouble connecting?</h3><div class="prow"><button class="sec" data-a="test">Test my connection</button></div>${ui.test ? `<div class="notice">${esc(ui.test)}</div>` : ''}</div>`;
}

function scoreHTML() {
  if (!S.roster.some(m => m.played)) return '';
  const rows = [...S.roster].filter(m => m.played).sort((a, b) => b.wins - a.wins || a.played - b.played)
    .map(m => `<div class="prow tight"><span class="ic">${m.icon}</span><span class="nm">${esc(m.name)}</span><span class="wins">🏆 ${m.wins}</span><span class="seat-tag">${m.played} played</span></div>`).join('');
  return `<div class="card"><h3>Tonight's scoreboard</h3>${rows}</div>`;
}

function optionHTML(d, value, editable) {
  if (d.type === 'select') {
    return `<label class="opt col">${esc(d.label)}<select data-opt="${d.key}" ${editable ? '' : 'disabled'}>${d.choices.map(([v, t]) => `<option value="${v}" ${v === value ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
  }
  return `<label class="opt"><input type="checkbox" data-opt="${d.key}" ${value ? 'checked' : ''} ${editable ? '' : 'disabled'}><span>${esc(d.label)}<small>${esc(d.help || '')}</small></span></label>`;
}

// A game's settings. Games with lots of them keep the main choice and style buttons in view and fold the rest away.
function optionsHTML(game, host) {
  const list = items => `<div class="opts">${items.map(d => optionHTML(d, S.opts[d.key], host)).join('')}</div>`;
  const all = game.options || [];
  if (!game.foldOptions) return list(all);
  const presets = host && game.presets
    ? `<p class="hint">Quick styles:</p><div class="prow">${Object.keys(game.presets).map(n => `<button class="sm sec" data-a="preset" data-n="${esc(n)}">${esc(n)}</button>`).join('')}</div>` : '';
  return `${list(all.filter(d => d.top))}${presets}
    <details class="fold" ${ui.foldOpen ? 'open' : ''}><summary data-a="fold">${esc(game.foldOptions)}</summary>${list(all.filter(d => !d.top))}</details>`;
}

function lobbyHTML() {
  const host = !!H, game = Core.game(S.gameId);
  if (!game) return '<div class="notice">Refresh this page to get the newest version of the site.</div>';
  const playing = S.roster.filter(m => !m.away).slice(0, game.max).map(m => m.id);
  const rows = S.roster.map((m, i) => {
    const editable = host && (m.kind === 'bot' || m.kind === 'local');
    const level = m.kind === 'bot' && game.levels ? (host
      ? `<select data-level="${m.id}" aria-label="Computer skill">${LEVELS.map(([k, t]) => `<option value="${k}" ${k === m.level ? 'selected' : ''}>${t}</option>`).join('')}</select>`
      : `<span class="seat-tag">${esc(m.level)}</span>`) : '';
    return `<div class="prow tight ${playing.includes(m.id) ? '' : 'bench'}">
      <span class="ic token" style="--c:${m.color}">${m.icon}</span>
      ${editable ? `<input type="text" data-name="${m.id}" value="${esc(m.name)}" maxlength="14" aria-label="Player name">` : `<span class="nm">${esc(m.name)}${S.mine.includes(m.id) && !host ? ' <b>(you)</b>' : ''}</span>`}
      ${level}<span class="seat-tag">${playing.includes(m.id) ? memberTag(m) : m.away ? '🔌 Away' : '👀 Watching'}</span>
      ${host && i > 0 ? `<button class="sm sec" data-a="moveUp" data-id="${m.id}" title="Move up">▲</button>` : ''}
      ${host && m.kind !== 'host' ? `<button class="sm sec" data-a="remove" data-id="${m.id}" title="Remove">✕</button>` : ''}</div>`;
  }).join('');
  const full = S.roster.length >= MAX_ROOM;
  const watching = S.roster.filter(m => !m.away).length > game.max;
  const ready = playing.length >= game.min;
  const web = /^https?:$/.test(location.protocol);
  return `
    ${ui.msg ? `<div class="notice">${esc(ui.msg)}</div>` : ''}
    <div class="card invite"><h3>${host ? 'Room code: share it with your friends' : "You're in room"}</h3>
      <div class="code">${esc(S.code)}</div>
      ${host ? `<div class="prow center"><button data-a="copyCode">Copy code</button>${web ? '<button class="sec" data-a="copyLink">Copy invite link</button>' : ''}</div>` : ''}</div>
    <div class="card"><h3>Players (${S.roster.length}/${MAX_ROOM})</h3>${rows}
      ${watching ? `<p class="hint">${esc(game.name)} seats ${game.max}. Everyone else watches this round${host ? '. Use ▲ to choose who plays' : ''}.</p>` : ''}
      ${host ? `<div class="prow"><button class="sec" data-a="addBot" ${full ? 'disabled' : ''}>+ Computer player</button><button class="sec" data-a="addLocal" ${full ? 'disabled' : ''}>+ Another player on this device</button></div>` : ''}</div>
    ${scoreHTML()}
    <div class="card"><h3>${host ? 'Choose the game' : 'Tonight\'s game'}</h3>
      <div class="shelf mini">${Core.games.filter(g => !g.soon && !g.href && (host || g.id === S.gameId)).map(g => gameCard(g, host ? 'pickGame' : 'noop', g.id === S.gameId ? 'on' : '')).join('')}</div>
      <ul class="rules">${game.rules.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
      ${optionsHTML(game, host)}</div>
    ${host
      ? `<button class="bigstart" data-a="start" ${ready ? '' : 'disabled'}>${ready ? `Start ${esc(game.name)} (${playing.length} players)` : `Need at least ${game.min} players`}</button>
         <p class="foot"><button class="sm sec" data-a="pause">⏸ Pause &amp; save the room</button> <button class="sm sec" data-a="close">Close room</button></p>`
      : '<div class="notice">⏳ Waiting for the host to start. Keep this page open.</div><p class="foot"><button class="sm sec" data-a="leave">Leave room</button></p>'}
    <div class="reactbar">${reactionButtons()}</div>`;
}

function claimHTML() {
  const rows = (ui.claims || []).map(c => `<div class="prow"><span class="ic">${c.icon}</span><span class="nm">${esc(c.name)}</span><button class="ok" data-a="claim" data-id="${c.id}">That's me</button></div>`).join('');
  return `<div class="card"><h3>A game is already going</h3><p>Were you one of these players?</p>${rows}
    <div class="prow"><button class="sec" data-a="newcomer">No, I'm new. Let me watch and join the next game</button></div></div>
    <p class="foot"><button class="sm sec" data-a="home">Back</button></p>`;
}

function renderMenu() {
  if (ui.screen === 'game') return;
  const menu = $('#menu');
  // keep what is being typed if the screen redraws underneath it
  const a = document.activeElement;
  const typing = a && a.tagName === 'INPUT' && a.type === 'text' && menu.contains(a)
    ? { sel: a.id ? '#' + a.id : `[data-name="${a.dataset.name}"]`, value: a.value, at: a.selectionStart } : null;
  const mine = $('#myname') ? { name: $('#myname').value, icon: $('#myicon').value, code: $('#jcode').value } : null;
  menu.innerHTML = ui.screen === 'lobby' && S ? lobbyHTML() : ui.screen === 'claim' ? claimHTML() : homeHTML();
  if (mine && $('#myname')) { $('#myname').value = mine.name; $('#myicon').value = mine.icon; $('#jcode').value = mine.code; }
  if (typing) { const el = menu.querySelector(typing.sel); if (el) { el.value = typing.value; el.focus(); el.setSelectionRange(typing.at, typing.at); } }
  menu.hidden = false; $('#play').hidden = true;
  renderTop();
}

const reactionButtons = () => REACTIONS.map(e => `<button class="react" data-a="react" data-e="${e}" aria-label="React ${e}">${e}</button>`).join('');

function renderChrome() {
  if (!S) return;
  if (!S.match) { renderMenu(); return; }
  renderTop();
  const mt = S.match, state = mt.state;
  const players = mt.seats.map((id, i) => {
    const m = S.roster.find(x => x.id === id) || { name: '(left)', icon: '❔', color: '#888', kind: 'bot' };
    const status = ui.view && ui.view.status ? ui.view.status(state, i) : '';
    return `<div class="pl ${!state.over && mt.turn === i ? 'turn' : ''}"><span class="token" style="--c:${m.color}">${m.icon}</span>
      <div class="mid"><div class="nm">${esc(m.name)}${mt.mySeats.includes(i) ? ' <span class="tag">YOU</span>' : ''}</div><small>${memberTag(m)}</small></div><b>${esc(status)}</b></div>`;
  }).join('');
  const away = mt.seats.map(id => S.roster.find(x => x.id === id)).filter(m => m && m.kind === 'remote' && m.away && !m.covering);
  const holdBox = mt.hold
    ? `<div class="notice">⏸ Waiting for ${esc(away.map(m => m.name).join(', ') || 'players')} to rejoin.${H ? ' <button class="sm" data-a="unhold">Start anyway</button>' : ''}</div>`
    : (H && !state.over ? away.map(m => `<div class="notice">${esc(m.name)} lost connection. <button class="sm" data-a="coverNow" data-id="${m.id}">Let the computer play now</button></div>`).join('') : '');
  const watching = !mt.mySeats.length ? '<div class="notice">👀 You are watching this game. You can join the next one.</div>' : '';
  const ownSide = Core.game(mt.gameId).ownSide;
  $('#roomside').innerHTML = `${holdBox}${watching}
    ${ownSide ? '' : `<div class="panel"><h4>Players</h4>${players}</div>
    <div class="panel"><h4>What happened</h4><div class="log">${state.log.slice(-12).reverse().map(l => `<div>${esc(l)}</div>`).join('')}</div></div>`}
    ${scoreHTML()}
    <div class="panel roomctl">${H
      ? '<button class="sm sec" data-a="pause">⏸ Pause &amp; save</button><button class="sm sec" data-a="endGame">Back to game menu</button><button class="sm sec" data-a="close">Close room</button>'
      : '<button class="sm sec" data-a="leave">Leave room</button>'}</div>`;
  $('#reactbar').innerHTML = reactionButtons();
  if (ui.view) ui.view.refresh();
  // a little chime when it becomes this device's turn
  const turnKey = `${S.match.n}:${state.seq}:${mt.turn}`;
  if (api.canAct() && ui.lastTurnKey !== turnKey) { ui.lastTurnKey = turnKey; if (state.seq) sfx.turn(); }
}

function showResult() {
  if (!S || !S.match || !S.match.state.over || ui.queue.length) return;
  const key = `${S.code}:${S.match.n}`;
  if (ui.resultKey === key) return;
  ui.resultKey = key;
  const winners = S.match.state.winners.map(i => S.roster.find(x => x.id === S.match.seats[i])).filter(Boolean);
  sfx.win();
  const confetti = Array.from({ length: 60 }, (_, i) => `<i style="left:${Math.random() * 100}%;background:${COLORS[i % COLORS.length]};animation-delay:${Math.random() * 1.2}s"></i>`).join('');
  $('#modal').innerHTML = `<div class="ov"><div class="confetti">${confetti}</div><div class="dlg">
    <div class="trophy">${winners.map(w => w.icon).join('')}</div>
    <h2>${esc(winners.map(w => w.name).join(' & '))} ${winners.length > 1 ? 'win' : 'wins'}!</h2>
    ${Core.game(S.match.gameId).resultHTML ? Core.game(S.match.gameId).resultHTML(S.match.state) : ''}
    ${scoreHTML()}
    <div class="prow center">${H ? '<button class="ok" data-a="again">Play again</button><button data-a="endGame">Choose a game</button>' : '<span class="hint">The host picks what to play next.</span>'}
      <button class="sec" data-a="closeModal">See the board</button></div></div></div>`;
}

// ================================================================ clicks and typing
function copy(text) {
  const done = () => toast('Copied!');
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => toast(text));
  else toast(text);
}

const actions = {
  noop() {},
  home() { goHome(''); },
  mute() { sfx.toggle(); renderTop(); },
  create: el => createRoom(el.dataset.id),
  open: el => { readMe(); location.href = Core.game(el.dataset.id).href; },
  join: () => joinRoom(),
  rejoin: () => { const s = lsGet(GUEST_KEY); if (s) joinRoom(s); },
  dropGuest() { lsDel(GUEST_KEY); renderMenu(); },
  resume: resumeRoom,
  dropHost() { if (confirm('Delete your saved game night?')) { lsDel(HOST_KEY); renderMenu(); } },
  async test() {
    ui.test = 'Testing… this takes up to 10 seconds.'; renderMenu();
    ui.test = await Link.test();
    if (!H && !J) renderMenu();
  },
  claim: el => { if (J && J.ch) J.ch.send({ t: 'claim', cid: J.cid, id: el.dataset.id }); },
  newcomer() { if (J && J.ch) J.ch.send({ t: 'newcomer', cid: J.cid, name: J.name, icon: J.icon }); },
  copyCode: () => copy(S.code),
  copyLink: () => copy(`${location.origin}${location.pathname}?join=${S.code}`),
  addBot() { const n = H.room.roster.filter(m => m.kind === 'bot').length + 1; if (addMember('bot', `Computer ${n}`)) publish(); },
  addLocal() { const n = H.room.roster.filter(m => m.kind === 'local').length + 2; if (addMember('local', `Player ${n}`)) publish(); },
  remove(el) {
    const m = member(el.dataset.id);
    if (!m || m.kind === 'host') return;
    if (m.kind === 'remote' && H.chans[m.cid]) { reject(H.chans[m.cid], 'The host removed you from the room.'); delete H.chans[m.cid]; }
    H.room.roster = H.room.roster.filter(x => x !== m);
    publish();
  },
  moveUp(el) {
    const r = H.room.roster, i = r.findIndex(m => m.id === el.dataset.id);
    if (i > 0) { [r[i - 1], r[i]] = [r[i], r[i - 1]]; publish(); }
  },
  pickGame(el) { H.room.gameId = el.dataset.id; publish(); },
  preset(el) {
    const id = H.room.gameId, values = Object.assign({}, Core.game(id).presets[el.dataset.n]);
    const theme = optionsFor(id).theme;   // a style changes the rules, not the board you picked
    H.room.opts[id] = Object.assign(values, theme ? { theme } : {});
    toast(`Style chosen: ${el.dataset.n}`);
    publish();
  },
  fold() { setTimeout(() => { const d = document.querySelector('details.fold'); ui.foldOpen = !!(d && d.open); }, 0); },
  start: startMatch,
  again() { H.room.gameId = H.room.match.gameId; H.room.match = null; startMatch(); if (!H.room.match) publish(); },
  endGame() {
    if (H.room.match && !H.room.match.state.over && !confirm('Stop this game and go back to the game menu?')) return;
    backToLobby();
  },
  pause: pauseRoom,
  close: closeRoom,
  leave: leaveRoom,
  unhold() { waitingFor().forEach(m => { m.covering = true; }); H.room.match.hold = false; publish(); },
  coverNow: el => { const m = member(el.dataset.id); if (m) cover(m); },
  react: el => { if (Date.now() - ui.lastReact > 700) { ui.lastReact = Date.now(); react(el.dataset.e); } },
  closeModal() { $('#modal').innerHTML = ''; },
};

document.addEventListener('click', e => {
  if (H && e.target.closest('[data-room="unhold"]')) { actions.unhold(); return; }
  const el = e.target.closest('[data-a]');
  if (el && !el.disabled && actions[el.dataset.a]) actions[el.dataset.a](el);
});

document.addEventListener('change', e => {
  const el = e.target;
  if (!H) return;
  if (el.dataset.name) { const m = member(el.dataset.name); if (m) { m.name = el.value.trim().slice(0, 14) || m.name; publish(); } }
  else if (el.dataset.level) { const m = member(el.dataset.level); if (m) { m.level = el.value; publish(); } }
  else if (el.dataset.opt) {
    const id = H.room.gameId, def = Core.game(id).options.find(d => d.key === el.dataset.opt);
    const value = def.type === 'select' ? def.choices.find(c => String(c[0]) === el.value)[0] : el.checked;
    H.room.opts[id] = Object.assign({}, H.room.opts[id], { [def.key]: value });
    publish();
  }
});

document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || !e.target.matches('#jcode')) return;
  joinRoom();
});

window.addEventListener('beforeunload', e => { if (H) { e.preventDefault(); e.returnValue = ''; } });

// A handle for testing from the browser console.
window.__gn = { get H() { return H; }, get J() { return J; }, get S() { return S; }, ui, api };

renderMenu();
})();
