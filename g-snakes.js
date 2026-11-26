/* Snakes & Ladders: rules first (no screen code), then the animated board. */
(() => {
'use strict';
const { esc, sleep, sfx } = Core;

const LADDERS = { 1: 38, 4: 14, 9: 31, 21: 42, 28: 84, 36: 44, 51: 67, 71: 91, 80: 100 };
const SNAKES = { 16: 6, 47: 26, 49: 11, 56: 53, 62: 19, 64: 60, 87: 24, 93: 73, 95: 75, 98: 78 };

// ---------------------------------------------------------------- rules
function create(players, opts) {
  return {
    players: players.map(p => ({ name: p.name, icon: p.icon, color: p.color, pos: 0 })),
    opts: { finish: opts.finish || 'exact', bonus6: !!opts.bonus6 },
    turn: 0, seq: 0, last: null, over: false, winners: [], log: ['Everyone starts just off the board. Spin to move!'],
  };
}

function exec(s, seat, move, rng = Math.random) {
  if (s.over) return 'The game is over.';
  if (seat !== s.turn) return "It isn't your turn.";
  if (!move || move.k !== 'spin') return 'Unknown move.';
  const p = s.players[seat], roll = 1 + Math.floor(rng() * 6), from = p.pos;
  let land = from + roll, to, kind = 'move';
  if (land > 100) {
    if (s.opts.finish === 'exact') { land = from; kind = 'stay'; } else land = 100;
  }
  to = land;
  if (kind !== 'stay' && LADDERS[land]) { to = LADDERS[land]; kind = 'ladder'; }
  else if (kind !== 'stay' && SNAKES[land]) { to = SNAKES[land]; kind = 'snake'; }
  p.pos = to;
  const again = s.opts.bonus6 && roll === 6 && to !== 100;
  s.last = { seat, roll, from, land, to, kind, again };
  s.log.push(kind === 'stay' ? `${p.name} spun ${roll} but needs exactly ${100 - from}. Stay put!`
    : kind === 'ladder' ? `${p.name} spun ${roll} and climbed a ladder from ${land} to ${to}! 🪜`
      : kind === 'snake' ? `${p.name} spun ${roll} and slid down a snake from ${land} to ${to}! 🐍`
        : `${p.name} spun ${roll} and moved to ${to}.`);
  if (to === 100) { s.over = true; s.winners = [seat]; s.log.push(`🏆 ${p.name} reached 100!`); }
  else if (!again) s.turn = (s.turn + 1) % s.players.length;
  else s.log.push(`${p.name} spun a 6 and goes again.`);
  if (s.log.length > 60) s.log.splice(0, s.log.length - 60);
  s.seq++;
  return null;
}

// ---------------------------------------------------------------- board geometry (the board is 1000 x 1000)
const cell = n => {
  const i = n - 1, row = Math.floor(i / 10), col = row % 2 ? 9 - (i % 10) : i % 10;
  return { x: col * 100, y: (9 - row) * 100 };
};
const centre = n => { const c = cell(n); return { x: c.x + 50, y: c.y + 50 }; };
const TILE = ['#fff3b8', '#c9ecff', '#d9f7c7', '#ffd9e6', '#e8dcff'];
const SNAKE_STYLE = [['#2fae5a', '#ffe14d'], ['#e8556d', '#ffd1d9'], ['#7a5be8', '#d9cdff'], ['#f08a24', '#ffe0b0'], ['#139fb4', '#b8f1f7']];

function ladderSVG(a, b) {
  const p = centre(a), q = centre(b), dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy), ox = -dy / len * 21, oy = dx / len * 21;
  let rungs = '';
  for (let d = 26; d < len - 14; d += 34) {
    const x = p.x + dx * d / len, y = p.y + dy * d / len;
    rungs += `M${x + ox} ${y + oy}L${x - ox} ${y - oy}`;
  }
  const rails = `M${p.x + ox} ${p.y + oy}L${q.x + ox} ${q.y + oy}M${p.x - ox} ${p.y - oy}L${q.x - ox} ${q.y - oy}`;
  return `<g stroke-linecap="round" fill="none"><path d="${rails}${rungs}" stroke="#5a3410" stroke-width="13" opacity=".9"/>
    <path d="${rungs}" stroke="#ffcf6b" stroke-width="6"/><path d="${rails}" stroke="#e7a23c" stroke-width="7"/></g>`;
}

// A wiggly line from the snake's head (high square) to its tail (low square).
function snakePath(head, tail) {
  const p = centre(head), q = centre(tail), dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy);
  const nx = -dy / len, ny = dx / len, waves = Math.max(2, Math.round(len / 150)), amp = Math.min(38, len / 6);
  let d = `M${p.x} ${p.y}`;
  for (let i = 0; i < waves; i++) {
    const t1 = (i + .5) / waves, t2 = (i + 1) / waves, side = i % 2 ? -1 : 1;
    d += ` Q${p.x + dx * t1 + nx * amp * side * 1.5} ${p.y + dy * t1 + ny * amp * side * 1.5} ${p.x + dx * t2} ${p.y + dy * t2}`;
  }
  return d;
}
function snakeSVG(head, tail, i) {
  const [body, spots] = SNAKE_STYLE[i % SNAKE_STYLE.length], d = snakePath(head, tail), h = centre(head);
  return `<g fill="none" stroke-linecap="round">
    <path d="${d}" stroke="rgba(0,0,0,.25)" stroke-width="28" transform="translate(4 6)"/>
    <path id="snake${head}" d="${d}" stroke="${body}" stroke-width="24"/>
    <path d="${d}" stroke="${spots}" stroke-width="8" stroke-dasharray="3 24"/>
    <path d="M${h.x} ${h.y - 28}l0 -16m0 0l-9 -10m9 10l9 -10" stroke="#e0233f" stroke-width="5"/>
    <ellipse cx="${h.x}" cy="${h.y - 4}" rx="27" ry="31" fill="${body}" stroke="rgba(0,0,0,.25)" stroke-width="3"/>
    <g fill="#fff"><circle cx="${h.x - 11}" cy="${h.y - 12}" r="9"/><circle cx="${h.x + 11}" cy="${h.y - 12}" r="9"/></g>
    <g fill="#14203a"><circle cx="${h.x - 11}" cy="${h.y - 14}" r="4.5"/><circle cx="${h.x + 11}" cy="${h.y - 14}" r="4.5"/></g></g>`;
}

