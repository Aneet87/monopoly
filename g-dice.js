/* Dice Yacht: roll five dice up to three times, then fill one score box. Rules, computer players, screen. */
(() => {
'use strict';
const { esc, sleep, sfx } = Core;

const count = d => { const n = [0, 0, 0, 0, 0, 0, 0]; d.forEach(v => n[v]++); return n; };
const sum = d => d.reduce((a, b) => a + b, 0);
const has = (d, run) => run.every(v => d.includes(v));
const upper = (face, name) => ({ id: 'u' + face, name, hint: `Add up your ${face}s`, upper: face, score: d => face * count(d)[face], par: face * 2.4 });
const BOXES = [
  upper(1, 'Ones'), upper(2, 'Twos'), upper(3, 'Threes'), upper(4, 'Fours'), upper(5, 'Fives'), upper(6, 'Sixes'),
  { id: 'three', name: '3 of a Kind', hint: '3 the same: add all dice', score: d => (Math.max(...count(d)) >= 3 ? sum(d) : 0), par: 20 },
  { id: 'four', name: '4 of a Kind', hint: '4 the same: add all dice', score: d => (Math.max(...count(d)) >= 4 ? sum(d) : 0), par: 13 },
  { id: 'full', name: 'Full House', hint: '3 of one + 2 of another: 25', score: d => { const n = count(d); return (n.includes(3) && n.includes(2)) || n.includes(5) ? 25 : 0; }, par: 17 },
  { id: 'small', name: 'Small Straight', hint: '4 in a row: 30', score: d => (has(d, [1, 2, 3, 4]) || has(d, [2, 3, 4, 5]) || has(d, [3, 4, 5, 6]) ? 30 : 0), par: 23 },
  { id: 'large', name: 'Large Straight', hint: '5 in a row: 40', score: d => (has(d, [1, 2, 3, 4, 5]) || has(d, [2, 3, 4, 5, 6]) ? 40 : 0), par: 22 },
  { id: 'yacht', name: 'Yacht!', hint: '5 the same: 50', score: d => (count(d).includes(5) ? 50 : 0), par: 14 },
  { id: 'chance', name: 'Chance', hint: 'Anything: add all dice', score: d => sum(d), par: 23 },
];
const SHORT = ['three', 'four', 'full', 'small', 'large', 'yacht', 'chance'];
const BONUS_AT = 63, BONUS = 35;
const boxes = s => (s.short ? BOXES.filter(b => SHORT.includes(b.id)) : BOXES);

const upperTotal = p => BOXES.filter(b => b.upper).reduce((t, b) => t + (p.card[b.id] || 0), 0);
const bonus = p => (upperTotal(p) >= BONUS_AT ? BONUS : 0);
const total = p => Object.values(p.card).reduce((a, b) => a + b, 0) + bonus(p);

function create(players, opts) {
  return {
    players: players.map(p => ({ name: p.name, icon: p.icon, color: p.color, card: {} })),
    short: opts.length === 'short', dice: [1, 2, 3, 4, 5], held: [false, false, false, false, false], rolls: 0,
    turn: 0, seq: 0, last: null, over: false, winners: [], log: ['Roll the dice! You get up to three rolls each turn.'],
  };
}

function exec(s, seat, move, rng = Math.random) {
  if (s.over) return 'The game is over.';
  if (seat !== s.turn) return "It isn't your turn.";
  const p = s.players[seat];
  if (move && move.k === 'roll') {
    if (s.rolls >= 3) return 'No rolls left. Pick a score box.';
    const keep = s.rolls && Array.isArray(move.keep) ? s.dice.map((_, i) => !!move.keep[i]) : [false, false, false, false, false];
    if (keep.every(Boolean)) return 'Let go of at least one die to roll.';
    s.dice = s.dice.map((v, i) => (keep[i] ? v : 1 + Math.floor(rng() * 6)));
    s.held = keep; s.rolls++;
    s.last = { type: 'roll', seat, rolled: keep.map(k => !k) };
  } else if (move && move.k === 'score') {
    if (!s.rolls) return 'Roll the dice first.';
    const box = boxes(s).find(b => b.id === move.box);
    if (!box || p.card[box.id] !== undefined) return 'Pick an empty score box.';
    const had = bonus(p), points = box.score(s.dice);
    p.card[box.id] = points;
    s.log.push(`${p.name} scored ${points} in ${box.name}.`);
    const earned = !had && bonus(p);
    if (earned) s.log.push(`${p.name} earned the ${BONUS}-point bonus! 🎁`);
    s.last = { type: 'score', seat, box: box.id, points, bonus: !!earned };
    s.rolls = 0; s.held = [false, false, false, false, false];
    if (s.players.every(x => boxes(s).every(b => x.card[b.id] !== undefined))) {
      s.over = true;
      const best = Math.max(...s.players.map(total));
      s.winners = s.players.map((x, i) => (total(x) === best ? i : -1)).filter(i => i >= 0);
      s.log.push(`🏆 ${s.winners.map(i => s.players[i].name).join(' & ')} won with ${best} points.`);
    } else s.turn = (s.turn + 1) % s.players.length;
  } else return 'Unknown move.';
  if (s.log.length > 60) s.log.splice(0, s.log.length - 60);
  s.seq++;
  return null;
}

// ---------------------------------------------------------------- computer players
const open = s => boxes(s).filter(b => s.players[s.turn].card[b.id] === undefined);
// How good it is to put these dice in a box: points compared with what that box usually gets.
function worth(box, dice) {
  const pts = box.score(dice);
  return pts - box.par + (box.upper ? (pts - 3 * box.upper) * .8 + box.upper * .4 : 0) + pts * .15;
}
const bestBox = (s, dice, fn) => open(s).reduce((best, b) => { const v = fn(b, dice); return !best || v > best.v ? { b, v } : best; }, null);
function simpleKeep(dice) {
  const n = count(dice);
  let face = 6;
  for (let v = 6; v >= 1; v--) if (n[v] > n[face]) face = v;
  return dice.map(v => v === face);
}
function bot(s, seat, level, rng = Math.random) {
  if (!s.rolls) return { k: 'roll' };
  if (s.rolls < 3) {
    let keep = null;
    if (level === 'easy') keep = rng() < .75 ? simpleKeep(s.dice) : s.dice.map(() => rng() < .4);
    else if (level === 'medium') keep = simpleKeep(s.dice);
    else {
      // try every way of holding the dice, many times, and take the one that tends to score best
      let top = -Infinity;
      for (let mask = 0; mask < 32; mask++) {
        let total_ = 0;
        const tries = mask === 31 ? 1 : 90;
        for (let t = 0; t < tries; t++) {
          let d = s.dice.map((v, i) => ((mask >> i) & 1 ? v : 1 + Math.floor(rng() * 6)));
          if (s.rolls === 1) { const k = simpleKeep(d); const again = d.map((v, i) => (k[i] ? v : 1 + Math.floor(rng() * 6))); if (bestBox(s, again, worth).v > bestBox(s, d, worth).v) d = again; }
          total_ += bestBox(s, d, worth).v;
        }
        if (total_ / tries > top) { top = total_ / tries; keep = s.dice.map((_, i) => !!((mask >> i) & 1)); }
      }
    }
    if (!keep.every(Boolean)) return { k: 'roll', keep };
  }
  const choice = bestBox(s, s.dice, level === 'easy' ? (b, d) => b.score(d) + rng() * 6 : worth);
  return { k: 'score', box: choice.b.id };
}

// ---------------------------------------------------------------- screen
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const pips = v => Array.from({ length: 9 }, (_, i) => `<i class="${PIPS[v].includes(i) ? 'p' : ''}"></i>`).join('');

function mount(root, api) {
  root.innerHTML = `
    <div class="gstage yt">
      <div class="gstatus center" aria-live="polite"></div>
      <div class="yt-tray"><div class="yt-dice">${[0, 1, 2, 3, 4].map(i => `<button class="yd" data-i="${i}"></button>`).join('')}</div><div class="callout" hidden></div></div>
      <div class="tbl-help"></div>
      <div class="tbl-actions"><button class="bigbtn yt-roll">Roll</button></div>
      <div class="yt-cardwrap"><table class="yt-card"></table></div>
    </div>`;
  const q = x => root.querySelector(x);
  const status = q('.gstatus'), help = q('.tbl-help'), rollBtn = q('.yt-roll'), table = q('.yt-card'), call = q('.callout');
  const dice = [...root.querySelectorAll('.yd')];
  let state = null, busy = false, dead = false, sent = false, signature = '', held = [false, false, false, false, false], pick = null;

  const setDie = (i, v) => { dice[i].innerHTML = pips(v); dice[i].setAttribute('aria-label', `Die ${i + 1}: ${v}${held[i] ? ', held' : ''}`); };
  function send(move) { if (busy || sent) return; sent = true; if (!api.move(move)) sent = false; }

  function draw() {
    if (!state || dead) return;
    const me = api.canAct(), p = state.players[state.turn];
    dice.forEach((el, i) => {
      setDie(i, state.dice[i]);
      el.classList.toggle('held', state.rolls > 0 && held[i]);
      el.classList.toggle('idle', !state.rolls);
      el.disabled = !(me && state.rolls > 0 && state.rolls < 3);
    });
    status.textContent = state.over ? `🏆 ${state.winners.map(i => state.players[i].name).join(' & ')} win${state.winners.length > 1 ? '' : 's'}!`
      : me ? `${p.icon} ${p.name}, ${state.rolls ? `${3 - state.rolls} roll${3 - state.rolls === 1 ? '' : 's'} left` : 'roll the dice!'}` : `${p.icon} ${p.name} is playing…`;
    help.textContent = !me ? '' : !state.rolls ? '' : state.rolls < 3 ? 'Tap dice to keep them, then roll again. Or tap a score below.' : 'Tap a score box below.';
    rollBtn.textContent = state.rolls ? `🎲 Roll again (${3 - state.rolls} left)` : '🎲 Roll';
    rollBtn.disabled = !me || state.rolls >= 3 || (state.rolls > 0 && held.every(Boolean));
    rollBtn.hidden = state.over;
    const head = `<tr><th>Score box</th>${state.players.map((x, i) => `<th class="${i === state.turn && !state.over ? 'now' : ''}" title="${esc(x.name)}"><span>${x.icon}</span><small>${esc(x.name)}</small></th>`).join('')}</tr>`;
    const row = b => `<tr><th scope="row">${b.name}<small>${b.hint}</small></th>${state.players.map((x, i) => {
      const v = x.card[b.id];
      if (v !== undefined) return `<td class="${i === state.turn && !state.over ? 'now' : ''}">${v}</td>`;
      if (me && i === state.turn && state.rolls) {
        const pts = b.score(state.dice);
        return `<td class="now"><button class="yt-pick ${pick === b.id ? 'sel' : ''} ${pts ? '' : 'zero'}" data-box="${b.id}">${pick === b.id ? '✓ ' : ''}${pts}</button></td>`;
      }
      return `<td class="${i === state.turn && !state.over ? 'now' : ''}">·</td>`;
    }).join('')}</tr>`;
    const list = boxes(state), line = (label, fn, cls) => `<tr class="${cls}"><th scope="row">${label}</th>${state.players.map(x => `<td>${fn(x)}</td>`).join('')}</tr>`;
    table.innerHTML = head + list.filter(b => b.upper).map(row).join('') +
      (state.short ? '' : line(`Bonus<small>${BONUS} if the top six reach ${BONUS_AT}</small>`, x => (bonus(x) ? BONUS : `<span class="dim">${upperTotal(x)}/${BONUS_AT}</span>`), 'sub')) +
      list.filter(b => !b.upper).map(row).join('') + line('TOTAL', total, 'total');
  }

  dice.forEach((el, i) => el.addEventListener('click', () => { if (el.disabled || busy) return; held[i] = !held[i]; sfx.tick(); draw(); }));
  rollBtn.addEventListener('click', () => { if (!rollBtn.disabled) { pick = null; send({ k: 'roll', keep: held.slice() }); } });
  table.addEventListener('click', e => {
    const b = e.target.closest('.yt-pick');
    if (!b || busy || !api.canAct()) return;
    if (pick === b.dataset.box) { pick = null; send({ k: 'score', box: b.dataset.box }); }   // second tap confirms
    else { pick = b.dataset.box; sfx.tick(); draw(); help.textContent = 'Tap the same box again to lock it in.'; }
  });
  const onKey = e => {
    if (e.target.matches('input, select, textarea, button') || document.querySelector('#modal:not(:empty)')) return;
    if (e.code === 'Space' || e.key.toLowerCase() === 'r') { e.preventDefault(); rollBtn.click(); }
  };
  document.addEventListener('keydown', onKey);

  const sigNow = () => JSON.stringify([state.seq, api.canAct(), api.mySeats]);
  function refresh() {
    if (busy || !state) return;
    sent = false;
    const now = sigNow();
    if (now !== signature) { signature = now; draw(); }
  }

  async function update(next) {
    const l = next.last;
    state = next;
    if (!l) { reset(next); return; }
    busy = true; pick = null; rollBtn.disabled = true; help.textContent = '';
    const who = state.players[l.seat];
    if (l.type === 'roll') {
      held = state.held.slice();
      dice.forEach((el, i) => { el.classList.remove('idle'); el.classList.toggle('held', held[i]); el.classList.toggle('tumble', l.rolled[i]); });
      status.textContent = `${who.icon} ${who.name} rolls…`;
      sfx.dice();
      for (let k = 0; k < 8 && !dead; k++) { dice.forEach((_, i) => { if (l.rolled[i]) setDie(i, 1 + Math.floor(Math.random() * 6)); }); await sleep(90); }
      dice.forEach((el, i) => { el.classList.remove('tumble'); setDie(i, state.dice[i]); });
      if (new Set(state.dice).size === 1) { call.textContent = '⛵ YACHT!'; call.className = 'callout good'; call.hidden = false; sfx.win(); await sleep(1300); }
      await sleep(200);
    } else {
      const box = BOXES.find(b => b.id === l.box);
      call.textContent = `${who.icon} ${box.name}: ${l.points}`; call.className = 'callout ' + (l.points ? 'good' : 'bad'); call.hidden = false;
      if (l.points) sfx.coin(); else sfx.nope();
      await sleep(1100);
      if (l.bonus) { call.textContent = `🎁 +${BONUS} bonus!`; sfx.buy(); await sleep(900); }
      held = [false, false, false, false, false];
    }
    if (dead) return;
    call.hidden = true; busy = false; signature = '';
    refresh();
  }
  function reset(next) {
    state = next; busy = false; signature = ''; held = state.held.slice(); pick = null; call.hidden = true;
    refresh();
  }

  return { reset, update, refresh, status: (s, i) => `${total(s.players[i])} pts`, destroy() { dead = true; document.removeEventListener('keydown', onKey); root.innerHTML = ''; } };
}

Core.register({
  id: 'dice', name: 'Dice Yacht', emoji: '🎲', color: '#5fbf2f',
  blurb: 'Roll five dice, hold your favorites, and fill your score card.',
  min: 2, max: 8, levels: true,
  rules: ['Roll up to three times a turn. Between rolls, keep any dice you like.', 'Then fill one empty score box. If nothing fits, you must take a 0 somewhere.', 'When every box is full, the highest total wins.'],
  options: [{ key: 'length', type: 'select', label: 'Game length', default: 'full', choices: [['full', 'Full game: 13 turns'], ['short', 'Shorter game: 7 turns']] }],
  create, exec, bot,
  view: s => s,   // nothing is secret in this game
  turn: s => s.turn,
  mount,
  BOXES, total,
});
})();
