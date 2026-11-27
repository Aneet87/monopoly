/* Memory Match: flip two cards, keep the pairs you find. Rules first, then the screen. */
(() => {
'use strict';
const { esc, sleep, sfx } = Core;

const FACES = ['🐶', '🐱', '🦁', '🐸', '🐵', '🐧', '🦄', '🐙', '🦋', '🐢', '🐳', '🦖', '🍎', '🍌', '🍓', '🍕', '🍩', '🍦', '⚽', '🚀', '🌈', '🌻', '🎈', '🎸', '🚂', '⭐', '🔑', '👑'];
const SIZES = { small: 12, medium: 18, large: 24 };   // pairs

function create(players, opts, rng = Math.random) {
  const pairs = SIZES[opts.size] || SIZES.medium;
  const faces = Cards.shuffle(FACES.slice(), rng).slice(0, pairs);
  return {
    players: players.map(p => ({ name: p.name, icon: p.icon, color: p.color, pairs: 0 })),
    cards: Cards.shuffle(faces.concat(faces), rng).map(face => ({ face, owner: null })),
    open: [], history: [], turn: 0, seq: 0, last: null, over: false, winners: [], log: ['Flip two cards. Find a matching pair!'],
  };
}

function exec(s, seat, move) {
  if (s.over) return 'The game is over.';
  if (seat !== s.turn) return "It isn't your turn.";
  const i = move && move.i;
  if (!move || move.k !== 'flip' || !Number.isInteger(i) || !s.cards[i]) return 'Unknown move.';
  if (s.cards[i].owner !== null || s.open.includes(i)) return 'Pick a card that is face down.';
  s.history.push(i);
  if (s.history.length > 200) s.history.shift();
  if (!s.open.length) {
    s.open = [i];
    s.last = { type: 'first', seat, i, face: s.cards[i].face };
  } else {
    const a = s.open[0], match = s.cards[a].face === s.cards[i].face, p = s.players[seat];
    s.open = [];
    s.last = { type: 'second', seat, a, i, faces: [s.cards[a].face, s.cards[i].face], match };
    if (match) {
      s.cards[a].owner = s.cards[i].owner = seat;
      p.pairs++;
      s.log.push(`${p.name} found a pair of ${s.cards[i].face}!`);
      if (s.cards.every(c => c.owner !== null)) {
        s.over = true;
        const best = Math.max(...s.players.map(x => x.pairs));
        s.winners = s.players.map((x, k) => (x.pairs === best ? k : -1)).filter(k => k >= 0);
        s.log.push(`🏆 Most pairs: ${s.winners.map(k => s.players[k].name).join(' & ')} with ${best}.`);
      }
    } else {
      s.log.push(`${p.name} turned ${s.last.faces.join(' and ')}. No match.`);
      s.turn = (s.turn + 1) % s.players.length;
    }
    if (s.log.length > 60) s.log.splice(0, s.log.length - 60);
  }
  s.seq++;
  return null;
}

// Face-down cards are not sent to anyone, so nobody can peek.
const view = s => Object.assign({}, s, { cards: s.cards.map((c, i) => (c.owner !== null || s.open.includes(i) ? c : { face: null, owner: null })) });

// Computers only "remember" cards that have been turned over, and they forget like people do.
// back = how many recent flips they can still recall; keep = the chance each one is remembered right now.
const MEMORY = { easy: { back: 4, keep: .35 }, medium: { back: 8, keep: .55 }, hard: { back: 18, keep: .8 } };
function bot(s, seat, level, rng = Math.random) {
  const down = s.cards.map((c, i) => i).filter(i => s.cards[i].owner === null && !s.open.includes(i));
  const memory = MEMORY[level] || MEMORY.medium;
  const known = [...new Set(s.history.slice(-memory.back))].filter(i => down.includes(i) && rng() < memory.keep);
  const pick = list => list[Math.floor(rng() * list.length)];
  const unseen = down.filter(i => !known.includes(i));
  if (s.open.length) {
    const want = s.cards[s.open[0]].face, found = known.find(i => s.cards[i].face === want);
    return { k: 'flip', i: found !== undefined ? found : pick(unseen.length ? unseen : down) };
  }
  const pair = known.find(i => known.some(j => j !== i && s.cards[j].face === s.cards[i].face));
  return { k: 'flip', i: pair !== undefined ? pair : pick(unseen.length ? unseen : down) };
}

function mount(root, api) {
  root.innerHTML = '<div class="gstage mm"><div class="gstatus center" aria-live="polite"></div><div class="mm-wrap"><div class="mm-grid"></div><div class="callout" hidden></div></div></div>';
  const q = x => root.querySelector(x);
  const grid = q('.mm-grid'), status = q('.gstatus'), call = q('.callout');
  let state = null, busy = false, dead = false, sent = false, els = [];

  function build() {
    grid.className = `mm-grid n${state.cards.length}`;
    grid.innerHTML = state.cards.map((c, i) => `<button class="mm-card" data-i="${i}"><span class="inner"><span class="front"></span><span class="rear">?</span></span></button>`).join('');
    els = [...grid.children];
  }
  // show card i face up with `face`, or face down when face is null
  function paint(i, face, owner) {
    const el = els[i];
    if (face) el.querySelector('.front').textContent = face;
    el.classList.toggle('up', !!face);
    el.classList.toggle('done', owner !== null && owner !== undefined);
    el.style.setProperty('--c', owner !== null && owner !== undefined ? state.players[owner].color : 'transparent');
    el.setAttribute('aria-label', face ? `Card ${i + 1}: ${face}` : `Card ${i + 1}, face down`);
  }
  const paintAll = () => state.cards.forEach((c, i) => paint(i, c.owner !== null || state.open.includes(i) ? c.face : null, c.owner));

  grid.addEventListener('click', e => {
    const b = e.target.closest('.mm-card');
    if (!b || busy || sent || !api.canAct()) return;
    const i = +b.dataset.i;
    if (state.cards[i].owner !== null || state.open.includes(i)) return;
    sent = true;
    if (!api.move({ k: 'flip', i })) sent = false;
  });

  function refresh() {
    if (busy || !state) return;
    sent = false;
    const p = state.players[state.turn], me = api.canAct();
    status.textContent = state.over ? `🏆 ${state.winners.map(i => state.players[i].name).join(' & ')} found the most pairs!`
      : me ? `${p.icon} ${p.name}, flip ${state.open.length ? 'one more card' : 'a card'}!` : `${p.icon} ${p.name} is looking…`;
    grid.classList.toggle('live', me);
  }

  async function update(next) {
    const last = next.last;
    state = next;
    if (!last) { reset(next); return; }
    busy = true;
    sfx.card();
    if (last.type === 'first') {
      paint(last.i, last.face, null);
      await sleep(450);
    } else {
      paint(last.a, last.faces[0], null);
      paint(last.i, last.faces[1], null);
      await sleep(600);
      call.textContent = last.match ? '🎉 A pair!' : 'No match';
      call.className = 'callout ' + (last.match ? 'good' : 'miss');
      call.hidden = false;
      if (last.match) sfx.climb(); else sfx.nope();
      await sleep(last.match ? 800 : 1300);   // time to remember where they were
      call.hidden = true;
    }
    if (dead) return;
    paintAll();
    busy = false;
    refresh();
  }
  function reset(next) {
    state = next; busy = false; call.hidden = true;
    if (els.length !== state.cards.length) build();
    paintAll();
    refresh();
  }

  return { reset, update, refresh, status: (s, i) => `${s.players[i].pairs} pair${s.players[i].pairs === 1 ? '' : 's'}`, destroy() { dead = true; root.innerHTML = ''; } };
}

Core.register({
  id: 'memory', name: 'Memory Match', emoji: '🧠', color: '#a45cf0',
  blurb: 'Flip cards, remember where they are, and collect pairs.',
  min: 2, max: 8, levels: true,
  rules: ['Flip two cards on your turn.', 'If they match, you keep the pair and go again. If not, they turn back over.', 'When every pair is found, the most pairs wins.'],
  options: [{ key: 'size', type: 'select', label: 'Board size', default: 'medium', choices: [['small', 'Small: 24 cards'], ['medium', 'Medium: 36 cards'], ['large', 'Large: 48 cards']] }],
  create, exec, view, bot,
  turn: s => s.turn,
  mount,
});
})();
