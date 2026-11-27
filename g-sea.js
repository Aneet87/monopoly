/* Sea Battle: hide your fleet, then take turns firing at your rival's waters.
   Rules first (no screen code), then the computer players, then the screen. */
(() => {
'use strict';
const { esc, sleep, sfx, toast } = Core;

const N = 10, CELLS = N * N, LETTERS = 'ABCDEFGHIJ';
const FLEET = [['carrier', 'Carrier', 5], ['cruiser', 'Cruiser', 4], ['destroyer', 'Destroyer', 3], ['sub', 'Submarine', 3], ['patrol', 'Patrol Boat', 2]];
const SIZE = Object.fromEntries(FLEET.map(([id, , n]) => [id, n]));
const NAME = Object.fromEntries(FLEET.map(([id, n]) => [id, n]));

const cellName = i => LETTERS[Math.floor(i / N)] + (i % N + 1);
// The squares a ship covers, or null if it hangs off the board.
function cellsOf(ship) {
  const out = [], len = SIZE[ship.id];
  for (let k = 0; k < len; k++) {
    const r = ship.r + (ship.dir === 'v' ? k : 0), c = ship.c + (ship.dir === 'h' ? k : 0);
    if (r < 0 || c < 0 || r >= N || c >= N) return null;
    out.push(r * N + c);
  }
  return out;
}
function around(i) {
  const r = Math.floor(i / N), c = i % N, out = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if ((dr || dc) && r + dr >= 0 && r + dr < N && c + dc >= 0 && c + dc < N) out.push((r + dr) * N + c + dc);
  }
  return out;
}
const sides = i => around(i).filter(j => Math.floor(j / N) === Math.floor(i / N) || j % N === i % N);

// May this ship go here, given the others? `apart` = ships may not touch, even at corners.
function fits(ship, others, apart) {
  const cells = cellsOf(ship);
  if (!cells) return false;
  const taken = new Set();
  others.forEach(o => (cellsOf(o) || []).forEach(i => { taken.add(i); if (apart) around(i).forEach(j => taken.add(j)); }));
  return cells.every(i => !taken.has(i));
}
function randomFleet(apart, rng = Math.random) {
  for (;;) {
    const ships = [];
    const ok = FLEET.every(([id]) => {
      for (let tries = 0; tries < 200; tries++) {
        const ship = { id, r: Math.floor(rng() * N), c: Math.floor(rng() * N), dir: rng() < .5 ? 'h' : 'v' };
        if (fits(ship, ships, apart)) { ships.push(ship); return true; }
      }
      return false;
    });
    if (ok) return ships;
  }
}

// ---------------------------------------------------------------- rules
function create(players, opts) {
  return {
    players: players.map(p => ({ name: p.name, icon: p.icon, color: p.color, ready: false, ships: [], sunk: [], shots: Array(CELLS).fill(0) })),
    opts: { shots: opts.shots === 'salvo' ? 'salvo' : 'one', apart: !!opts.apart },
    phase: 'place', turn: 0, seq: 0, last: null, over: false, winners: [], log: ['Hide your ships, then tap Ready.'],
  };
}
const turnOf = s => (s.phase === 'place' ? Math.max(0, s.players.findIndex(p => !p.ready)) : s.turn);
const canMove = (s, seat) => !s.over && !!s.players[seat] && (s.phase === 'place' ? !s.players[seat].ready : seat === s.turn);
// How many shots the player to move gets. `shots` is 0 unknown, 1 miss, 2 hit, recorded on the sea being fired at.
function shotCount(s, seat) {
  const open = s.players[1 - seat].shots.filter(v => !v).length;
  return Math.min(open, s.opts.shots === 'salvo' ? FLEET.length - s.players[seat].sunk.length : 1);
}

function exec(s, seat, move) {
  if (s.over) return 'The game is over.';
  if (!canMove(s, seat)) return "It isn't your turn.";
  if (!move) return 'Unknown move.';
  const me = s.players[seat];
  if (s.phase === 'place') {
    if (move.k !== 'place' || !Array.isArray(move.ships) || move.ships.length !== FLEET.length) return 'Place all of your ships first.';
    const ships = [];
    for (const [id] of FLEET) {
      const given = move.ships.find(x => x && x.id === id);
      if (!given || !['h', 'v'].includes(given.dir) || !Number.isInteger(given.r) || !Number.isInteger(given.c)) return 'Place all of your ships first.';
      const ship = { id, r: given.r, c: given.c, dir: given.dir };
      if (!fits(ship, ships, s.opts.apart)) return s.opts.apart ? "Ships can't overlap or touch." : "Ships can't overlap.";
      ships.push(ship);
    }
    me.ships = ships; me.ready = true;
    s.last = { type: 'ready', seat };
    s.log.push(`${me.name}'s fleet is ready.`);
    if (s.players.every(p => p.ready)) { s.phase = 'battle'; s.turn = 0; s.log.push(`Battle stations! ${s.players[0].name} fires first.`); }
  } else {
    const them = s.players[1 - seat], need = shotCount(s, seat);
    if (move.k !== 'fire' || !Array.isArray(move.cells)) return 'Pick a square to fire at.';
    const cells = [...new Set(move.cells)];
    if (cells.length !== need) return `Pick ${need} square${need > 1 ? 's' : ''}.`;
    if (!cells.every(i => Number.isInteger(i) && i >= 0 && i < CELLS && !them.shots[i])) return 'Pick squares you have not fired at.';
    const results = cells.map(i => {
      const ship = them.ships.find(x => cellsOf(x).includes(i));
      them.shots[i] = ship ? 2 : 1;
      let sunk = null;
      if (ship && cellsOf(ship).every(j => them.shots[j] === 2)) { sunk = ship.id; them.sunk.push(ship.id); }
      return { cell: i, hit: !!ship, sunk };
    });
    s.last = { type: 'fire', seat, results };
    results.forEach(r => s.log.push(`${me.name} fired at ${cellName(r.cell)}: ${r.sunk ? `sank the ${NAME[r.sunk]}! 💥` : r.hit ? 'hit! 🔥' : 'miss.'}`));
    if (them.sunk.length === FLEET.length) { s.over = true; s.winners = [seat]; s.log.push(`🏆 ${me.name} sank the whole fleet!`); }
    else s.turn = 1 - seat;
  }
  if (s.log.length > 60) s.log.splice(0, s.log.length - 60);
  s.seq++;
  return null;
}

// Each device only receives the ships it is allowed to see: its own, plus any that have been sunk.
function view(s, seats) {
  return Object.assign({}, s, {
    players: s.players.map((p, i) => (s.over || seats.includes(i) ? p : Object.assign({}, p, { ships: p.ships.filter(x => p.sunk.includes(x.id)) }))),
  });
}

// ---------------------------------------------------------------- computer players
// They use only what a person could see: their own shots and which ships have been sunk.
function bot(s, seat, level, rng = Math.random) {
  if (s.phase === 'place') return { k: 'place', ships: randomFleet(s.opts.apart, rng) };
  const them = s.players[1 - seat], need = shotCount(s, seat);
  const sunkShips = them.ships.filter(x => them.sunk.includes(x.id));
  const sunkCells = new Set(sunkShips.flatMap(cellsOf));
  const blocked = new Set(sunkCells);
  them.shots.forEach((v, i) => { if (v === 1) blocked.add(i); });
  if (s.opts.apart) sunkCells.forEach(i => around(i).forEach(j => blocked.add(j)));
  const hits = them.shots.map((v, i) => (v === 2 && !sunkCells.has(i) ? i : -1)).filter(i => i >= 0);
  const picked = [];
  const open = i => !them.shots[i] && !picked.includes(i);
  const anyOf = list => list[Math.floor(rng() * list.length)];

  while (picked.length < need) {
    const free = [...Array(CELLS).keys()].filter(open);
    const useful = free.filter(i => !blocked.has(i));
    let choice;
    if (level === 'hard') {
      const score = Array(CELLS).fill(0);
      FLEET.filter(([id]) => !them.sunk.includes(id)).forEach(([id]) => {
        for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) ['h', 'v'].forEach(dir => {
          const cells = cellsOf({ id, r, c, dir });
          if (!cells || cells.some(i => blocked.has(i))) return;
          const covered = cells.filter(i => hits.includes(i)).length;
          const weight = 1 + (covered ? 40 * covered * covered : 0);
          cells.forEach(i => { if (open(i)) score[i] += weight; });
        });
      });
      const top = Math.max(...free.map(i => score[i]));
      choice = anyOf(free.filter(i => score[i] === top));
    } else {
      if (hits.length && (level === 'medium' || rng() < .45)) {
        const near = [...new Set(hits.flatMap(sides))].filter(i => open(i) && !blocked.has(i));
        // two hits in a row point the way
        const inLine = near.filter(i => sides(i).some(h => hits.includes(h) && hits.includes(2 * h - i) &&
          (Math.abs(i - h) === 10 || Math.floor((2 * h - i) / N) === Math.floor(h / N))));
        if (level === 'medium' && inLine.length) choice = anyOf(inLine); else if (near.length) choice = anyOf(near);
      }
      if (choice === undefined) {
        const checker = useful.filter(i => (Math.floor(i / N) + i % N) % 2 === 0);
        choice = level === 'medium' && checker.length ? anyOf(checker) : anyOf(level === 'medium' && useful.length ? useful : free);
      }
    }
    picked.push(choice);
  }
  return { k: 'fire', cells: picked };
}

