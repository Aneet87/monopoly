/* Crazy Eights: match the suit or the number, and be first to empty your hand. Rules, computer players, screen. */
(() => {
'use strict';
const { esc, sleep, sfx } = Core;
const { rank, suit, SUITS, name } = Cards;

const EIGHT = 7, ACE = 0, TWO = 1, QUEEN = 11;   // card ranks, counting from Ace = 0

// ---------------------------------------------------------------- rules
function create(players, opts, rng = Math.random) {
  const pile = Cards.deck(players.length >= 6 ? 2 : 1, rng), deal = players.length === 2 ? 7 : 5;
  const hands = players.map(() => pile.splice(0, deal));
  let start = pile.pop();
  while (rank(start) === EIGHT) { pile.unshift(start); start = pile.pop(); }
  const s = {
    players: players.map((p, i) => ({ name: p.name, icon: p.icon, color: p.color, hand: hands[i], n: deal })),
    pile, discard: [start], suit: suit(start), action: !!opts.actions, drawOne: opts.draw === 'one',
    drawn: null, passes: 0, quiet: 0, dir: 1, turn: 0, seq: 0, last: null, over: false, winners: [],
    log: [`The first card is ${name(start)}. Match its suit or number.`],
  };
  s.left = pile.length;
  return s;
}
const top = s => s.discard[s.discard.length - 1];
const fits = (s, c) => rank(c) === EIGHT || suit(c) === s.suit || rank(c) === rank(top(s));
// The cards this player may put down right now.
function playable(s, hand) {
  if (s.drawOne && s.drawn !== null) return hand.filter(c => c === s.drawn && fits(s, c));
  return hand.filter(c => fits(s, c));
}
const canRefill = s => s.pile.length > 0 || s.discard.length > 1;
// May the player draw? In "draw until you can play" mode only while nothing in hand fits.
const mayDraw = (s, hand) => canRefill(s) && (s.drawOne ? s.drawn === null : !playable(s, hand).length);
const mayPass = (s, hand) => (s.drawOne && s.drawn !== null) || (!canRefill(s) && !playable(s, hand).length);

function takeCard(s, rng) {
  if (!s.pile.length && s.discard.length > 1) {
    const keep = s.discard.pop();
    s.pile = Cards.shuffle(s.discard, rng);
    s.discard = [keep];
    s.log.push('The draw pile ran out, so the played cards were shuffled back in.');
  }
  return s.pile.length ? s.pile.pop() : null;
}
const after = (s, seat, steps = 1) => ((seat + s.dir * steps) % s.players.length + s.players.length) % s.players.length;
function endTurn(s, steps = 1) { s.turn = after(s, s.turn, steps); s.drawn = null; }
function finish(s, winners, why) {
  s.over = true; s.winners = winners;
  s.log.push(why);
}

function fewestWins(s) {
  const fewest = Math.min(...s.players.map(x => x.hand.length));
  const best = s.players.map((x, i) => (x.hand.length === fewest ? i : -1)).filter(i => i >= 0);
  finish(s, best, `The game is stuck. Fewest cards wins: ${best.map(i => s.players[i].name).join(' & ')}.`);
}

function exec(s, seat, move, rng = Math.random) {
  if (s.over) return 'The game is over.';
  if (seat !== s.turn) return "It isn't your turn.";
  const p = s.players[seat];
  if (move && move.k === 'play') {
    const c = move.card;
    if (!p.hand.includes(c)) return "You don't have that card.";
    if (!playable(s, p.hand).includes(c)) return "That card doesn't match.";
    const wild = rank(c) === EIGHT;
    if (wild && ![0, 1, 2, 3].includes(move.suit)) return 'Choose a suit for your 8.';
    p.hand.splice(p.hand.indexOf(c), 1);
    s.discard.push(c);
    s.suit = wild ? move.suit : suit(c);
    s.passes = 0;
    s.quiet = wild ? s.quiet + 1 : 0;
    const l = { type: 'play', seat, card: c, wild, suit: s.suit, effect: null, victim: null };
    s.log.push(`${p.name} played ${name(c)}${wild ? ` and chose ${SUITS[s.suit][1]} ${SUITS[s.suit][0]}` : ''}.`);
    s.last = l;
    if (!p.hand.length) finish(s, [seat], `🏆 ${p.name} used up all their cards!`);
    else {
      let steps = 1;
      if (s.action && rank(c) === TWO) {
        l.effect = 'two'; l.victim = after(s, seat);
        const got = [takeCard(s, rng), takeCard(s, rng)].filter(x => x !== null);
        s.players[l.victim].hand.push(...got);
        s.log.push(`${s.players[l.victim].name} draws ${got.length} and misses a turn.`);
        steps = 2;
      } else if (s.action && rank(c) === QUEEN) {
        l.effect = 'skip'; l.victim = after(s, seat);
        s.log.push(`${s.players[l.victim].name} is skipped.`);
        steps = 2;
      } else if (s.action && rank(c) === ACE) {
        l.effect = 'reverse';
        if (s.players.length === 2) steps = 2; else s.dir = -s.dir;
        s.log.push(s.players.length === 2 ? `${p.name} goes again.` : 'The order of play reverses.');
      }
      endTurn(s, steps);
    }
  } else if (move && move.k === 'draw') {
    if (!mayDraw(s, p.hand)) return playable(s, p.hand).length ? 'You have a card you can play.' : "You can't draw now.";
    const c = takeCard(s, rng);
    p.hand.push(c);
    s.passes = 0;
    s.quiet++;
    s.last = { type: 'draw', seat, card: c };
    s.log.push(`${p.name} drew a card.`);
    if (s.drawOne) {
      s.drawn = c;
      if (!fits(s, c)) endTurn(s);   // it doesn't fit, so the turn is over
    }
  } else if (move && move.k === 'pass') {
    if (!mayPass(s, p.hand)) return "You can't pass now.";
    if (!(s.drawOne && s.drawn !== null)) s.passes++;
    s.last = { type: 'pass', seat };
    s.log.push(`${p.name} passed.`);
    if (s.passes >= s.players.length) fewestWins(s); else endTurn(s);
  } else return 'Unknown move.';
  // a rare deadlock: for ages, nothing but drawing and eights
  if (!s.over && s.quiet >= 80) fewestWins(s);
  s.players.forEach(x => { x.n = x.hand.length; });
  s.left = s.pile.length;
  if (s.log.length > 60) s.log.splice(0, s.log.length - 60);
  s.seq++;
  return null;
}

// Each device gets only its own hands, and never the order of the draw pile.
function view(s, seats) {
  const mine = i => seats.includes(i);
  let last = s.last;
  if (last && last.type === 'draw' && !mine(last.seat)) last = Object.assign({}, last, { card: null });
  return Object.assign({}, s, {
    last, pile: [], discard: s.discard.slice(-3), canRefill: canRefill(s),
    drawn: mine(s.turn) ? s.drawn : s.drawn === null ? null : -1,
    players: s.players.map((p, i) => (s.over || mine(i) ? p : Object.assign({}, p, { hand: [] }))),
  });
}

// ---------------------------------------------------------------- computer players
function favouriteSuit(hand, rng) {
  const n = [0, 0, 0, 0];
  hand.forEach(c => { if (rank(c) !== EIGHT) n[suit(c)]++; });
  const best = Math.max(...n);
  const list = [0, 1, 2, 3].filter(i => n[i] === best);
  return list[Math.floor(rng() * list.length)];
}
function bot(s, seat, level, rng = Math.random) {
  const hand = s.players[seat].hand, can = playable(s, hand);
  if (!can.length) return mayPass(s, hand) ? { k: 'pass' } : { k: 'draw' };
  const play = c => ({ k: 'play', card: c, suit: level === 'easy' ? Math.floor(rng() * 4) : favouriteSuit(hand.filter(x => x !== c), rng) });
  if (level === 'easy') return play(can[Math.floor(rng() * can.length)]);
  const next = s.players[after(s, seat)].hand.length;
  const score = c => {
    const rest = hand.filter(x => x !== c);
    let v = rest.filter(x => suit(x) === suit(c) || rank(x) === rank(c)).length * 2 + rng();
    if (rank(c) === EIGHT) v -= level === 'hard' && hand.length > 2 ? 12 : 6;   // save eights for when they are needed
    if (level === 'hard' && s.action && [TWO, QUEEN, ACE].includes(rank(c))) v += next <= 3 ? 10 : -1;
    return v;
  };
  return play(can.reduce((a, b) => (score(b) > score(a) ? b : a)));
}

// ---------------------------------------------------------------- screen
function mount(root, api) {
  root.innerHTML = `
    <div class="gstage tbl eights">
      <div class="tbl-top"><div class="seats"></div></div>
      <div class="felt"><div class="pile"></div><div class="pile drop"></div><div class="suitnow"></div><div class="callout" hidden></div></div>
      <div class="gstatus center" aria-live="polite"></div><div class="tbl-help"></div>
      <div class="handwrap"></div>
      <div class="tbl-actions"></div>
    </div>`;
  const q = x => root.querySelector(x);
  const seatsEl = q('.seats'), pile = q('.pile'), drop = q('.pile.drop'), suitNow = q('.suitnow'), status = q('.gstatus'), help = q('.tbl-help'), handEl = q('.handwrap'), actions = q('.tbl-actions'), call = q('.callout');
  const secret = Cards.privacy(api);
  let state = null, busy = false, dead = false, sent = false, signature = '', choosing = null;
  const nm = i => `${state.players[i].icon} ${state.players[i].name}`;
  // the screen only knows whether cards can still be drawn, not which ones
  const rules = () => Object.assign({}, state, { pile: new Array(state.left).fill(0), discard: state.canRefill && !state.left ? [0, top(state)] : [top(state)] });

  function send(move, seat) { if (busy || sent) return; sent = true; if (!api.move(move, seat)) sent = false; }

  function draw() {
    if (!state || dead) return;
    actions.innerHTML = ''; handEl.innerHTML = ''; help.textContent = '';
    const w = secret.where(state.turn, state.over);
    const seat = w.seat, acting = seat !== null && !w.handoff && api.canAct(seat);
    const hand = seat !== null ? state.players[seat].hand : [];
    const can = acting ? playable(rules(), hand) : [];
    const canDraw = acting && mayDraw(rules(), hand), canPass = acting && mayPass(rules(), hand);
    if (!can.includes(choosing)) choosing = null;
    seatsEl.innerHTML = state.players.map((p, i) => `<div class="opp ${state.turn === i && !state.over ? 'turn' : ''}" style="--c:${p.color}"><span class="oi">${p.icon}</span><span class="on">${esc(p.name)}${seat === i ? ' (you)' : ''}</span><span class="om">🂠 ${p.n}${p.n === 1 ? ' ⚠️' : ''}</span></div>`).join('');
    pile.innerHTML = `<button class="pcard back stack ${canDraw ? 'can' : ''}" ${canDraw ? '' : 'disabled'} aria-label="Draw a card"></button><small>Draw pile: ${state.left}</small>`;
    drop.innerHTML = `${Cards.face(top(state))}<small>Play on this</small>`;
    suitNow.innerHTML = `<small>Suit to match</small><b class="${Cards.isRed(state.suit) ? 'red' : ''}">${SUITS[state.suit][0]}</b><small>${SUITS[state.suit][1]}</small>`;

    if (w.cover !== undefined) {
      handEl.innerHTML = Cards.coverHTML(state.players[w.cover].name);
      status.textContent = `${nm(w.cover)}, it's your turn`;
      Cards.button(actions, `I'm ${state.players[w.cover].name}: show my cards`, 'bigbtn', () => { secret.reveal(w.cover); draw(); });
      return;
    }
    if (seat !== null) {
      const fresh = state.last && state.last.type === 'draw' && state.last.seat === seat ? state.last.card : -1;
      const sorted = hand.slice().sort((a, b) => suit(a) - suit(b) || rank(a) - rank(b));
      handEl.innerHTML = `<div class="hand">${sorted.map(c => Cards.face(c, { button: true, cls: `${can.includes(c) ? 'can' : acting ? 'cant' : ''} ${choosing === c ? 'sel' : ''} ${c === fresh ? 'fresh' : ''}`, attrs: `data-c="${c}" ${can.includes(c) ? '' : 'tabindex="-1"'}` })).join('')}</div>`;
    }
    status.textContent = state.over ? `🏆 ${state.winners.map(i => state.players[i].name).join(' & ')} win${state.winners.length > 1 ? '' : 's'}!`
      : acting ? `${nm(seat)}, your turn!` : `Waiting for ${nm(state.turn)}…`;
    if (choosing !== null) {
      help.textContent = 'Your 8 is wild! Choose the new suit:';
      SUITS.forEach(([sym, label], i) => Cards.button(actions, `${sym} ${label}`, `suitbtn ${Cards.isRed(i) ? 'red' : ''}`, () => { const c = choosing; choosing = null; send({ k: 'play', card: c, suit: i }, seat); }));
      Cards.button(actions, 'Cancel', 'sec', () => { choosing = null; draw(); });
    } else if (acting) {
      help.textContent = can.length ? 'Tap a glowing card to play it.' : canDraw ? 'Nothing matches. Draw a card.' : '';
      if (canDraw) Cards.button(actions, 'Draw a card', can.length ? 'sec' : 'bigbtn', () => send({ k: 'draw' }, seat));
      if (canPass) Cards.button(actions, 'Pass', 'bigbtn', () => send({ k: 'pass' }, seat));
    }
    if (w.handoff) Cards.button(actions, w.next !== null ? `Hide my cards and pass to ${state.players[w.next].name}` : 'Hide my cards', 'bigbtn', () => { secret.hide(); draw(); });
  }

  const myTurnSeat = () => { const w = secret.where(state.turn, state.over); return w.seat !== null && !w.handoff && api.canAct(w.seat) ? w.seat : null; };
  handEl.addEventListener('click', e => {
    const b = e.target.closest('.pcard.can');
    if (!b || busy) return;
    const seat = myTurnSeat();
    if (seat === null) return;
    const c = +b.dataset.c;
    if (rank(c) === EIGHT) { choosing = c; sfx.tick(); draw(); } else send({ k: 'play', card: c }, seat);
  });
  pile.addEventListener('click', e => { const b = e.target.closest('.pcard.can'); const seat = b && !busy ? myTurnSeat() : null; if (seat !== null) send({ k: 'draw' }, seat); });

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
    busy = true; choosing = null; actions.innerHTML = '';
    const who = state.players[l.seat];
    if (l.type === 'play') {
      drop.innerHTML = `${Cards.face(l.card, { cls: 'toss' })}<small>${esc(who.name)} played</small>`;
      sfx.card();
      await sleep(750);
      if (l.wild) await shout(`🌀 Now ${SUITS[l.suit][0]} ${SUITS[l.suit][1]}!`, 'miss', 1100);
      if (l.effect === 'two') { sfx.nope(); await shout(`${state.players[l.victim].name} draws 2!`, 'bad', 1100); }
      if (l.effect === 'skip') { sfx.nope(); await shout(`⏭ ${state.players[l.victim].name} is skipped`, 'bad', 1100); }
      if (l.effect === 'reverse') { sfx.slide(); await shout('🔄 Reverse!', 'miss', 900); }
      if (who.n === 1) { sfx.pop(); await shout(`${who.name}: last card!`, 'good', 900); }
    } else {
      sfx.hop();
      status.textContent = `${who.icon} ${who.name} ${l.type === 'draw' ? 'drew a card' : 'passed'}.`;
      await sleep(l.type === 'draw' ? 550 : 750);
    }
    if (dead) return;
    busy = false; signature = '';
    refresh();
  }
  function reset(next) {
    state = next; busy = false; signature = ''; choosing = null; secret.hide(); call.hidden = true;
    refresh();
  }

  return { reset, update, refresh, status: (s, i) => `🂠 ${s.players[i].n}`, destroy() { dead = true; root.innerHTML = ''; } };
}

Core.register({
  id: 'eights', name: 'Crazy Eights', emoji: '🃏', color: '#f2683c',
  blurb: 'Match the suit or number and be first to play all your cards.',
  min: 2, max: 8, levels: true,
  rules: ['Play a card that matches the suit or the number on top of the pile.', '8s are wild: play one any time and choose the new suit.', 'Can’t match? Draw. The first player with no cards wins.'],
  options: [
    { key: 'draw', type: 'select', label: 'When you can’t play', default: 'until', choices: [['until', 'Draw until you can play (standard)'], ['one', 'Draw just one card']] },
    { key: 'actions', type: 'check', label: 'Action cards', help: '2 = next player draws two and misses a turn. Queen = skip. Ace = reverse.', default: false },
  ],
  create, exec, view, bot,
  turn: s => s.turn,
  mount,
  playable, mayDraw, mayPass,
});
})();
