/* Candy Trail: draw a colour card and hop along a sweet path to the castle. Rules first, then the screen. */
(() => {
'use strict';
const { esc, sleep, sfx } = Core;

const COLORS = {
  red: ['#ff4d5e', 'Red'], orange: ['#ff9a2e', 'Orange'], yellow: ['#ffd93b', 'Yellow'],
  green: ['#35c26b', 'Green'], blue: ['#3d8bfd', 'Blue'], purple: ['#9b5cf0', 'Purple'],
};
const ORDER = Object.keys(COLORS);
const LEN = 84, END = LEN + 1;   // path squares are 1..84, the castle is 85, the start is 0
const TREATS = { 9: ['🧁', 'Cupcake Corner'], 22: ['🍭', 'Lollipop Grove'], 37: ['🍬', 'Gumdrop Hill'], 52: ['🍦', 'Ice Cream Peak'], 66: ['🍪', 'Cookie Cottage'], 76: ['🍩', 'Donut Meadow'] };
const SLIDES = { 6: 23, 34: 50 };        // rainbow shortcuts: land at the bottom, zoom ahead
const STICKY = [28, 45, 70];             // caramel puddles: miss a turn

const SQUARES = [];
for (let n = 1, c = 0; n <= LEN; n++) SQUARES[n] = TREATS[n] ? null : ORDER[c++ % ORDER.length];

// ---------------------------------------------------------------- rules
function newDeck(rng) {
  const deck = [];
  ORDER.forEach(c => { for (let i = 0; i < 6; i++) deck.push({ c, n: 1 }); for (let i = 0; i < 3; i++) deck.push({ c, n: 2 }); });
  Object.keys(TREATS).forEach(at => deck.push({ treat: +at }));
  for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  return deck;
}

function create(players, opts, rng = Math.random) {
  return {
    players: players.map(p => ({ name: p.name, icon: p.icon, color: p.color, pos: 0, stuck: false })),
    opts: { gentle: !!opts.gentle },
    deck: newDeck(rng), turn: 0, seq: 0, last: null, over: false, winners: [], log: ['Draw a card to start down the trail!'],
  };
}

const cardName = card => (card.treat ? TREATS[card.treat][1] : `${card.n === 2 ? 'Double ' : ''}${COLORS[card.c][1]}`);

function target(pos, card) {
  if (card.treat) return card.treat;
  let left = card.n;
  for (let i = pos + 1; i <= LEN; i++) if (SQUARES[i] === card.c && --left === 0) return i;
  return END;
}

function nextTurn(s) {
  for (let guard = 0; guard <= s.players.length * 2; guard++) {
    s.turn = (s.turn + 1) % s.players.length;
    const p = s.players[s.turn];
    if (!p.stuck) return;
    p.stuck = false;
    s.log.push(`${p.name} is stuck in caramel and misses this turn.`);
  }
}

function exec(s, seat, move, rng = Math.random) {
  if (s.over) return 'The game is over.';
  if (seat !== s.turn) return "It isn't your turn.";
  if (!move || move.k !== 'draw') return 'Unknown move.';
  const p = s.players[seat], from = p.pos;
  let card;
  for (let tries = 0; tries < 80; tries++) {
    if (!s.deck.length) s.deck = newDeck(rng);
    card = s.deck.pop();
    // gentle mode: a treat card that would send you backwards is quietly swapped for another card
    if (!(s.opts.gentle && card.treat && card.treat < from)) break;
  }
  const land = target(from, card);
  let to = land, kind = 'move';
  if (card.treat) kind = land < from ? 'back' : 'treat';
  else if (SLIDES[land]) { to = SLIDES[land]; kind = 'slide'; }
  else if (STICKY.includes(land)) { kind = 'sticky'; p.stuck = true; }
  p.pos = to;
  s.last = { seat, card, from, land, to, kind };
  s.log.push(card.treat ? `${p.name} drew ${cardName(card)} ${TREATS[card.treat][0]} and ${kind === 'back' ? 'went back' : 'jumped ahead'}!`
    : to === END ? `${p.name} drew ${cardName(card)} and reached the castle!`
      : kind === 'slide' ? `${p.name} drew ${cardName(card)} and zoomed up a rainbow slide! 🌈`
        : kind === 'sticky' ? `${p.name} drew ${cardName(card)} and landed in sticky caramel!`
          : `${p.name} drew ${cardName(card)}.`);
  if (to === END) { s.over = true; s.winners = [seat]; s.log.push(`🏆 ${p.name} wins!`); } else nextTurn(s);
  if (s.log.length > 60) s.log.splice(0, s.log.length - 60);
  s.seq++;
  return null;
}

// ---------------------------------------------------------------- board geometry (1000 x 1000)
// A winding trail: six wavy rows joined by round bends, with the squares spaced evenly along it.
function trailPoints() {
  const ys = [905, 752, 599, 446, 293, 140], left = 150, right = 850, line = [];
  ys.forEach((y, row) => {
    const dir = row % 2 ? -1 : 1, a = dir > 0 ? left : right, b = dir > 0 ? right : left;
    for (let i = 0; i <= 70; i++) { const x = a + (b - a) * i / 70; line.push({ x, y: y + Math.sin((x - left) / (right - left) * Math.PI * 4) * 17 }); }
    if (row < ys.length - 1) {
      const cy = (y + ys[row + 1]) / 2, r = (y - ys[row + 1]) / 2;
      for (let i = 1; i < 30; i++) { const t = Math.PI * i / 30; line.push({ x: b + dir * Math.sin(t) * r, y: cy + Math.cos(t) * r }); }
    }
  });
  const dist = [0];
  for (let i = 1; i < line.length; i++) dist[i] = dist[i - 1] + Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y);
  const total = dist[dist.length - 1], out = [];
  for (let n = 1, j = 0; n <= LEN; n++) {
    const want = total * (n - 1) / (LEN - 1);
    while (j < dist.length - 2 && dist[j + 1] < want) j++;
    const t = (want - dist[j]) / (dist[j + 1] - dist[j] || 1);
    out[n] = { x: line[j].x + (line[j + 1].x - line[j].x) * t, y: line[j].y + (line[j + 1].y - line[j].y) * t };
  }
  out[0] = { x: 62, y: 952 };
  out[END] = { x: 74, y: 100 };
  return out;
}
const PTS = trailPoints();

function boardSVG() {
  const road = PTS.slice(1, END).map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('');
  const slides = Object.entries(SLIDES).map(([a, b]) => {
    const p = PTS[a], q = PTS[b], mx = (p.x + q.x) / 2 + (p.x < 500 ? 95 : -95), my = (p.y + q.y) / 2;
    return ['#ff4d5e', '#ffd93b', '#35c26b', '#3d8bfd'].map((c, i) => `<path d="M${p.x} ${p.y} Q${mx + (i - 1.5) * 9} ${my} ${q.x} ${q.y}" fill="none" stroke="${c}" stroke-width="9" stroke-linecap="round" opacity=".92" stroke-dasharray="${i % 2 ? '20 6' : 'none'}"/>`).join('') +
      `<text x="${(p.x + 2 * mx + q.x) / 4}" y="${my + 12}" font-size="40" text-anchor="middle">🌈</text>`;
  }).join('');
  let squares = '';
  for (let n = 1; n <= LEN; n++) {
    const p = PTS[n];
    if (TREATS[n]) squares += `<circle cx="${p.x}" cy="${p.y}" r="37" fill="#fff" stroke="#ff5fa8" stroke-width="8"/><text x="${p.x}" y="${p.y + 16}" font-size="46" text-anchor="middle">${TREATS[n][0]}</text>`;
    else {
      squares += `<circle cx="${p.x}" cy="${p.y}" r="31" fill="${COLORS[SQUARES[n]][0]}" stroke="#fff" stroke-width="6"/>`;
      if (STICKY.includes(n)) squares += `<ellipse cx="${p.x}" cy="${p.y}" rx="22" ry="18" fill="#a5651f" opacity=".95"/><text x="${p.x}" y="${p.y + 10}" font-size="28" text-anchor="middle">🍯</text>`;
    }
  }
  const sprinkles = Array.from({ length: 90 }, (_, i) => `<rect x="${(i * 137) % 980}" y="${(i * 241) % 980}" width="16" height="5" rx="2.5" transform="rotate(${(i * 53) % 180} ${(i * 137) % 980} ${(i * 241) % 980})" fill="${COLORS[ORDER[i % 6]][0]}" opacity=".45"/>`).join('');
  const names = Object.entries(TREATS).map(([n, [, name]]) => `<text x="${PTS[n].x}" y="${PTS[n].y + 62}" font-size="21" font-weight="900" text-anchor="middle" fill="#7a1f56" stroke="#fff" stroke-width="6" paint-order="stroke">${name}</text>`).join('');
  return `<svg viewBox="0 0 1000 1000" role="img" aria-label="Candy Trail board"><rect width="1000" height="1000" fill="#ffe3f1"/>${sprinkles}
    <path d="${road}" fill="none" stroke="#fff" stroke-width="76" stroke-linecap="round" stroke-linejoin="round"/>
    ${squares}${slides}${names}
    <text x="74" y="130" font-size="104" text-anchor="middle">🏰</text>
    <text x="62" y="990" font-size="24" font-weight="900" text-anchor="middle" fill="#7a1f56">START</text></svg>`;
}

// ---------------------------------------------------------------- screen
const SPREAD = [[0, 0], [-20, -16], [20, -16], [-20, 18], [20, 18], [0, -30], [-34, 2], [34, 2]];

const cardFace = card => (card.treat
  ? `<span class="ct-treat">${TREATS[card.treat][0]}</span><small>${TREATS[card.treat][1]}</small>`
  : `<span class="ct-dots">${Array.from({ length: card.n }, () => `<i style="background:${COLORS[card.c][0]}"></i>`).join('')}</span><small>${card.n === 2 ? '2 × ' : ''}${COLORS[card.c][1]}</small>`);

function mount(root, api) {
  root.innerHTML = `
    <div class="gstage">
      <div class="gboard ct-board">${boardSVG()}<div class="pawns"></div><div class="callout" hidden></div></div>
      <div class="gcontrols">
        <div class="ct-card back"><span class="ct-treat">🍬</span></div>
        <div class="gtext"><div class="gstatus" aria-live="polite"></div><button class="bigbtn">Draw a card <kbd>Space</kbd></button></div>
      </div>
    </div>`;
  const q = s => root.querySelector(s);
  const layer = q('.pawns'), button = q('.bigbtn'), status = q('.gstatus'), call = q('.callout'), cardEl = q('.ct-card');
  let state = null, shown = [], pawns = [], busy = false, dead = false, sent = false;

  function arrange() {
    const at = {};
    shown.forEach((n, i) => {
      const k = at[n] = (at[n] || 0) + 1;
      const crowd = shown.filter(v => v === n).length;
      let [ox, oy] = crowd > 1 ? SPREAD[(k - 1) % SPREAD.length] : [0, -8];
      if (n === 0) [ox, oy] = [(i % 4) * 34 - 20, -Math.floor(i / 4) * 40 - 18];
      pawns[i].style.left = (PTS[n].x + ox) / 10 + '%';
      pawns[i].style.top = (PTS[n].y + oy) / 10 + '%';
    });
  }
  function build() {
    layer.innerHTML = state.players.map(p => `<div class="pawn" style="--c:${p.color}" title="${esc(p.name)}">${p.icon}</div>`).join('');
    pawns = [...layer.children];
  }
  function showCard(card) {
    cardEl.className = 'ct-card' + (card ? ' flip' : ' back');
    cardEl.innerHTML = card ? cardFace(card) : '<span class="ct-treat">🍬</span>';
    cardEl.setAttribute('aria-label', card ? 'Card: ' + cardName(card) : 'Card deck');
  }
  function refresh() {
    if (busy || !state) return;
    sent = false;
    const p = state.players[state.turn];
    status.textContent = state.over ? `🏆 ${state.players[state.winners[0]].name} reached the castle!`
      : api.canAct() ? `${p.icon} ${p.name}, draw a card!` : `Waiting for ${p.icon} ${p.name}…`;
    button.disabled = !api.canAct();
    pawns.forEach((el, i) => el.classList.toggle('active', !state.over && i === state.turn));
  }
  function draw() {
    if (busy || sent || !api.canAct()) return;
    sent = true; button.disabled = true;
    if (!api.move({ k: 'draw' })) sent = false;
  }
  button.addEventListener('click', draw);
  const onKey = e => {
    if (e.target.matches('input, select, textarea') || document.querySelector('#modal:not(:empty)')) return;
    if (e.code === 'Space' || e.key.toLowerCase() === 'r') { e.preventDefault(); draw(); }
  };
  document.addEventListener('keydown', onKey);
  const shout = (text, cls) => { call.textContent = text; call.className = 'callout ' + cls; call.hidden = false; };

  async function update(next) {
    const last = next.last;
    state = next;
    if (!last) { reset(next); return; }
    busy = true; button.disabled = true; call.hidden = true;
    const who = state.players[last.seat];
    showCard(null); void cardEl.offsetWidth; showCard(last.card); sfx.card();
    status.textContent = `${who.icon} ${who.name} drew ${cardName(last.card)}`;
    pawns.forEach((el, i) => el.classList.toggle('active', i === last.seat));
    await sleep(850);
    const mover = pawns[last.seat];
    if (last.card.treat) {
      shout(`${TREATS[last.card.treat][0]} To ${TREATS[last.card.treat][1]}!`, last.kind === 'back' ? 'bad' : 'good');
      if (last.kind === 'back') sfx.slide(); else sfx.climb();
      mover.classList.add('flying'); shown[last.seat] = last.to; arrange();
      await sleep(1000); mover.classList.remove('flying');
    } else {
      const stop = last.land;
      for (let n = last.from + 1; n <= stop && !dead; n++) {
        shown[last.seat] = n; arrange(); sfx.hop();
        mover.classList.remove('hop'); void mover.offsetWidth; mover.classList.add('hop');
        await sleep(Math.max(80, 220 - (stop - last.from) * 7));
      }
      if (last.kind === 'slide') {
        shout('🌈 Rainbow slide!', 'good'); sfx.climb();
        mover.classList.add('flying'); shown[last.seat] = last.to; arrange();
        await sleep(1000); mover.classList.remove('flying');
      } else if (last.kind === 'sticky') { shout('🍯 Sticky! Miss a turn', 'bad'); sfx.nope(); await sleep(800); }
    }
    if (dead) return;
    await sleep(last.kind === 'move' ? 150 : 600);
    shown = state.players.map(p => p.pos); arrange();
    call.hidden = true; busy = false;
    refresh();
  }

  function reset(next) {
    state = next; busy = false;
    if (pawns.length !== state.players.length) build();
    shown = state.players.map(p => p.pos);
    arrange(); call.hidden = true;
    showCard(state.last ? state.last.card : null);
    refresh();
  }

  return {
    reset, update, refresh,
    status: (s, i) => (s.players[i].stuck ? '🍯 Stuck' : s.players[i].pos >= END ? '🏰' : s.players[i].pos ? `${END - s.players[i].pos} to go` : 'Start'),
    destroy() { dead = true; document.removeEventListener('keydown', onKey); root.innerHTML = ''; },
  };
}

Core.register({
  id: 'candy', name: 'Candy Trail', emoji: '🍭', color: '#ff5fa8',
  blurb: 'Draw colour cards and race down a sweet path to the castle.',
  min: 2, max: 8, levels: false,
  rules: [
    'Draw a card. Hop to the next square of that colour. Two dots means the second one.',
    'A treat card jumps you straight to that treat, even if it is behind you.',
    'Rainbow slides are shortcuts. Caramel puddles make you miss a turn. First to the castle wins!',
  ],
  options: [{ key: 'gentle', type: 'check', label: 'Gentle mode', help: 'Treat cards never send anyone backwards.', default: false }],
  create, exec,
  turn: s => s.turn,
  bot: () => ({ k: 'draw' }),
  view: s => Object.assign({}, s, { deck: [] }),   // nobody gets to peek at the deck
  mount,
  LEN, END, SQUARES, TREATS, SLIDES, STICKY,
});
})();