// ---------------------------------------------------------------- screen
function mount(root, api) {
  root.innerHTML = `
    <div class="gstage sea">
      <div class="gtext sea-top"><div class="gstatus" aria-live="polite"></div><div class="sea-help"></div></div>
      <div class="sea-wrap"><div class="sea-seas"></div><div class="callout" hidden></div></div>
      <div class="sea-actions"></div>
    </div>`;
  const q = x => root.querySelector(x);
  const seas = q('.sea-seas'), actions = q('.sea-actions'), status = q('.gstatus'), help = q('.sea-help'), call = q('.callout');
  let state = null, busy = false, dead = false, sent = false, signature = '';
  let revealed = null;              // sharing one device: whose screen is showing
  const drafts = {};                // ship layouts being arranged, per seat
  let chosen = null, aim = [], aimSeq = -1;

  const humans = () => api.mySeats.filter(i => state.players[i]);
  const sharing = () => humans().length > 1;
  const nm = i => `${state.players[i].icon} ${state.players[i].name}`;

  function button(text, cls, fn, disabled) {
    const b = document.createElement('button');
    b.className = cls; b.textContent = text; b.disabled = !!disabled;
    b.addEventListener('click', fn);
    actions.appendChild(b);
    return b;
  }

  // One 10 x 10 sea. opts: ships (list to draw), onCell, aim (squares chosen), picked (ship id being moved)
  function seaHTML(owner, title, opts) {
    const p = state.players[owner], ships = opts.ships || [], look = {};
    ships.forEach(ship => {
      const cells = cellsOf(ship) || [];
      cells.forEach((i, k) => {
        look[i] = `ship ${ship.dir}${k === 0 ? ' bow' : ''}${k === cells.length - 1 ? ' stern' : ''}${p.sunk.includes(ship.id) ? ' sunk' : ''}${opts.picked === ship.id ? ' moving' : ''}`;
      });
    });
    let grid = '<span></span>' + Array.from({ length: N }, (_, c) => `<span class="lab">${c + 1}</span>`).join('');
    for (let r = 0; r < N; r++) {
      grid += `<span class="lab">${LETTERS[r]}</span>`;
      for (let c = 0; c < N; c++) {
        const i = r * N + c, shot = p.shots[i];
        const cls = [look[i] || '', shot === 2 ? 'hit' : shot === 1 ? 'miss' : '', opts.aim && opts.aim.includes(i) ? 'aim' : ''].join(' ');
        const what = shot === 2 ? 'hit' : shot === 1 ? 'miss' : look[i] ? 'ship' : 'water';
        grid += `<button class="sq ${cls}" data-i="${i}" aria-label="${cellName(i)} ${what}" ${opts.onCell ? '' : 'tabindex="-1"'}><i></i></button>`;
      }
    }
    const left = FLEET.map(([id, name, len]) => `<span class="${p.sunk.includes(id) ? 'down' : ''}" title="${name}">${'▮'.repeat(len)}</span>`).join('');
    return `<div class="sea-box ${opts.cls || ''}" data-owner="${owner}"><h5>${title}</h5><div class="sea-grid ${opts.onCell ? 'live' : ''}">${grid}</div><div class="sea-left">${left}</div></div>`;
  }
  function listen(owner, fn) {
    const box = seas.querySelector(`[data-owner="${owner}"] .sea-grid`);
    if (box) box.addEventListener('click', e => { const b = e.target.closest('.sq'); if (b) fn(+b.dataset.i); });
  }

  function send(move, seat) {
    if (busy || sent) return;
    sent = true;
    if (!api.move(move, seat)) sent = false;
  }

  function cover(seat) {
    seas.innerHTML = `<div class="sea-cover"><div class="big">🙈</div><h3>Pass the device to ${esc(state.players[seat].name)}</h3><p>Everyone else, no peeking!</p></div>`;
    status.textContent = `${nm(seat)}, it's your turn`;
    help.textContent = '';
    button(`I'm ${state.players[seat].name}: show my screen`, 'bigbtn', () => { revealed = seat; draw(); });
  }

  function placing(seat) {
    const apart = state.opts.apart;
    if (!drafts[seat]) drafts[seat] = randomFleet(apart);
    const fleet = drafts[seat];
    const moveShip = (id, change) => {
      const ship = fleet.find(x => x.id === id), rest = fleet.filter(x => x !== ship), next = Object.assign({}, ship, change);
      const len = SIZE[id];   // nudge it back on board if it hangs over the edge
      next.r = Math.min(next.r, next.dir === 'v' ? N - len : N - 1);
      next.c = Math.min(next.c, next.dir === 'h' ? N - len : N - 1);
      if (!fits(next, rest, apart)) return false;
      Object.assign(ship, next);
      return true;
    };
    const turnShip = id => {
      const ship = fleet.find(x => x.id === id), dir = ship.dir === 'h' ? 'v' : 'h';
      if (!moveShip(id, { dir })) { toast('No room to turn it there. Move it first.'); sfx.nope(); }
    };
    seas.innerHTML = seaHTML(seat, `${esc(state.players[seat].name)}'s waters`, { ships: fleet, picked: chosen, onCell: true, cls: 'main' });
    listen(seat, i => {
      const there = fleet.find(x => cellsOf(x).includes(i));
      if (there && there.id === chosen) turnShip(chosen);
      else if (there) { chosen = there.id; sfx.tick(); }
      else if (chosen) { if (moveShip(chosen, { r: Math.floor(i / N), c: i % N })) sfx.hop(); else { toast("It doesn't fit there."); sfx.nope(); } }
      draw();
    });
    status.textContent = `${nm(seat)}, hide your ships`;
    help.textContent = chosen ? `${NAME[chosen]}: tap water to move it, or tap it again to turn it.` : `Tap a ship to move it, or just tap Ready.${apart ? ' Ships may not touch.' : ''}`;
    button('🔀 Shuffle', 'sec', () => { drafts[seat] = randomFleet(apart); chosen = null; sfx.pop(); draw(); });
    if (chosen) button('🔄 Turn ship', 'sec', () => { turnShip(chosen); draw(); });
    button('✓ Ready!', 'bigbtn', () => { chosen = null; send({ k: 'place', ships: fleet }, seat); }, !api.canAct(seat));
  }

  const shownShips = i => state.players[i].ships.filter(x => state.over || state.players[i].sunk.includes(x.id));

  function battle(seat) {
    const other = 1 - seat, mine = api.canAct(seat), need = mine ? shotCount(state, seat) : 0;
    if (aimSeq !== state.seq) { aim = []; aimSeq = state.seq; }
    seas.innerHTML = seaHTML(other, `🎯 ${esc(state.players[other].name)}'s waters`, { ships: shownShips(other), onCell: mine, aim, cls: 'main' }) +
      seaHTML(seat, '⚓ Your fleet', { ships: state.players[seat].ships, cls: 'side' });
    if (mine) listen(other, i => {
      if (state.players[other].shots[i]) return;
      if (aim.includes(i)) aim = aim.filter(x => x !== i);
      else { aim.push(i); if (aim.length > need) aim.shift(); }
      sfx.tick(); draw();
    });
    if (state.over) { status.textContent = `🏆 ${state.players[state.winners[0]].name} wins!`; help.textContent = ''; return; }
    status.textContent = mine ? `${nm(seat)}, your shot!` : `Waiting for ${nm(state.turn)} to fire…`;
    help.textContent = !mine ? '' : need > 1 ? `Pick ${need} squares, then Fire. (${aim.length} of ${need})` : 'Pick a square, then Fire.';
    if (mine) button(aim.length === 1 && need === 1 ? `🔥 Fire at ${cellName(aim[0])}` : '🔥 Fire!', 'bigbtn', () => send({ k: 'fire', cells: aim.slice() }, seat), aim.length !== need);
  }

  function watching() {
    seas.innerHTML = [0, 1].map(i => seaHTML(i, `${esc(state.players[i].name)}'s waters`, { ships: shownShips(i), cls: 'watch' })).join('');
    status.textContent = state.over ? `🏆 ${state.players[state.winners[0]].name} wins!` : state.phase === 'place' ? 'Fleets are being hidden…' : `${nm(state.turn)} is firing…`;
    help.textContent = '';
  }

  function draw() {
    if (!state || dead) return;
    actions.innerHTML = '';
    const mySeats = humans();
    if (!mySeats.length) { watching(); return; }
    if (!sharing()) {
      const seat = mySeats[0];
      if (state.phase === 'place' && !state.players[seat].ready) { placing(seat); return; }
      if (state.phase === 'place') {
        seas.innerHTML = seaHTML(seat, '⚓ Your fleet', { ships: state.players[seat].ships, cls: 'main' });
        status.textContent = 'Fleet hidden! Waiting for your rival…'; help.textContent = '';
      } else battle(seat);
      return;
    }
    // two people on one device: never show a fleet until its owner says it is them
    if (state.over) { watching(); return; }
    const actor = turnOf(state);
    if (revealed === null) { cover(actor); return; }
    if (revealed !== actor) {   // finished: look at the result, then hide it before passing
      if (state.phase === 'battle') battle(revealed);
      else { seas.innerHTML = '<div class="sea-cover"><div class="big">⚓</div><h3>Fleet hidden!</h3></div>'; help.textContent = ''; }
      status.textContent = `Done? Pass to ${nm(actor)}.`;
      button(`Hide my screen and pass to ${state.players[actor].name}`, 'bigbtn', () => { revealed = null; draw(); });
      return;
    }
    if (state.phase === 'place') placing(revealed); else battle(revealed);
  }

  const shout = (text, cls) => { call.textContent = text; call.className = 'callout ' + cls; call.hidden = false; };
  const sigNow = () => JSON.stringify([state.seq, api.mySeats, [0, 1].map(i => api.canAct(i))]);
  // The room calls this often; only redraw when something that matters here has changed.
  function refresh() {
    if (busy || !state) return;
    sent = false;
    const now = sigNow();
    if (now === signature) return;
    signature = now;
    draw();
  }

  async function update(next) {
    const last = next.last, before = state;
    if (!last || last.type !== 'fire' || !before) {
      state = next; signature = ''; busy = false;
      if (last && last.type === 'ready') sfx.pop();
      refresh(); return;
    }
    busy = true; aim = []; actions.innerHTML = ''; help.textContent = '';
    const target = 1 - last.seat;
    state = next;
    // if the screen is covered (sharing a device), there is no grid to animate on
    const grid = seas.querySelector(`[data-owner="${target}"] .sea-grid`);
    status.textContent = `${nm(last.seat)} is firing…`;
    for (const r of last.results) {
      if (dead) return;
      const sq = grid && grid.querySelector(`[data-i="${r.cell}"]`);
      if (sq) { sq.classList.remove('aim', 'hit', 'miss'); sq.classList.add('incoming'); }
      await sleep(last.results.length > 1 ? 330 : 600);
      if (sq) { sq.classList.remove('incoming'); sq.classList.add(r.hit ? 'hit' : 'miss'); }
      if (r.hit) sfx.boom(); else sfx.splash();
      shout(r.sunk ? `💥 ${NAME[r.sunk]} sunk!` : r.hit ? `🔥 Hit at ${cellName(r.cell)}!` : `💦 Miss at ${cellName(r.cell)}`, r.hit ? 'good' : 'miss');
      await sleep(r.sunk ? 1200 : last.results.length > 1 ? 480 : 850);
      call.hidden = true;
    }
    if (dead) return;
    busy = false; signature = '';
    refresh();
  }

  function reset(next) {
    state = next; busy = false; signature = ''; revealed = null; chosen = null; aim = []; aimSeq = -1; call.hidden = true;
    refresh();
  }

  return {
    reset, update, refresh,
    status: (s, i) => (s.phase === 'place' ? (s.players[i].ready ? '✓ Ready' : 'Hiding ships…') : `⚓ ${FLEET.length - s.players[i].sunk.length} afloat`),
    destroy() { dead = true; root.innerHTML = ''; },
  };
}

Core.register({
  id: 'sea', name: 'Sea Battle', emoji: '🚢', color: '#3d8bfd',
  blurb: 'Hide your fleet, then hunt down your rival’s ships.',
  min: 2, max: 2, levels: true,
  rules: [
    'Hide your five ships. Nobody else can see them on their screen.',
    'Take turns picking a square to fire at. 🔥 means hit, a white dot means miss.',
    'Sink every one of your rival’s ships to win.',
  ],
  options: [
    { key: 'shots', type: 'select', label: 'Shots per turn', default: 'one', choices: [['one', '1 shot (standard)'], ['salvo', 'One shot for each of your ships afloat']] },
    { key: 'apart', type: 'check', label: 'Ships can’t touch', help: 'Leave at least one square of water between ships, even at corners.', default: false },
  ],
  create, exec, view, bot, canMove,
  turn: turnOf,
  mount,
  FLEET, cellsOf, fits, randomFleet, shotCount,
});
})();