function boardSVG() {
  let tiles = '', numbers = '';
  for (let n = 1; n <= 100; n++) {
    const c = cell(n);
    tiles += `<rect x="${c.x}" y="${c.y}" width="100" height="100" fill="${n === 100 ? '#ffd23f' : TILE[(n + Math.floor((n - 1) / 10)) % TILE.length]}" stroke="#fff" stroke-width="3"/>`;
    numbers += `<text x="${c.x + 7}" y="${c.y + 29}" font-size="27" font-weight="900" fill="#1d2a55" stroke="#fff" stroke-width="7" stroke-linejoin="round" paint-order="stroke">${n}</text>`;
  }
  tiles += '<text x="50" y="978" font-size="38" text-anchor="middle">▶️</text><text x="50" y="82" font-size="46" text-anchor="middle">🏆</text>';
  return `<svg viewBox="0 0 1000 1000" role="img" aria-label="Snakes and ladders board">${tiles}
    ${Object.entries(LADDERS).map(([a, b]) => ladderSVG(+a, b)).join('')}
    ${Object.entries(SNAKES).map(([a, b], i) => snakeSVG(+a, b, i)).join('')}${numbers}</svg>`;
}

// ---------------------------------------------------------------- screen
// Where several pawns share a square they stand side by side.
const SPREAD = [[0, 8], [-22, -6], [22, -6], [-22, 24], [22, 24], [0, -22], [-30, 8], [30, 8]];

