/* Go Fish: ask other players for cards and collect sets. Rules first, then computer players, then the screen. */
(() => {
'use strict';
const { esc, sleep, sfx } = Core;
const { rank, plural } = Cards;

// ---------------------------------------------------------------- rules
function create(players, opts, rng = Math.random) {
  const size = opts.pairs ? 2 : 4, deal = players.length <= 3 ? 7 : 5;
  const pool = Cards.deck(1, rng);
  const s = {
    players: players.map(p => ({ name: p.name, icon: p.icon, color: p.color, hand: pool.splice(0, deal), books: [] })),
    pool, size, asks: [], turn: 0, seq: 0, last: null, over: false, winners: [],
    log: [`Collect sets of ${size === 4 ? 'four' : 'two'} matching cards.`],
  };
  s.players.forEach((p, i) => collect(s, i));
  settle(s);
  count(s);
  return s;
}
// public card counts, so screens can show them without seeing the cards
function count(s) { s.players.forEach(p => { p.n = p.hand.length; }); s.left = s.pool.length; }

// Lay down every complete set in a hand. Returns the ranks laid down.
function collect(s, i) {
  const p = s.players[i], made = [];
  for (let r = 0; r < 13; r++) {
    let have = p.hand.filter(c => rank(c) === r);
    while (have.length >= s.size) {
      const set = have.slice(0, s.size);
      p.hand = p.hand.filter(c => !set.includes(c));
      p.books.push(r); made.push(r);
      s.log.push(`${p.name} made a set of ${plural(r)}! 📚`);
      have = have.slice(s.size);
    }
  }
  return made;
}
const targets = (s, seat) => s.players.map((p, i) => i).filter(i => i !== seat && s.players[i].hand.length);
const totalSets = s => 52 / s.size;

// Make sure the player whose turn it is can actually do something, or the game is over.
function settle(s) {
  for (let guard = 0; guard < 200; guard++) {
    if (s.players.reduce((n, p) => n + p.books.length, 0) >= totalSets(s)) { finish(s); return; }
    const p = s.players[s.turn];
    if (!p.hand.length && s.pool.length) {
      p.hand.push(s.pool.pop());
      s.log.push(`${p.name} had no cards and drew one.`);
      if (collect(s, s.turn).length) continue;
    }
    if (p.hand.length && targets(s, s.turn).length) return;
    // nothing to ask for: take a card if there is one, and pass the turn on
    if (p.hand.length && s.pool.length) { p.hand.push(s.pool.pop()); collect(s, s.turn); }
    s.turn = (s.turn + 1) % s.players.length;
  }
  finish(s);
}
function finish(s) {
  s.over = true;
  const best = Math.max(...s.players.map(p => p.books.length));
  s.winners = s.players.map((p, i) => (p.books.length === best ? i : -1)).filter(i => i >= 0);
  s.log.push(`🏆 Most sets: ${s.winners.map(i => s.players[i].name).join(' & ')} with ${best}.`);
}

function exec(s, seat, move) {
  if (s.over) return 'The game is over.';
  if (seat !== s.turn) return "It isn't your turn.";
  if (!move || move.k !== 'ask') return 'Unknown move.';
  const me = s.players[seat], them = s.players[move.who], r = move.rank;
  if (!targets(s, seat).includes(move.who)) return 'Choose another player who has cards.';
  if (!me.hand.some(c => rank(c) === r)) return 'You can only ask for a card you hold.';
  const given = them.hand.filter(c => rank(c) === r);
  const last = { seat, who: move.who, rank: r, got: given.length, fished: false, lucky: false, drew: null, sets: [] };
  s.log.push(`${me.name} asked ${them.name} for ${plural(r)}.`);
  let again = false;
  if (given.length) {
    them.hand = them.hand.filter(c => rank(c) !== r);
    me.hand.push(...given);
    s.log.push(`${them.name} handed over ${given.length}. ${me.name} goes again.`);
    again = true;
  } else {
    last.fished = true;
    if (s.pool.length) {
      const card = s.pool.pop();
      me.hand.push(card); last.drew = card;
      last.lucky = rank(card) === r;
      again = last.lucky;
      s.log.push(last.lucky ? `Go Fish! ${me.name} fished the very card they wanted and goes again.` : `Go Fish! ${me.name} drew a card.`);
    } else s.log.push('Go Fish! The pond is empty.');
  }
  s.asks.push({ by: seat, who: move.who, rank: r, got: given.length });
  if (s.asks.length > 60) s.asks.shift();
  last.sets = collect(s, seat);
  s.last = last;
  if (!again) s.turn = (s.turn + 1) % s.players.length;
  settle(s);
  count(s);
  if (s.log.length > 60) s.log.splice(0, s.log.length - 60);
  s.seq++;
  return null;
}

// Each device gets only its own hands. The card someone fished up is private too, unless it was the one they asked for.
function view(s, seats) {
  const last = s.last && !s.last.lucky && !seats.includes(s.last.seat) ? Object.assign({}, s.last, { drew: null }) : s.last;
  return Object.assign({}, s, { last, pool: [], players: s.players.map((p, i) => (s.over || seats.includes(i) ? p : Object.assign({}, p, { hand: [] }))) });
}

// ---------------------------------------------------------------- computer players
// They work out who probably holds what from the questions everyone has heard.
function clues(s, depth) {
  const holds = s.players.map(() => new Set());
  s.asks.slice(-depth).forEach(a => {
    holds[a.who].delete(a.rank);
    holds[a.by].add(a.rank);
  });
  s.players.forEach((p, i) => p.books.forEach(r => { if (s.size === 4) holds[i].delete(r); }));
  return holds;
}
function bot(s, seat, level, rng = Math.random) {
  const hand = s.players[seat].hand, others = targets(s, seat);
  const mine = {};
  hand.forEach(c => { mine[rank(c)] = (mine[rank(c)] || 0) + 1; });
  const ranks = Object.keys(mine).map(Number);
  const pick = list => list[Math.floor(rng() * list.length)];
  if (level !== 'easy') {
    const holds = clues(s, level === 'hard' ? 60 : 7), sure = [];
    others.forEach(who => ranks.forEach(r => { if (holds[who].has(r)) sure.push({ who, rank: r, score: mine[r] + rng() * .1 }); }));
    if (sure.length) { sure.sort((a, b) => b.score - a.score); return { k: 'ask', who: sure[0].who, rank: sure[0].rank }; }
  }
  let choices = ranks;
  let who = pick(others);
  if (level === 'hard') {
    // go for the rank closest to a set, and ask someone who has not just said no to it
    const top = Math.max(...ranks.map(r => mine[r]));
    choices = rng() < .7 ? ranks.filter(r => mine[r] === top) : ranks;
    const r = pick(choices);
    const recentNo = new Set(s.asks.slice(-8).filter(a => a.rank === r && !a.got).map(a => a.who));
    const fresh = others.filter(o => !recentNo.has(o));
    const pool = fresh.length ? fresh : others;
    who = pool.reduce((a, b) => (s.players[b].hand.length > s.players[a].hand.length ? b : a));
    return { k: 'ask', who, rank: r };
  }
  return { k: 'ask', who, rank: pick(choices) };
}

// ---------------------------------------------------------------- screen
function mount(root, api) {
  root.innerHTML = `
    <div class="gstage tbl pond">
      <div class="tbl-top"><div class="seats"></div></div>
      <div class="felt"><div class="pile"></div><div class="said" aria-live="polite"></div><div class="callout" hidden></div></div>
      <div class="gstatus center" aria-live="polite"></div><div class="tbl-help"></div>
      <div class="handwrap"></div>
      <div class="tbl-actions"></div>
    </div>`;
  const q = x => root.querySelector(x);
  const seatsEl = q('.seats'), pile = q('.pile'), said = q('.said'), status = q('.gstatus'), help = q('.tbl-help'), handEl = q('.handwrap'), actions = q('.tbl-actions'), call = q('.callout');
  const secret = Cards.privacy(api);
  let state = null, busy = false, dead = false, sent = false, signature = '', wantRank = null, wantWho = null;
  const nm = i => `${state.players[i].icon} ${state.players[i].name}`;

  function setsText(p) { return p.books.length ? p.books.slice().sort((a, b) => a - b).map(r => Cards.RANKS[r]).join(' ') : '—'; }

  function draw() {
    if (!state || dead) return;
    actions.innerHTML = ''; handEl.innerHTML = ''; help.textContent = '';
    const w = secret.where(state.turn, state.over);
    const seat = w.seat, acting = seat !== null && !w.handoff && api.canAct(seat);
    const others = state.players.map((p, i) => i).filter(i => i !== seat && state.players[i].n);
    if (acting) {
      if (!state.players[seat].hand.some(c => rank(c) === wantRank)) wantRank = null;
      if (!others.includes(wantWho)) wantWho = others.length === 1 ? others[0] : null;
    }
    seatsEl.innerHTML = state.players.map((p, i) => {
      const can = acting && others.includes(i);
      return `<button class="opp ${state.turn === i && !state.over ? 'turn' : ''} ${can ? 'can' : ''} ${acting && wantWho === i ? 'sel' : ''}" data-who="${i}" ${can ? '' : 'disabled'} style="--c:${p.color}">
        <span class="oi">${p.icon}</span><span class="on">${esc(p.name)}${seat === i ? ' (you)' : ''}</span><span class="om">🂠 ${p.n} · 📚 ${p.books.length}</span><span class="os">${setsText(p)}</span></button>`;
    }).join('');
    pile.innerHTML = `${state.left ? Cards.back('stack') : '<span class="pcard empty">empty</span>'}<small>Pond: ${state.left}</small>`;
    const l = state.last;
    said.textContent = !l ? 'Ask someone for a card you already hold.'
      : l.got ? `${state.players[l.who].name} gave ${state.players[l.seat].name} their ${plural(l.rank)} (${l.got} card${l.got > 1 ? 's' : ''}).` : `${state.players[l.seat].name} asked ${state.players[l.who].name} for ${plural(l.rank)}. Go Fish!`;

    if (w.cover !== undefined) {
      handEl.innerHTML = Cards.coverHTML(state.players[w.cover].name);
      status.textContent = `${nm(w.cover)}, it's your turn`;
      Cards.button(actions, `I'm ${state.players[w.cover].name}: show my cards`, 'bigbtn', () => { secret.reveal(w.cover); draw(); });
      return;
    }
    if (seat !== null) {
      const fresh = l && l.drew !== null && l.seat === seat ? l.drew : -1;
      handEl.innerHTML = `<div class="hand">${Cards.sortHand(state.players[seat].hand).map(c => Cards.face(c, { button: true, cls: `${acting && rank(c) === wantRank ? 'sel' : ''} ${c === fresh ? 'fresh' : ''}`, attrs: `data-rank="${rank(c)}" ${acting ? '' : 'tabindex="-1"'}` })).join('') || '<span class="empty">No cards right now.</span>'}</div>`;
    }
    status.textContent = state.over ? `🏆 ${state.winners.map(i => state.players[i].name).join(' & ')} made the most sets!`
      : acting ? `${nm(seat)}, your turn!` : `Waiting for ${nm(state.turn)}…`;
    if (acting) {
      help.textContent = wantRank === null ? 'Tap one of your cards to choose what to ask for.' : wantWho === null ? `Now tap who to ask for ${plural(wantRank)}.` : '';
      Cards.button(actions, wantRank !== null && wantWho !== null ? `Ask ${state.players[wantWho].name} for ${plural(wantRank)}` : 'Ask', 'bigbtn', () => {
        if (sent) return;
        sent = true;
        if (!api.move({ k: 'ask', who: wantWho, rank: wantRank }, seat)) sent = false;
      }, wantRank === null || wantWho === null);
    }
    if (w.handoff) Cards.button(actions, w.next !== null ? `Hide my cards and pass to ${state.players[w.next].name}` : 'Hide my cards', 'bigbtn', () => { secret.hide(); draw(); });
  }
  seatsEl.addEventListener('click', e => { const b = e.target.closest('.opp'); if (b && !b.disabled) { wantWho = +b.dataset.who; sfx.tick(); draw(); } });
  handEl.addEventListener('click', e => {
    const b = e.target.closest('.pcard[data-rank]');
    const w = state && secret.where(state.turn, state.over);
    if (b && !busy && w.seat !== null && !w.handoff && api.canAct(w.seat)) { wantRank = +b.dataset.rank; sfx.tick(); draw(); }
  });

  const sigNow = () => JSON.stringify([state.seq, api.mySeats, api.mySeats.map(i => api.canAct(i))]);
  function refresh() {
    if (busy || !state) return;
    sent = false;
    const now = sigNow();
    if (now !== signature) { signature = now; draw(); }
  }
  const shout = async (text, cls, ms) => { call.textContent = text; call.className = 'callout ' + cls; call.hidden = false; await sleep(ms); call.hidden = true; };

  async function update(next) {
    const l = next.last;
    state = next;
    if (!l) { reset(next); return; }
    busy = true; actions.innerHTML = '';
    wantRank = null;
    said.textContent = `${state.players[l.seat].name}: “${state.players[l.who].name}, do you have any ${plural(l.rank)}?”`;
    sfx.pop();
    await sleep(1100);
    if (l.got) { sfx.coin(); await shout(`Yes! ${l.got} card${l.got > 1 ? 's' : ''}`, 'good', 1000); } else {
      sfx.splash(); await shout('🐟 Go Fish!', 'miss', 1000);
      if (l.lucky) { sfx.climb(); await shout('🍀 Lucky catch!', 'good', 900); }
    }
    for (const r of l.sets) { sfx.buy(); await shout(`📚 Set of ${plural(r)}!`, 'good', 900); }
    if (dead) return;
    busy = false; signature = '';
    refresh();
  }
  function reset(next) {
    state = next; busy = false; signature = ''; wantRank = null; wantWho = null; secret.hide(); call.hidden = true;
    refresh();
  }

  return {
    reset, update, refresh,
    status: (s, i) => `📚 ${s.players[i].books.length}`,
    destroy() { dead = true; root.innerHTML = ''; },
  };
}

Core.register({
  id: 'gofish', name: 'Go Fish', emoji: '🐟', color: '#12b8c9',
  blurb: 'Ask for cards, fish from the pond, and collect the most sets.',
  min: 2, max: 6, levels: true,
  rules: ['Ask one player for a card type you already hold, such as “any 7s?”', 'If they have some, they hand them all over and you go again. If not, “Go Fish!” and draw a card.', 'Fish the card you asked for and you go again. The most sets wins.'],
  options: [{ key: 'pairs', type: 'check', label: 'Easy pairs mode', help: 'Collect sets of two instead of four. Good for younger players.', default: false }],
  create, exec, view, bot,
  turn: s => s.turn,
  mount,
});
})();
