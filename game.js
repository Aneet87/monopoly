/* Monopoly rules engine. Pure state + functions; no DOM access. */
const Game = (() => {
'use strict';

const COLORS = ['#ff4d6d', '#3b9cff', '#2fbf71', '#ff9f1c'];
const ICONS = ['🎩', '🚗', '🐕', '🚢'];
const GROUP_COLORS = {
  brown: '#8b5a2b', lblue: '#aee0f5', pink: '#d63f9a', orange: '#f2931e', red: '#e0302a',
  yellow: '#f6e03a', green: '#1f9d55', dblue: '#2a4fb5', rr: '#444', util: '#999',
};
const GROUP_NAMES = {
  brown: 'Brown', lblue: 'Light Blue', pink: 'Pink', orange: 'Orange', red: 'Red',
  yellow: 'Yellow', green: 'Green', dblue: 'Dark Blue', rr: 'Railroads', util: 'Utilities',
};

const P = (name, group, price, rent, hc) => ({ name, type: 'prop', group, price, rent, hc });
const RR = name => ({ name, type: 'rr', group: 'rr', price: 200 });
const UT = name => ({ name, type: 'util', group: 'util', price: 150 });
const CH = { name: 'Chance', type: 'chance' };
const CC = { name: 'Community Chest', type: 'chest' };
const R_PINK = [10, 50, 150, 450, 625, 750];
const R_ORANGE = [14, 70, 200, 550, 750, 950];
const R_RED = [18, 90, 250, 700, 875, 1050];
const R_YELLOW = [22, 110, 330, 800, 975, 1150];
const R_GREEN = [26, 130, 390, 900, 1100, 1275];

const SPACES = [
  { name: 'GO', type: 'go' },
  P('Mediterranean Avenue', 'brown', 60, [2, 10, 30, 90, 160, 250], 50),
  CC,
  P('Baltic Avenue', 'brown', 60, [4, 20, 60, 180, 320, 450], 50),
  { name: 'Income Tax', type: 'tax', tax: 200 },
  RR('Reading Railroad'),
  P('Oriental Avenue', 'lblue', 100, [6, 30, 90, 270, 400, 550], 50),
  CH,
  P('Vermont Avenue', 'lblue', 100, [6, 30, 90, 270, 400, 550], 50),
  P('Connecticut Avenue', 'lblue', 120, [8, 40, 100, 300, 450, 600], 50),
  { name: 'Jail', type: 'jail' },
  P('St. Charles Place', 'pink', 140, R_PINK, 100),
  UT('Electric Company'),
  P('States Avenue', 'pink', 140, R_PINK, 100),
  P('Virginia Avenue', 'pink', 160, [12, 60, 180, 500, 700, 900], 100),
  RR('Pennsylvania Railroad'),
  P('St. James Place', 'orange', 180, R_ORANGE, 100),
  CC,
  P('Tennessee Avenue', 'orange', 180, R_ORANGE, 100),
  P('New York Avenue', 'orange', 200, [16, 80, 220, 600, 800, 1000], 100),
  { name: 'Free Parking', type: 'free' },
  P('Kentucky Avenue', 'red', 220, R_RED, 150),
  CH,
  P('Indiana Avenue', 'red', 220, R_RED, 150),
  P('Illinois Avenue', 'red', 240, [20, 100, 300, 750, 925, 1100], 150),
  RR('B&O Railroad'),
  P('Atlantic Avenue', 'yellow', 260, R_YELLOW, 150),
  P('Ventnor Avenue', 'yellow', 260, R_YELLOW, 150),
  UT('Water Works'),
  P('Marvin Gardens', 'yellow', 280, [24, 120, 360, 850, 1025, 1200], 150),
  { name: 'Go To Jail', type: 'gotojail' },
  P('Pacific Avenue', 'green', 300, R_GREEN, 200),
  P('North Carolina Avenue', 'green', 300, R_GREEN, 200),
  CC,
  P('Pennsylvania Avenue', 'green', 320, [28, 150, 450, 1000, 1200, 1400], 200),
  RR('Short Line'),
  CH,
  P('Park Place', 'dblue', 350, [35, 175, 500, 1100, 1300, 1500], 200),
  { name: 'Luxury Tax', type: 'tax', tax: 100 },
  P('Boardwalk', 'dblue', 400, [50, 200, 600, 1400, 1700, 2000], 200),
];

const GROUPS = {};
SPACES.forEach((s, i) => { if (s.group) (GROUPS[s.group] = GROUPS[s.group] || []).push(i); });
const OWNABLE = SPACES.map((s, i) => (s.group ? i : -1)).filter(i => i >= 0);

const CARDS = {
  chance: [
    { text: 'Advance to GO. Collect $200.', k: 'goto', pos: 0 },
    { text: 'Advance to Illinois Avenue.', k: 'goto', pos: 24 },
    { text: 'Advance to St. Charles Place.', k: 'goto', pos: 11 },
    { text: 'Advance to the nearest Utility. If unowned you may buy it; if owned, pay 10× the dice roll.', k: 'nearest', kind: 'util' },
    { text: 'Advance to the nearest Railroad and pay the owner double rent.', k: 'nearest', kind: 'rr' },
    { text: 'Advance to the nearest Railroad and pay the owner double rent.', k: 'nearest', kind: 'rr' },
    { text: 'Bank pays you a dividend of $50.', k: 'gain', amt: 50 },
    { text: 'Get Out of Jail Free. Keep this card until needed.', k: 'jailcard' },
    { text: 'Go back 3 spaces.', k: 'back', n: 3 },
    { text: 'Go directly to Jail. Do not pass GO.', k: 'jail' },
    { text: 'Make general repairs: $25 per house, $100 per hotel.', k: 'repairs', house: 25, hotel: 100 },
    { text: 'Speeding fine. Pay $15.', k: 'pay', amt: 15 },
    { text: 'Take a trip to Reading Railroad.', k: 'goto', pos: 5 },
    { text: 'Advance to Boardwalk.', k: 'goto', pos: 39 },
    { text: 'You have been elected Chairman. Pay each player $50.', k: 'payeach', amt: 50 },
    { text: 'Your building loan matures. Collect $150.', k: 'gain', amt: 150 },
  ],
  chest: [
    { text: 'Advance to GO. Collect $200.', k: 'goto', pos: 0 },
    { text: 'Bank error in your favor. Collect $200.', k: 'gain', amt: 200 },
    { text: "Doctor's fee. Pay $50.", k: 'pay', amt: 50 },
    { text: 'From sale of stock you get $50.', k: 'gain', amt: 50 },
    { text: 'Get Out of Jail Free. Keep this card until needed.', k: 'jailcard' },
    { text: 'Go directly to Jail. Do not pass GO.', k: 'jail' },
    { text: 'Holiday fund matures. Receive $100.', k: 'gain', amt: 100 },
    { text: 'Income tax refund. Collect $20.', k: 'gain', amt: 20 },
    { text: "It's your birthday. Collect $10 from every player.", k: 'collecteach', amt: 10 },
    { text: 'Life insurance matures. Collect $100.', k: 'gain', amt: 100 },
    { text: 'Pay hospital fees of $100.', k: 'pay', amt: 100 },
    { text: 'Pay school fees of $50.', k: 'pay', amt: 50 },
    { text: 'Receive a $25 consultancy fee.', k: 'gain', amt: 25 },
    { text: 'You are assessed for street repairs: $40 per house, $115 per hotel.', k: 'repairs', house: 40, hotel: 115 },
    { text: 'You have won second prize in a beauty contest. Collect $10.', k: 'gain', amt: 10 },
    { text: 'You inherit $100.', k: 'gain', amt: 100 },
  ],
};

const DEFAULTS = {
  startCash: 1500,
  incomeTaxChoice: true, // landing on Income Tax: pay $200 or 10% of total worth
  auction: true,       // unbought properties go to auction
  freeParking: false,   // taxes & fines pool up on Free Parking
  doubleGo: false,      // landing exactly on GO pays double
  rentInJail: true,     // owners in jail still collect rent
  evenBuild: true,      // must build/sell evenly within a colour group
  limitedHouses: true,  // 32 houses / 12 hotels in the bank
  randomOrder: false,
  dealProps: 0,         // deal N random properties to each player at start
  fpStart: 0,           // Free Parking pot starts with this much (bank-funded)
  fpRefill: false,      // after someone wins the pot, the bank puts the starting amount back
  goSalary: 200,        // salary for passing GO
  jailFine: 50,         // cost to leave jail
  rentPct: 100,         // rent multiplier in percent
  setBonus: true,       // full colour set with no buildings pays double rent
};

const rand6 = () => 1 + Math.floor(Math.random() * 6);
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const log = (g, msg) => { g.log.push(msg); if (g.log.length > 150) g.log.shift(); };
// Structured events from the latest action; the UI turns these into on-board banners.
const evt = (g, e) => { (g.ev = g.ev || []).push(e); };
const alive = g => g.players.map((p, i) => (p.bankrupt ? -1 : i)).filter(i => i >= 0);
const owned = (g, pi) => OWNABLE.filter(i => g.props[i].owner === pi);
const ownsGroup = (g, pi, group) => GROUPS[group].every(i => g.props[i].owner === pi);
const hasBuildings = (g, group) => GROUPS[group].some(i => g.props[i].houses > 0);
const mortgageValue = i => SPACES[i].price / 2;
const unmortgageCost = i => Math.ceil(SPACES[i].price / 2 * 1.1);

function netWorth(g, pi) {
  const p = g.players[pi];
  let w = p.cash;
  owned(g, pi).forEach(i => {
    const pr = g.props[i];
    w += pr.mortgaged ? mortgageValue(i) : SPACES[i].price;
    if (pr.houses) w += pr.houses * SPACES[i].hc;
  });
  return w;
}

// Classic rule: 10% of total worth = cash + printed price of all properties (mortgaged too) + buildings.
function incomeTaxPercent(g, pi) {
  let w = g.players[pi].cash;
  owned(g, pi).forEach(i => { w += SPACES[i].price + g.props[i].houses * (SPACES[i].hc || 0); });
  return Math.round(w * 0.1);
}

const jailFine = g => (g.options.jailFine == null ? 50 : g.options.jailFine);

function create(defs, options) {
  const o = Object.assign({}, DEFAULTS, options || {});
  const g = {
    status: 'playing', options: o,
    players: defs.map((d, i) => ({
      name: d.name, bot: !!d.bot, color: COLORS[i], icon: d.icon || ICONS[i],
      cash: o.startCash, pos: 0, inJail: false, jailTurns: 0, jailCards: [], bankrupt: false,
    })),
    props: SPACES.map(s => (s.group ? { owner: -1, houses: 0, mortgaged: false } : null)),
    turn: 0, turnNo: 0, botTradeAt: -1, phase: 'roll', dice: [1, 1], rollSeq: 0, doubles: 0, rolledDoubles: false,
    housesLeft: o.limitedHouses ? 32 : 999, hotelsLeft: o.limitedHouses ? 12 : 999,
    pot: o.freeParking ? (+o.fpStart || 0) : 0,
    decks: { chance: shuffle([...Array(16).keys()]), chest: shuffle([...Array(16).keys()]) },
    buy: null, auction: null, auctionQueue: [], afterAuction: 'post',
    debt: null, trade: null, log: [], winner: -1, lastCard: null, cardSeq: 0,
  };
  if (o.randomOrder) shuffle(g.players);
  if (o.dealProps > 0) {
    const pool = shuffle(OWNABLE.slice());
    for (let r = 0; r < o.dealProps; r++) {
      g.players.forEach((p, pi) => { g.props[pool.pop()].owner = pi; });
    }
    log(g, `Each player was dealt ${o.dealProps} random properties.`);
  }
  log(g, `Game started! ${g.players[0].name} goes first.`);
  return g;
}

// ---------------------------------------------------------------- money

function settle(g, pi, amt, creditor, meta) {
  const p = g.players[pi];
  p.cash -= amt;
  evt(g, Object.assign({ k: 'pay', from: pi, to: creditor, amt }, meta));
  if (typeof creditor === 'number') g.players[creditor].cash += amt;
  else if (creditor === 'pot') { if (g.options.freeParking) g.pot += amt; }
  else if (creditor === 'each') {
    const others = alive(g).filter(i => i !== pi);
    const per = amt / others.length;
    others.forEach(i => { g.players[i].cash += per; });
  }
}

function charge(g, pi, amt, creditor, cont, meta) {
  cont = cont || 'post';
  if (amt <= 0) { runCont(g, pi, cont); return true; }
  const p = g.players[pi];
  if (p.cash >= amt) { settle(g, pi, amt, creditor, meta); runCont(g, pi, cont); return true; }
  g.debt = { pi, amt, creditor, cont, meta };
  g.phase = 'debt';
  evt(g, Object.assign({ k: 'owe', from: pi, to: creditor, amt }, meta));
  const to = typeof creditor === 'number' ? g.players[creditor].name : creditor === 'each' ? 'the other players' : 'the bank';
  log(g, `${p.name} owes $${amt} to ${to} but only has $${p.cash}. Raise funds or go bankrupt.`);
  return false;
}

function runCont(g, pi, cont) {
  if (cont === 'move') {
    const p = g.players[pi];
    p.inJail = false; p.jailTurns = 0;
    g.phase = 'post';
    moveSteps(g, pi, g.dice[0] + g.dice[1]);
  }
}

function settleDebt(g) {
  const d = g.debt;
  if (!d || g.players[d.pi].cash < d.amt) return;
  g.debt = null;
  g.phase = 'post';
  log(g, `${g.players[d.pi].name} paid the $${d.amt} debt.`);
  settle(g, d.pi, d.amt, d.creditor, d.meta);
  runCont(g, d.pi, d.cont);
}

// ---------------------------------------------------------------- movement

function salary(g, pi, landedOnGo) {
  const p = g.players[pi];
  const base = g.options.goSalary == null ? 200 : g.options.goSalary;
  const amt = landedOnGo && g.options.doubleGo ? base * 2 : base;
  p.cash += amt;
  evt(g, { k: 'go', pi, amt });
  log(g, `${p.name} collects $${amt} for ${landedOnGo ? 'landing on' : 'passing'} GO.`);
}

function moveSteps(g, pi, n) {
  const p = g.players[pi];
  const raw = p.pos + n;
  p.pos = raw % 40;
  if (raw >= 40) salary(g, pi, p.pos === 0);
  landOn(g, pi, {});
}

function advanceTo(g, pi, pos, ctx) {
  const p = g.players[pi];
  if (pos < p.pos) salary(g, pi, pos === 0);
  p.pos = pos;
  landOn(g, pi, ctx || {});
}

function sendToJail(g, pi, cause) {
  const p = g.players[pi];
  p.pos = 10; p.inJail = true; p.jailTurns = 0;
  g.rolledDoubles = false; g.doubles = 0;
  evt(g, { k: 'jail', pi, cause });
  log(g, `${p.name} goes to Jail.`);
}

function rentFor(g, idx, ctx) {
  const base = baseRent(g, idx, ctx || {});
  const pct = g.options.rentPct == null ? 100 : g.options.rentPct;
  return pct === 100 ? base : Math.round(base * pct / 100);
}

function baseRent(g, idx, ctx) {
  const sp = SPACES[idx], pr = g.props[idx], o = pr.owner;
  if (sp.type === 'prop') {
    if (pr.houses > 0) return sp.rent[pr.houses];
    const bonus = g.options.setBonus !== false && ownsGroup(g, o, sp.group);
    return sp.rent[0] * (bonus ? 2 : 1);
  }
  if (sp.type === 'rr') {
    const n = GROUPS.rr.filter(i => g.props[i].owner === o).length;
    return 25 * Math.pow(2, n - 1) * (ctx.rrDouble ? 2 : 1);
  }
  const n = GROUPS.util.filter(i => g.props[i].owner === o).length;
  const mult = ctx.utilTen || n === 2 ? 10 : 4;
  return mult * (g.dice[0] + g.dice[1]);
}

function landOn(g, pi, ctx) {
  const p = g.players[pi], sp = SPACES[p.pos];
  switch (sp.type) {
    case 'prop': case 'rr': case 'util': {
      const pr = g.props[p.pos];
      if (pr.owner === -1) { g.phase = 'buy'; g.buy = { pi, idx: p.pos }; return; }
      if (pr.owner === pi || pr.mortgaged) return;
      const owner = g.players[pr.owner];
      if (owner.inJail && !g.options.rentInJail) { log(g, `${owner.name} is in jail and collects no rent.`); return; }
      const rent = rentFor(g, p.pos, ctx);
      log(g, `${p.name} pays $${rent} rent to ${owner.name} for ${sp.name}.`);
      charge(g, pi, rent, pr.owner, 'post', { why: 'rent', idx: p.pos });
      return;
    }
    case 'tax':
      if (sp.name === 'Income Tax' && g.options.incomeTaxChoice) {
        g.phase = 'tax';
        log(g, `${p.name} landed on Income Tax: pay $200 or 10% of total worth.`);
        return;
      }
      log(g, `${p.name} pays $${sp.tax} ${sp.name.toLowerCase()}.`);
      charge(g, pi, sp.tax, 'pot', 'post', { why: 'tax', idx: p.pos });
      return;
    case 'chance': draw(g, pi, 'chance'); return;
    case 'chest': draw(g, pi, 'chest'); return;
    case 'gotojail': sendToJail(g, pi, 'space'); return;
    case 'free':
      if (g.options.freeParking && g.pot > 0) {
        p.cash += g.pot;
        evt(g, { k: 'fp', pi, amt: g.pot });
        log(g, `${p.name} collects $${g.pot} from Free Parking!`);
        g.pot = g.options.fpRefill ? (+g.options.fpStart || 0) : 0;
      }
      return;
  }
}

function draw(g, pi, deck) {
  const p = g.players[pi];
  const order = g.decks[deck];
  const id = order.shift();
  const card = CARDS[deck][id];
  g.lastCard = { pi, deck, text: card.text, seq: ++g.cardSeq };
  log(g, `${p.name} drew ${deck === 'chance' ? 'Chance' : 'Community Chest'}: ${card.text}`);
  if (card.k === 'jailcard') p.jailCards.push({ deck, id }); else order.push(id);
  switch (card.k) {
    case 'goto': advanceTo(g, pi, card.pos); break;
    case 'gain': p.cash += card.amt; break;
    case 'pay': charge(g, pi, card.amt, 'pot', 'post', { why: 'card' }); break;
    case 'jail': sendToJail(g, pi, 'card'); break;
    case 'back':
      p.pos = (p.pos - card.n + 40) % 40;
      landOn(g, pi, {});
      break;
    case 'nearest': {
      let pos = p.pos;
      do { pos = (pos + 1) % 40; } while (SPACES[pos].type !== card.kind);
      advanceTo(g, pi, pos, card.kind === 'rr' ? { rrDouble: true } : { utilTen: true });
      break;
    }
    case 'repairs': {
      let cost = 0;
      owned(g, pi).forEach(i => {
        const h = g.props[i].houses;
        cost += h === 5 ? card.hotel : h * card.house;
      });
      if (cost) charge(g, pi, cost, 'pot', 'post', { why: 'repairs' }); else log(g, `${p.name} has no buildings to repair.`);
      break;
    }
    case 'payeach': {
      const n = alive(g).length - 1;
      charge(g, pi, card.amt * n, 'each', 'post', { why: 'card' });
      break;
    }
    case 'collecteach':
      alive(g).filter(i => i !== pi).forEach(i => {
        const pay = Math.min(g.players[i].cash, card.amt);
        g.players[i].cash -= pay; p.cash += pay;
      });
      break;
  }
}

// ---------------------------------------------------------------- turn flow

function nextTurn(g) {
  const n = g.players.length;
  let i = g.turn;
  do { i = (i + 1) % n; } while (g.players[i].bankrupt);
  g.turn = i;
  g.doubles = 0; g.rolledDoubles = false; g.turnNo++;
  g.phase = 'roll'; g.buy = null; g.afterAuction = 'post';
  log(g, `${g.players[i].name}'s turn.`);
}

function doRoll(g, pi) {
  const p = g.players[pi];
  const d1 = rand6(), d2 = rand6();
  g.dice = [d1, d2]; g.rollSeq++;
  const dbl = d1 === d2;
  log(g, `${p.name} rolled ${d1} + ${d2} = ${d1 + d2}${dbl ? ' (doubles!)' : ''}.`);
  g.phase = 'post';
  if (p.inJail) {
    if (dbl) {
      p.inJail = false; p.jailTurns = 0; g.rolledDoubles = false;
      log(g, `${p.name} rolled doubles and leaves Jail.`);
      moveSteps(g, pi, d1 + d2);
      return;
    }
    p.jailTurns++;
    g.rolledDoubles = false;
    if (p.jailTurns >= 3) {
      const fine = jailFine(g);
      log(g, `${p.name} failed to roll doubles three times and must pay $${fine}.`);
      charge(g, pi, fine, 'pot', 'move', { why: 'jailfee' });
    } else {
      log(g, `${p.name} stays in Jail (attempt ${p.jailTurns}/3).`);
    }
    return;
  }
  if (dbl) {
    g.doubles++;
    if (g.doubles === 3) {
      log(g, `${p.name} rolled three doubles in a row!`);
      sendToJail(g, pi, 'triple');
      return;
    }
    g.rolledDoubles = true;
  } else {
    g.rolledDoubles = false;
  }
  moveSteps(g, pi, d1 + d2);
}

// ---------------------------------------------------------------- auctions

function startAuction(g, idx) {
  g.phase = 'auction';
  g.auction = { idx, high: 0, bidder: -1, active: alive(g), cur: g.turn };
  log(g, `Auction started for ${SPACES[idx].name}.`);
  auctionAdvance(g);
}

function auctionAdvance(g) {
  const a = g.auction, n = g.players.length;
  a.active = a.active.filter(i => i === a.bidder || g.players[i].cash > a.high);
  const others = a.active.filter(i => i !== a.bidder);
  if (!others.length) { finishAuction(g); return; }
  for (let k = 1; k <= n; k++) {
    const i = (a.cur + k) % n;
    if (others.includes(i)) { a.cur = i; return; }
  }
}

function finishAuction(g) {
  const a = g.auction;
  if (a.bidder >= 0) {
    const w = g.players[a.bidder];
    w.cash -= a.high;
    g.props[a.idx].owner = a.bidder;
    evt(g, { k: 'buy', pi: a.bidder, idx: a.idx, price: a.high, auction: true });
    log(g, `${w.name} wins ${SPACES[a.idx].name} for $${a.high}.`);
  } else {
    log(g, `Nobody bid on ${SPACES[a.idx].name}; it stays with the bank.`);
  }
  g.auction = null;
  if (g.auctionQueue.length) startAuction(g, g.auctionQueue.shift());
  else if (g.afterAuction === 'endturn') nextTurn(g);
  else g.phase = 'post';
}

// ---------------------------------------------------------------- bankruptcy

function declareBankrupt(g, pi) {
  const p = g.players[pi];
  const cred = g.debt ? g.debt.creditor : 'bank';
  const mine = owned(g, pi);
  mine.forEach(i => {
    const pr = g.props[i];
    if (pr.houses > 0) {
      p.cash += Math.floor(SPACES[i].hc / 2) * pr.houses;
      if (pr.houses === 5) g.hotelsLeft++; else g.housesLeft += pr.houses;
      pr.houses = 0;
    }
  });
  const queue = [];
  if (typeof cred === 'number') {
    const c = g.players[cred];
    c.cash += p.cash;
    mine.forEach(i => {
      const pr = g.props[i];
      pr.owner = cred;
      if (pr.mortgaged) c.cash -= Math.min(c.cash, Math.ceil(mortgageValue(i) * 0.1));
    });
    c.jailCards.push(...p.jailCards);
    log(g, `${p.name} is bankrupt! Everything goes to ${c.name}.`);
  } else {
    if (cred === 'each') {
      const others = alive(g).filter(i => i !== pi);
      const per = Math.floor(p.cash / others.length);
      others.forEach(i => { g.players[i].cash += per; });
    }
    mine.forEach(i => {
      const pr = g.props[i];
      pr.owner = -1; pr.mortgaged = false;
      queue.push(i);
    });
    p.jailCards.forEach(c => g.decks[c.deck].push(c.id));
    log(g, `${p.name} is bankrupt! Their properties return to the bank.`);
  }
  p.cash = 0; p.jailCards = []; p.bankrupt = true; p.inJail = false;
  evt(g, { k: 'bankrupt', pi });
  g.debt = null;
  if (g.trade && (g.trade.from === pi || g.trade.to === pi)) g.trade = null;
  const left = alive(g);
  if (left.length === 1) {
    g.status = 'over'; g.phase = 'over'; g.winner = left[0];
    log(g, `🏆 ${g.players[left[0]].name} wins the game!`);
    return;
  }
  if (queue.length && g.options.auction) {
    g.auctionQueue = queue.slice(1);
    g.afterAuction = 'endturn';
    startAuction(g, queue[0]);
  } else {
    nextTurn(g);
  }
}

// ---------------------------------------------------------------- property management

// Validates (and unless dry, performs) a build / sell / mortgage / unmortgage.
function manage(g, as, type, i, dry) {
  const sp = SPACES[i], pr = g.props[i], p = g.players[as];
  if (!sp || !pr) return 'Not a property';
  if (g.phase === 'auction') return 'Not during an auction';
  if (pr.owner !== as) return 'You do not own that';
  const grp = GROUPS[sp.group];
  switch (type) {
    case 'build': {
      if (sp.type !== 'prop') return 'Cannot build here';
      if (!ownsGroup(g, as, sp.group)) return 'Need the full colour set';
      if (grp.some(j => g.props[j].mortgaged)) return 'Unmortgage the whole set first';
      if (pr.houses >= 5) return 'Already a hotel';
      if (g.options.evenBuild && grp.some(j => g.props[j].houses < pr.houses)) return 'Build evenly across the set';
      if (p.cash < sp.hc) return `Need $${sp.hc}`;
      if (pr.houses === 4 ? g.hotelsLeft < 1 : g.housesLeft < 1) return 'None left in the bank';
      if (dry) return null;
      p.cash -= sp.hc;
      if (pr.houses === 4) { g.hotelsLeft--; g.housesLeft += 4; } else g.housesLeft--;
      pr.houses++;
      log(g, `${p.name} built a ${pr.houses === 5 ? 'hotel' : 'house'} on ${sp.name}.`);
      return null;
    }
    case 'sell': {
      if (pr.houses < 1) return 'No buildings';
      if (g.options.evenBuild && grp.some(j => g.props[j].houses > pr.houses)) return 'Sell evenly across the set';
      if (pr.houses === 5 && g.housesLeft < 4) return 'Not enough houses in the bank to downgrade';
      if (dry) return null;
      if (pr.houses === 5) { g.hotelsLeft++; g.housesLeft -= 4; } else g.housesLeft++;
      pr.houses--;
      p.cash += sp.hc / 2;
      log(g, `${p.name} sold a building on ${sp.name} for $${sp.hc / 2}.`);
      return null;
    }
    case 'mortgage': {
      if (pr.mortgaged) return 'Already mortgaged';
      if (hasBuildings(g, sp.group)) return 'Sell buildings in the set first';
      if (dry) return null;
      pr.mortgaged = true; p.cash += mortgageValue(i);
      log(g, `${p.name} mortgaged ${sp.name} for $${mortgageValue(i)}.`);
      return null;
    }
    case 'unmortgage': {
      if (!pr.mortgaged) return 'Not mortgaged';
      if (p.cash < unmortgageCost(i)) return `Need $${unmortgageCost(i)}`;
      if (dry) return null;
      pr.mortgaged = false; p.cash -= unmortgageCost(i);
      log(g, `${p.name} paid $${unmortgageCost(i)} to unmortgage ${sp.name}.`);
      return null;
    }
  }
  return 'Unknown action';
}

// ---------------------------------------------------------------- trading

function cleanSide(s) {
  return {
    cash: Math.max(0, Math.floor(+s.cash || 0)),
    props: (s.props || []).map(Number),
    cards: Math.max(0, Math.floor(+s.cards || 0)),
  };
}

function checkSide(g, pi, s) {
  const p = g.players[pi];
  if (s.cash > p.cash) return `${p.name} doesn't have $${s.cash}`;
  if (s.cards > p.jailCards.length) return `${p.name} doesn't have that many jail cards`;
  for (const i of s.props) {
    if (!g.props[i] || g.props[i].owner !== pi) return `${p.name} doesn't own ${SPACES[i] ? SPACES[i].name : '?'}`;
    if (hasBuildings(g, SPACES[i].group)) return `Sell buildings on the ${GROUP_NAMES[SPACES[i].group]} set before trading it`;
  }
  return null;
}

function applyTrade(g) {
  const t = g.trade;
  const A = g.players[t.from], B = g.players[t.to];
  const e = checkSide(g, t.from, t.offer) || checkSide(g, t.to, t.request);
  if (e) return e;
  A.cash += t.request.cash - t.offer.cash;
  B.cash += t.offer.cash - t.request.cash;
  const fee = (list, receiver) => list.reduce((s, i) => s + (g.props[i].mortgaged ? Math.ceil(mortgageValue(i) * 0.1) : 0), 0);
  const feeA = fee(t.request.props), feeB = fee(t.offer.props);
  if (A.cash < feeA || B.cash < feeB) {
    // undo cash exchange
    A.cash -= t.request.cash - t.offer.cash;
    B.cash -= t.offer.cash - t.request.cash;
    return 'Not enough cash to pay the 10% mortgage transfer fee';
  }
  A.cash -= feeA; B.cash -= feeB;
  t.offer.props.forEach(i => { g.props[i].owner = t.to; });
  t.request.props.forEach(i => { g.props[i].owner = t.from; });
  B.jailCards.push(...A.jailCards.splice(0, t.offer.cards));
  A.jailCards.push(...B.jailCards.splice(0, t.request.cards));
  log(g, `${A.name} and ${B.name} completed a trade.`);
  g.trade = null;
  return null;
}

// ---------------------------------------------------------------- actions

function run(g, as, m) {
  if (g.status !== 'playing') return 'Game is over';
  const p = g.players[as];
  if (!p || p.bankrupt) return 'Invalid player';
  const isTurn = as === g.turn;
  switch (m.type) {
    case 'roll':
      if (!isTurn || !(g.phase === 'roll' || (g.phase === 'post' && g.rolledDoubles))) return 'Not your roll';
      doRoll(g, as);
      return null;
    case 'endTurn':
      if (!isTurn || g.phase !== 'post' || g.rolledDoubles) return "Can't end turn now";
      nextTurn(g);
      return null;
    case 'payJail':
      if (!isTurn || g.phase !== 'roll' || !p.inJail) return 'Not in jail';
      if (p.cash < jailFine(g)) return `Need $${jailFine(g)}`;
      charge(g, as, jailFine(g), 'pot', 'post', { why: 'jailfee' });
      p.inJail = false; p.jailTurns = 0;
      log(g, `${p.name} paid $${jailFine(g)} to leave Jail.`);
      return null;
    case 'useCard': {
      if (!isTurn || g.phase !== 'roll' || !p.inJail) return 'Not in jail';
      const c = p.jailCards.shift();
      if (!c) return 'No card';
      g.decks[c.deck].push(c.id);
      p.inJail = false; p.jailTurns = 0;
      log(g, `${p.name} used a Get Out of Jail Free card.`);
      return null;
    }
    case 'buy': {
      if (!isTurn || g.phase !== 'buy') return 'Nothing to buy';
      const idx = g.buy.idx, price = SPACES[idx].price;
      if (p.cash < price) return `Need $${price}`;
      p.cash -= price; g.props[idx].owner = as;
      evt(g, { k: 'buy', pi: as, idx, price });
      log(g, `${p.name} bought ${SPACES[idx].name} for $${price}.`);
      g.buy = null; g.phase = 'post';
      return null;
    }
    case 'decline': {
      if (!isTurn || g.phase !== 'buy') return 'Nothing to decline';
      const idx = g.buy.idx;
      g.buy = null;
      if (g.options.auction) { g.afterAuction = 'post'; startAuction(g, idx); }
      else { g.phase = 'post'; log(g, `${p.name} passed on ${SPACES[idx].name}.`); }
      return null;
    }
    case 'bid': {
      const a = g.auction;
      if (!a || a.cur !== as) return 'Not your bid';
      const amt = Math.floor(+m.amount);
      if (!(amt > a.high)) return `Bid must be above $${a.high}`;
      if (amt > p.cash) return "You can't afford that";
      a.high = amt; a.bidder = as;
      log(g, `${p.name} bids $${amt}.`);
      auctionAdvance(g);
      return null;
    }
    case 'pass': {
      const a = g.auction;
      if (!a || a.cur !== as) return 'Not your bid';
      a.active = a.active.filter(i => i !== as);
      log(g, `${p.name} passes.`);
      auctionAdvance(g);
      return null;
    }
    case 'build': case 'sell': case 'mortgage': case 'unmortgage':
      return manage(g, as, m.type, m.idx, false);
    case 'propose': {
      if (g.trade) return 'A trade is already pending';
      if (g.phase === 'auction') return 'Not during an auction';
      const to = +m.to;
      if (to === as || !g.players[to] || g.players[to].bankrupt) return 'Pick another player';
      const offer = cleanSide(m.offer), request = cleanSide(m.request);
      if (!offer.cash && !offer.props.length && !offer.cards && !request.cash && !request.props.length && !request.cards) return 'Empty trade';
      const e = checkSide(g, as, offer) || checkSide(g, to, request);
      if (e) return e;
      g.trade = { from: as, to, offer, request };
      log(g, `${p.name} proposed a trade to ${g.players[to].name}.`);
      return null;
    }
    case 'tradeAccept': {
      if (!g.trade || g.trade.to !== as) return 'No trade for you';
      return applyTrade(g);
    }
    case 'tradeDecline': {
      if (!g.trade || (g.trade.to !== as && g.trade.from !== as)) return 'No trade';
      log(g, `${g.players[g.trade.to].name} declined the trade${g.trade.from === as ? ' (cancelled)' : ''}.`);
      g.trade = null;
      return null;
    }
    case 'taxFlat': case 'taxPercent': {
      if (!isTurn || g.phase !== 'tax') return 'No tax to pay';
      const amt = m.type === 'taxFlat' ? 200 : incomeTaxPercent(g, as);
      g.phase = 'post';
      log(g, `${p.name} pays $${amt} income tax (${m.type === 'taxFlat' ? 'flat' : '10% of total worth'}).`);
      charge(g, as, amt, 'pot', 'post', { why: 'tax', idx: p.pos });
      return null;
    }
    case 'bankrupt':
      if (!isTurn || g.phase !== 'debt') return 'Not in debt';
      declareBankrupt(g, as);
      return null;
  }
  return 'Unknown action';
}

function exec(g, as, m) {
  g.ev = [];
  const err = run(g, as, m);
  if (!err && g.debt) settleDebt(g);
  return err;
}

// ---------------------------------------------------------------- bots

function botStep(g) {
  if (g.status !== 'playing') return false;
  if (g.trade && g.players[g.trade.to].bot) {
    const t = g.trade;
    const val = s => s.cash + s.cards * 50 + s.props.reduce((v, i) => v + SPACES[i].price, 0);
    // never give up a property that is part of a set we're close to completing
    const breaksSet = t.request.props.some(i => {
      const grp = GROUPS[SPACES[i].group];
      const need = grp.length === 2 ? 2 : grp.length - 1;
      return grp.filter(j => g.props[j].owner === t.to).length >= need;
    });
    exec(g, t.to, { type: !breaksSet && val(t.offer) >= val(t.request) * 1.25 ? 'tradeAccept' : 'tradeDecline' });
    if (g.trade) g.trade = null;
    return true;
  }
  if (g.phase === 'auction') {
    const a = g.auction, pi = a.cur, p = g.players[pi];
    if (!p.bot) return false;
    const sp = SPACES[a.idx];
    const grp = GROUPS[sp.group];
    const completes = grp.filter(j => j !== a.idx).every(j => g.props[j].owner === pi);
    const value = sp.price * (completes ? 1.5 : 0.85);
    const max = Math.min(value, p.cash - 20);
    const next = a.high === 0 ? Math.max(10, Math.floor(sp.price * 0.2 / 10) * 10) : a.high + 10;
    exec(g, pi, next <= max ? { type: 'bid', amount: next } : { type: 'pass' });
    return true;
  }
  const pi = g.turn, p = g.players[pi];
  if (!p.bot) return false;
  switch (g.phase) {
    case 'roll':
      if (p.inJail) {
        if (p.jailCards.length) { exec(g, pi, { type: 'useCard' }); return true; }
        if (p.cash > 600) { exec(g, pi, { type: 'payJail' }); return true; }
      }
      exec(g, pi, { type: 'roll' });
      return true;
    case 'buy': {
      const price = SPACES[g.buy.idx].price;
      exec(g, pi, { type: p.cash - price >= 100 ? 'buy' : 'decline' });
      return true;
    }
    case 'tax':
      exec(g, pi, { type: incomeTaxPercent(g, pi) < 200 ? 'taxPercent' : 'taxFlat' });
      return true;
    case 'debt': {
      const mine = owned(g, pi).sort((a, b) => g.props[b].houses - g.props[a].houses);
      for (const i of mine) if (g.props[i].houses > 0 && exec(g, pi, { type: 'sell', idx: i }) === null) return true;
      for (const i of mine) if (!g.props[i].mortgaged && exec(g, pi, { type: 'mortgage', idx: i }) === null) return true;
      exec(g, pi, { type: 'bankrupt' });
      return true;
    }
    case 'post': {
      const reserve = 250;
      for (const i of owned(g, pi)) {
        if (g.props[i].mortgaged && p.cash - unmortgageCost(i) >= reserve + 100) {
          if (exec(g, pi, { type: 'unmortgage', idx: i }) === null) return true;
        }
      }
      const buildable = owned(g, pi)
        .filter(i => SPACES[i].type === 'prop' && g.props[i].houses < 5)
        .sort((a, b) => g.props[a].houses - g.props[b].houses);
      for (const i of buildable) {
        if (p.cash - SPACES[i].hc >= reserve && manage(g, pi, 'build', i, true) === null) {
          exec(g, pi, { type: 'build', idx: i });
          return true;
        }
      }
      if (g.botTradeAt !== g.turnNo && !g.rolledDoubles) {
        g.botTradeAt = g.turnNo;
        const idea = botTradeIdea(g, pi);
        if (idea && !g.trade && exec(g, pi, idea) === null) return true;
      }
      exec(g, pi, { type: g.rolledDoubles ? 'roll' : 'endTurn' });
      return true;
    }
  }
  return false;
}

// Offer cash for the single property that would complete one of the bot's colour sets.
function botTradeIdea(g, pi) {
  const p = g.players[pi];
  for (const group of Object.keys(GROUPS)) {
    const members = GROUPS[group];
    const missing = members.filter(i => g.props[i].owner !== pi);
    if (missing.length !== 1 || members.length < 2) continue;
    const j = missing[0], owner = g.props[j].owner;
    if (owner < 0 || g.players[owner].bankrupt || hasBuildings(g, group)) continue;
    const cash = Math.round(SPACES[j].price * 2.5 / 10) * 10;
    if (p.cash - cash < 150) continue;
    return { type: 'propose', to: owner, offer: { cash, props: [], cards: 0 }, request: { cash: 0, props: [j], cards: 0 } };
  }
  return null;
}

return {
  SPACES, GROUPS, GROUP_COLORS, GROUP_NAMES, OWNABLE, CARDS, DEFAULTS, COLORS, ICONS,
  create, exec, botStep, manage, rentFor, netWorth, incomeTaxPercent, owned, ownsGroup, hasBuildings, alive,
  mortgageValue, unmortgageCost,
};
})();
if (typeof module !== 'undefined') module.exports = Game;