function mount(root, api) {
  root.innerHTML = `
    <div class="sn">
      <div class="sn-board">${boardSVG()}<div class="sn-pawns"></div><div class="sn-call" hidden></div></div>
      <div class="sn-controls">
        <div class="spinner" aria-hidden="true"><div class="wheel">${[1, 2, 3, 4, 5, 6].map(n => `<span style="--a:${(n - 1) * 60 + 30}deg">${n}</span>`).join('')}</div><div class="needle"></div></div>
        <div class="sn-text"><div class="sn-status" aria-live="polite"></div><button class="spinbtn">SPIN! <kbd>Space</kbd></button></div>
      </div>
    </div>`;
  const q = s => root.querySelector(s);
  const layer = q('.sn-pawns'), wheel = q('.wheel'), button = q('.spinbtn'), status = q('.sn-status'), call = q('.sn-call'), svg = q('svg');
  let state = null, shown = [], pawns = [], turned = 0, busy = false, dead = false, sent = false;

  function place(i, x, y) {
    pawns[i].style.left = x / 10 + '%';
    pawns[i].style.top = y / 10 + '%';
  }
  // squares: where each pawn currently appears (0 = waiting beside square 1)
  function arrange() {
    const at = {};
    shown.forEach((n, i) => {
      const k = at[n] = (at[n] || 0) + 1;
      if (n === 0) { place(i, 38 + i * 62, 1034); return; }
      const c = centre(n), crowd = shown.filter(v => v === n).length;
      const [ox, oy] = crowd > 1 ? SPREAD[(k - 1) % SPREAD.length] : [0, 6];
      place(i, c.x + ox, c.y + oy);
    });
  }
  function build() {
    layer.innerHTML = state.players.map(p => `<div class="sn-pawn" style="--c:${p.color}" title="${esc(p.name)}">${p.icon}</div>`).join('');
    pawns = [...layer.children];
  }

  function describe() {
    if (!state) return '';
    if (state.over) return `🏆 ${state.players[state.winners[0]].name} wins!`;
    const p = state.players[state.turn];
    return api.canAct() ? `${p.icon} ${p.name}, it's your turn!` : `Waiting for ${p.icon} ${p.name}…`;
  }
  function refresh() {
    if (busy || !state) return;
    sent = false;
    status.textContent = describe();
    button.disabled = !api.canAct();
    pawns.forEach((el, i) => el.classList.toggle('active', !state.over && i === state.turn));
  }

  function spin() {
    if (busy || sent || !api.canAct()) return;
    sent = true;
    button.disabled = true;
    if (!api.move({ k: 'spin' })) sent = false;
  }
  button.addEventListener('click', spin);
  const onKey = e => {
    if (e.target.matches('input, select, textarea') || document.querySelector('#modal:not(:empty)')) return;
    if (e.code === 'Space' || e.key.toLowerCase() === 'r') { e.preventDefault(); spin(); }
  };
  document.addEventListener('keydown', onKey);

  function shout(text, cls) {
    call.textContent = text; call.className = 'sn-call ' + cls; call.hidden = false;
  }

  // follow the curve of a snake from head to tail
  async function slide(i, head) {
    const path = svg.querySelector('#snake' + head);
    if (!path || document.hidden) return;
    const len = path.getTotalLength();
    pawns[i].classList.add('sliding');
    for (let k = 1; k <= 36 && !dead; k++) {
      const pt = path.getPointAtLength(len * k / 36);
      place(i, pt.x, pt.y);
      await sleep(28);
    }
    pawns[i].classList.remove('sliding');
  }

  async function update(next) {
    const last = next.last;
    state = next;
    if (!last) { reset(next); return; }
    busy = true; button.disabled = true; call.hidden = true;
    const who = state.players[last.seat];
    status.textContent = `${who.icon} ${who.name} is spinning…`;
    // spin the wheel so that the needle (at the top) ends on the number rolled
    const target = 360 - ((last.roll - 1) * 60 + 30);
    turned += 1440 + ((target - turned % 360) + 360) % 360;
    wheel.style.transform = `rotate(${turned}deg)`;
    for (let k = 0; k < 8 && !dead; k++) { sfx.tick(); await sleep(70 + k * 18); }
    await sleep(300);
    status.textContent = `${who.icon} ${who.name} spun a ${last.roll}!`;
    await sleep(350);
    pawns.forEach((el, i) => el.classList.toggle('active', i === last.seat));
    if (last.kind === 'stay') {
      sfx.nope(); shout(`Need exactly ${100 - last.from}!`, 'bad');
    } else {
      for (let n = last.from + 1; n <= last.land && !dead; n++) {
        shown[last.seat] = n; arrange(); sfx.hop();
        pawns[last.seat].classList.remove('hop'); void pawns[last.seat].offsetWidth; pawns[last.seat].classList.add('hop');
        await sleep(230);
      }
      if (last.kind === 'ladder') {
        await sleep(250); shout('🪜 Ladder! Up you go!', 'good'); sfx.climb();
        pawns[last.seat].classList.add('climbing'); shown[last.seat] = last.to; arrange();
        await sleep(900); pawns[last.seat].classList.remove('climbing');
      } else if (last.kind === 'snake') {
        await sleep(250); shout('🐍 Snake! Wheee!', 'bad'); sfx.slide();
        await slide(last.seat, last.land);
        shown[last.seat] = last.to; arrange();
      }
    }
    if (dead) return;
    await sleep(last.kind === 'move' ? 150 : 900);
    shown = state.players.map(p => p.pos); arrange();
    call.hidden = true; busy = false;
    refresh();
  }

  function reset(next) {
    state = next; busy = false;
    if (pawns.length !== state.players.length) build();
    shown = state.players.map(p => p.pos);
    arrange();
    call.hidden = true;
    refresh();
  }

  return {
    reset, update, refresh,
    status: (s, i) => (s.players[i].pos ? `Square ${s.players[i].pos}` : 'Start'),
    destroy() { dead = true; document.removeEventListener('keydown', onKey); root.innerHTML = ''; },
  };
}

Core.register({
  id: 'snakes', name: 'Snakes & Ladders', emoji: '🐍', color: '#2fbf71',
  blurb: 'Climb the ladders, dodge the snakes, race to 100.',
  min: 2, max: 8, levels: false,
  rules: [
    'Take turns spinning. Move forward that many squares.',
    'Land at the bottom of a ladder to climb up. Land on a snake’s head to slide down.',
    'The first player to reach square 100 wins. It is all luck, so anyone can win!',
  ],
  options: [
    { key: 'finish', type: 'select', label: 'To finish', default: 'exact', choices: [['exact', 'Need the exact number (standard)'], ['any', 'Any number that reaches 100 wins']] },
    { key: 'bonus6', type: 'check', label: 'Spin a 6, go again', help: 'Adds an extra turn after a 6.', default: false },
  ],
  create, exec,
  turn: s => s.turn,
  bot: () => ({ k: 'spin' }),
  view: s => s,   // nothing is secret in this game
  mount,
  LADDERS, SNAKES,
});
})();
