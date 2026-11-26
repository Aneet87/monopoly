/* Property Tycoon rules engine. Pure state + functions; no DOM access. */
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
const CH = { name: 'Surprise', type: 'chance' };
const CC = { name: 'Town Fund', type: 'chest' };
const R_PINK = [10, 50, 150, 450, 625, 750];
const R_ORANGE = [14, 70, 200, 550, 750, 950];
const R_RED = [18, 90, 250, 700, 875, 1050];
const R_YELLOW = [22, 110, 330, 800, 975, 1150];
const R_GREEN = [26, 130, 390, 900, 1100, 1275];

const SPACES = [
  { name: 'GO', type: 'go' },
  P('Maple Lane', 'brown', 60, [2, 10, 30, 90, 160, 250], 50),
  CC,
  P('Willow Walk', 'brown', 60, [4, 20, 60, 180, 320, 450], 50),
  { name: 'Income Tax', type: 'tax', tax: 200 },
  RR('North Station'),
  P('Harbor Street', 'lblue', 100, [6, 30, 90, 270, 400, 550], 50),
  CH,
  P('Lighthouse Road', 'lblue', 100, [6, 30, 90, 270, 400, 550], 50),
  P('Seashell Drive', 'lblue', 120, [8, 40, 100, 300, 450, 600], 50),
  { name: 'Jail', type: 'jail' },
  P('Rose Court', 'pink', 140, R_PINK, 100),
  UT('Power Company'),
  P('Orchard Way', 'pink', 140, R_PINK, 100),
  P('Blossom Avenue', 'pink', 160, [12, 60, 180, 500, 700, 900], 100),
  RR('East Station'),
  P('Sunset Strip', 'orange', 180, R_ORANGE, 100),
  CC,
  P('Market Square', 'orange', 180, R_ORANGE, 100),
  P('Festival Street', 'orange', 200, [16, 80, 220, 600, 800, 1000], 100),
  { name: 'Free Parking', type: 'free' },
  P('Firefly Avenue', 'red', 220, R_RED, 150),
  CH,
  P('Garnet Boulevard', 'red', 220, R_RED, 150),
  P('Cardinal Circle', 'red', 240, [20, 100, 300, 750, 925, 1100], 150),
  RR('South Station'),
  P('Honey Hill', 'yellow', 260, R_YELLOW, 150),
  P('Goldcrest Avenue', 'yellow', 260, R_YELLOW, 150),
  UT('Water Company'),
  P('Sunflower Gardens', 'yellow', 280, [24, 120, 360, 850, 1025, 1200], 150),
  { name: 'Go To Jail', type: 'gotojail' },
  P('Evergreen Terrace', 'green', 300, R_GREEN, 200),
  P('Cedar Ridge', 'green', 300, R_GREEN, 200),
  CC,
  P('Emerald Heights', 'green', 320, [28, 150, 450, 1000, 1200, 1400], 200),
  RR('West Station'),
  CH,
  P('Crown Plaza', 'dblue', 350, [35, 175, 500, 1100, 1300, 1500], 200),
  { name: 'Luxury Tax', type: 'tax', tax: 100 },
  P('Skyline Drive', 'dblue', 400, [50, 200, 600, 1400, 1700, 2000], 200),
];

const GROUPS = {};
SPACES.forEach((s, i) => { if (s.group) (GROUPS[s.group] = GROUPS[s.group] || []).push(i); });
const OWNABLE = SPACES.map((s, i) => (s.group ? i : -1)).filter(i => i >= 0);

const CARDS = {
  chance: [
    { text: 'Zoom ahead to GO and collect $200.', k: 'goto', pos: 0 },
    { text: 'Take a stroll to Cardinal Circle.', k: 'goto', pos: 24 },
    { text: 'Visit Rose Court.', k: 'goto', pos: 11 },
    { text: 'Head to the next utility. Buy it if it is free; if it is owned, pay 10 times your dice.', k: 'nearest', kind: 'util' },
    { text: 'Catch a ride to the next station. If it is owned, pay double rent.', k: 'nearest', kind: 'rr' },
    { text: 'Catch a ride to the next station. If it is owned, pay double rent.', k: 'nearest', kind: 'rr' },
    { text: 'Your savings earned interest. Collect $50.', k: 'gain', amt: 50 },
    { text: 'Free pass out of jail. Hold on to it until you need it.', k: 'jailcard' },
    { text: 'Oops, you dropped your keys. Go back 3 spaces.', k: 'back', n: 3 },
    { text: 'Caught! Go straight to jail and skip your GO salary.', k: 'jail' },
    { text: 'Time to fix things up: pay $25 for each house and $100 for each hotel.', k: 'repairs', house: 25, hotel: 100 },
    { text: 'Parking ticket. Pay $15.', k: 'pay', amt: 15 },
    { text: 'Take a trip to North Station.', k: 'goto', pos: 5 },
    { text: 'Take a scenic drive to Skyline Drive.', k: 'goto', pos: 39 },
    { text: 'You throw a block party. Pay each player $50.', k: 'payeach', amt: 50 },
    { text: 'Your yard sale was a hit. Collect $150.', k: 'gain', amt: 150 },
  ],
  chest: [
    { text: 'Zoom ahead to GO and collect $200.', k: 'goto', pos: 0 },
    { text: 'The bank found money it owes you. Collect $200.', k: 'gain', amt: 200 },
    { text: "Vet bill for your pet. Pay $50.", k: 'pay', amt: 50 },
    { text: 'You sold your old bike. Collect $50.', k: 'gain', amt: 50 },
    { text: 'Free pass out of jail. Hold on to it until you need it.', k: 'jailcard' },
    { text: 'Caught! Go straight to jail and skip your GO salary.', k: 'jail' },
    { text: 'Your piggy bank is full. Collect $100.', k: 'gain', amt: 100 },
    { text: 'You were charged too much. Collect $20.', k: 'gain', amt: 20 },
    { text: "Happy birthday! Every player gives you $10.", k: 'collecteach', amt: 10 },
    { text: 'You won the town raffle. Collect $100.', k: 'gain', amt: 100 },
    { text: 'A window broke. Pay $100.', k: 'pay', amt: 100 },
    { text: 'Music lessons. Pay $50.', k: 'pay', amt: 50 },
    { text: 'You helped a neighbor move. Collect $25.', k: 'gain', amt: 25 },
    { text: 'Street repairs: pay $40 for each house and $115 for each hotel.', k: 'repairs', house: 40, hotel: 115 },
    { text: 'Your pie took second place. Collect $10.', k: 'gain', amt: 10 },
    { text: 'You found a lost treasure. Collect $100.', k: 'gain', amt: 100 },
  ],
};


// ---------------------------------------------------------------- board themes (names only; see themes.js)
const CLASSIC_NAMES = SPACES.map(s => s.name);
const CARD_ORIG = { chance: CARDS.chance.map(c => c.text), chest: CARDS.chest.map(c => c.text) };
const CARD_PLACES = [5, 11, 24, 39];   // spaces that cards mention by name

function applyTheme(key) {
  const T = (typeof THEMES !== 'undefined' && THEMES[key]) || null;
  SPACES.forEach((s, i) => { s.name = T && T.names && T.names[i] ? T.names[i] : CLASSIC_NAMES[i]; });
  ['chance', 'chest'].forEach(deck => CARDS[deck].forEach((c, k) => {
    let t = CARD_ORIG[deck][k];
    CARD_PLACES.forEach(i => { t = t.split(CLASSIC_NAMES[i]).join(SPACES[i].name); });
    c.text = t;
  }));
}

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
  theme: 'classic',     // board theme (see themes.js)
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
      name: d.name, bot: !!d.bot, level: d.level || 'medium', color: COLORS[i], icon: d.icon || ICONS[i],
      cash: o.startCash, pos: 0, inJail: false, jailTurns: 0, jailCards: [], bankrupt: false,
    })),
    props: SPACES.map(s => (s.group ? { owner: -1, houses: 0, mortgaged: false } : null)),
    turn: 0, turnNo: 0, botTradeAt: -1, phase: 'roll', dice: [1, 1], rollSeq: 0, doubles: 0, rolledDoubles: false,
    housesLeft: o.limitedHouses ? 32 : 999, hotelsLeft: o.limitedHouses ? 12 : 999,
    pot: o.freeParking ? (+o.fpStart || 0) : 0,
    decks: { chance: shuffle([...Array(16).keys()]), chest: shuffle([...Array(16).keys()]) },
    buy: null, auction: null, auctionQueue: [], afterAuction: 'post',
    debt: null, trade: null, log: [], winner: -1, lastCard: null, cardSeq: 0,
    buildLog: [], tradeMemory: [], hold: false,
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
  log(g, `${p.name} drew ${deck === 'chance' ? 'Surprise' : 'Town Fund'}: ${card.text}`);
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
  g.buildLog = [];   // building purchases can be undone only until the turn ends
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

// The building purchase this player could still undo this turn (most recent first), or null.
function lastBuild(g, pi) {
  const ops = (g.buildLog || []).filter(o => o.pi === pi);
  const op = ops[ops.length - 1];
  if (!op) return null;
  const pr = g.props[op.idx];
  return pr && pr.owner === pi && pr.houses === op.after ? op : null;
}

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
      (g.buildLog = g.buildLog || []).push({ pi: as, idx: i, cost: sp.hc, hotel: pr.houses === 5, after: pr.houses });
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
    case 'undoBuild': {
      if (g.phase === 'auction') return 'Not during an auction';
      const op = lastBuild(g, as);
      if (!op) return 'Nothing to undo. Purchases can only be undone before the turn ends.';
      const pr = g.props[op.idx], sp = SPACES[op.idx];
      if (op.hotel) {
        if (g.housesLeft < 4) return 'Not enough houses in the bank to undo the hotel';
        g.hotelsLeft++; g.housesLeft -= 4;
      } else g.housesLeft++;
      pr.houses--;
      p.cash += op.cost;
      g.buildLog.splice(g.buildLog.indexOf(op), 1);
      log(g, `${p.name} undid the ${op.hotel ? 'hotel' : 'house'} on ${sp.name} and got $${op.cost} back.`);
      return null;
    }
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
      // computer players remember refused offers so they don't repeat them
      g.tradeMemory = (g.tradeMemory || []).concat(JSON.stringify([g.trade.from, g.trade.to, g.trade.offer, g.trade.request])).slice(-40);
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
// Computer players have a skill level, stored on the player as p.level:
//   easy   - plays on gut feel: skips some buys, bids low, builds slowly, never proposes trades,
//            and accepts any trade that looks "fair on paper" (sticker prices only)
//   medium - the classic computer: buys when it has a cushion, builds steadily, offers simple trades
//   hard   - plays to win: values colour sets and blocking, fights for full colour sets at auction, builds fast on
//            the best sets, stays in jail late in the game, raises cash smartly, and judges every trade by how it
//            changes its position (completing its sets, denying yours, swaps that help both sides)

const lvl = p => (p && p.level) || 'medium';

// How valuable each colour group is to hold (relative to its price), and the total price of each group.
const GW = { brown: 1.0, lblue: 1.1, pink: 1.25, orange: 1.5, red: 1.4, yellow: 1.3, green: 1.2, dblue: 1.3, rr: 0.9, util: 0.5 };
const GSUM = {};
Object.keys(GROUPS).forEach(k => { GSUM[k] = GROUPS[k].reduce((s, i) => s + SPACES[i].price, 0); });
// share of the full-set bonus you get for holding N of the group
const SET_CURVE = { 2: [0, 0.05, 1], 3: [0, 0.04, 0.22, 1], 4: [0, 0.05, 0.15, 0.35, 0.7] };
const setBonus = (group, cnt) => (SET_CURVE[GROUPS[group].length][cnt] || 0) * GSUM[group] * GW[group] * (group === 'util' ? 0.5 : group === 'rr' ? 1 : 0.9);
const threat = group => GSUM[group] * GW[group] * (group === 'rr' ? 0.2 : group === 'util' ? 0.08 : 0.4);
const naive = s => s.cash + s.cards * 50 + s.props.reduce((v, i) => v + SPACES[i].price, 0);

// A rough "how strong is this player's property position" score (cash not included).
function portfolio(g, X) {
  let v = 0;
  for (const group of Object.keys(GROUPS)) {
    const mem = GROUPS[group], size = mem.length, counts = {};
    let cnt = 0;
    for (const j of mem) {
      const o = g.props[j].owner;
      if (o === X) { cnt++; v += SPACES[j].price * (g.props[j].mortgaged ? 0.55 : 1) + g.props[j].houses * (SPACES[j].hc || 0) * 0.9; }
      if (o >= 0) counts[o] = (counts[o] || 0) + 1;
    }
    v += setBonus(group, cnt);
    const full = Object.keys(counts).find(o => counts[o] === size);
    if (full !== undefined && +full !== X) v -= threat(group);                                  // someone else owns the whole set
    else if (cnt === 1 && Object.keys(counts).some(o => +o !== X && counts[o] === size - 1)) v += threat(group) * 0.35;   // we are blocking them
  }
  return v;
}

// How much better (or worse) off player X would be if trade t went through.
function tradeDelta(g, X, t) {
  const before = portfolio(g, X);
  t.offer.props.forEach(i => { g.props[i].owner = t.to; });
  t.request.props.forEach(i => { g.props[i].owner = t.from; });
  const after = portfolio(g, X);
  t.offer.props.forEach(i => { g.props[i].owner = t.from; });
  t.request.props.forEach(i => { g.props[i].owner = t.to; });
  const gain = X === t.from ? t.request : t.offer, give = X === t.from ? t.offer : t.request;
  return after - before + gain.cash - give.cash + 50 * (gain.cards - give.cards);
}

function botAcceptsTrade(g, t) {
  const X = t.to, p = g.players[X], L = lvl(p);
  if (L === 'easy') return naive(t.offer) >= naive(t.request) * 0.9;
  if (p.cash - t.request.cash + t.offer.cash < 50) return false;
  const d = tradeDelta(g, X, t), base = Math.max(naive(t.request), 50);
  return L === 'hard' ? d >= Math.max(30, 0.15 * base) : d >= Math.max(15, 0.08 * base);
}

const tradeable = (g, pi) => owned(g, pi).filter(i => !hasBuildings(g, SPACES[i].group));

// Look for a trade that helps the bot and that the other player would plausibly take: a single property for cash,
// or (for hard bots) property swaps, with cash added to even things out.
function botTradeIdea(g, pi) {
  const p = g.players[pi], L = lvl(p);
  if (L === 'easy') return null;
  const reserve = L === 'hard' ? 200 : 150;
  const remembered = new Set(g.tradeMemory || []);
  const mine = tradeable(g, pi);
  const gives = [[]];
  mine.forEach(a => gives.push([a]));
  if (L === 'hard') for (let a = 0; a < mine.length; a++) for (let b = a + 1; b < mine.length; b++) gives.push([mine[a], mine[b]]);
  let best = null;
  for (const y of alive(g)) {
    if (y === pi) continue;
    const Y = g.players[y];
    for (const j of tradeable(g, y)) {
      const probe = { from: pi, to: y, offer: { cash: 0, props: [], cards: 0 }, request: { cash: 0, props: [j], cards: 0 } };
      if (tradeDelta(g, pi, probe) - SPACES[j].price < 40) continue;   // not worth chasing
      for (const gv of gives) {
        const t = { from: pi, to: y, offer: { cash: 0, props: gv, cards: 0 }, request: { cash: 0, props: [j], cards: 0 } };
        const margin = Math.max(15, 0.08 * naive(t.request));
        const dY = tradeDelta(g, y, t);
        let c;   // cash I add (positive) or ask for (negative) to even it out
        if (dY >= margin) c = -Math.min(Math.floor((dY - margin) * 0.5 / 10) * 10, Math.max(0, Y.cash - 50));
        else c = Math.ceil((margin - dY) / 10) * 10;
        const dX0 = tradeDelta(g, pi, t), N0 = naive(t.offer);
        if (c > 0) {   // can't afford the "ideal" price? offer the most we comfortably can and still come out ahead
          const afford = Math.floor((p.cash - reserve) / 10) * 10;
          const worth = Math.floor(Math.min(dX0 - 30, (dX0 - 0.12 * N0) / 1.12) / 10) * 10;
          c = Math.min(c, afford, worth);
          if (c < 10) continue;
          t.offer.cash = c;
        } else if (c < 0) t.request.cash = -c;
        if (naive(t.offer) < naive(t.request) * 0.9) continue;   // never make an insulting lowball offer
        const dX = tradeDelta(g, pi, t);
        if (dX < Math.max(30, 0.12 * Math.max(naive(t.offer), 60))) continue;
        if (remembered.has(JSON.stringify([pi, y, t.offer, t.request]))) continue;
        if (checkSide(g, pi, t.offer) || checkSide(g, y, t.request)) continue;
        if (!best || dX > best.dX) best = { dX, t };
      }
    }
  }
  return best ? { type: 'propose', to: best.t.to, offer: best.t.offer, request: best.t.request } : null;
}

// How a property fits this player's plans: does it complete their set, or stop an opponent from completing one?
function standing(g, pi, idx) {
  const mem = GROUPS[SPACES[idx].group];
  const mineN = mem.filter(j => j !== idx && g.props[j].owner === pi).length;
  const blocks = mem.length >= 2 && alive(g).some(o => o !== pi && mem.filter(j => j !== idx && g.props[j].owner === o).length === mem.length - 1);
  return { mineN, completes: mineN === mem.length - 1, blocks };
}

const BUILD_ORDER = ['orange', 'red', 'lblue', 'pink', 'yellow', 'green', 'dblue', 'brown'];
const lateGame = g => OWNABLE.filter(i => g.props[i].owner === -1).length <= 6;

function botStep(g) {
  if (g.status !== 'playing') return false;
  if (g.trade && g.players[g.trade.to].bot) {
    exec(g, g.trade.to, { type: botAcceptsTrade(g, g.trade) ? 'tradeAccept' : 'tradeDecline' });
    if (g.trade) g.trade = null;
    return true;
  }
  if (g.phase === 'auction') {
    const a = g.auction, pi = a.cur, p = g.players[pi], L = lvl(p);
    if (!p.bot) return false;
    const sp = SPACES[a.idx], st = standing(g, pi, a.idx);
    let value, keep;
    if (L === 'easy') { value = sp.price * (0.5 + 0.3 * (((a.idx * 7 + g.turnNo * 3) % 10) / 10)); keep = 60; }
    else if (L === 'hard') { value = sp.price * (st.completes ? 2.0 : st.blocks ? 1.35 : 0.9 + 0.12 * st.mineN); keep = st.completes ? 20 : 100; }
    else { value = sp.price * (st.completes ? 1.5 : 0.85); keep = 20; }
    const max = Math.min(value, p.cash - keep);
    const next = a.high === 0 ? Math.max(10, Math.floor(sp.price * 0.2 / 10) * 10) : a.high + 10;
    exec(g, pi, next <= max ? { type: 'bid', amount: next } : { type: 'pass' });
    return true;
  }
  const pi = g.turn, p = g.players[pi], L = lvl(p);
  if (!p.bot) return false;
  switch (g.phase) {
    case 'roll':
      if (p.inJail) {
        if (p.jailCards.length) { exec(g, pi, { type: 'useCard' }); return true; }
        const fine = jailFine(g);
        const pay = L === 'hard' ? !lateGame(g) && p.cash > fine + 300 : L === 'easy' ? p.cash > fine + 150 : p.cash > 600;
        if (pay) { exec(g, pi, { type: 'payJail' }); return true; }
      }
      exec(g, pi, { type: 'roll' });
      return true;
    case 'buy': {
      const idx = g.buy.idx, price = SPACES[idx].price, left = p.cash - price;
      let yes;
      if (L === 'easy') yes = left >= 50 && (((idx * 5 + g.turnNo) % 10) < 7);
      else if (L === 'hard') {
        const st = standing(g, pi, idx), late = g.props.some(pr => pr && pr.houses >= 3);
        const reserve = late ? 250 : 120;
        yes = left >= 0 && (st.completes || (st.blocks && left >= 50) || (st.mineN >= 1 && left >= reserve * 0.7) || left >= reserve);
      } else yes = left >= 100;
      exec(g, pi, { type: yes ? 'buy' : 'decline' });
      return true;
    }
    case 'tax':
      exec(g, pi, { type: incomeTaxPercent(g, pi) < 200 ? 'taxPercent' : 'taxFlat' });
      return true;
    case 'debt': {
      const mine = owned(g, pi);
      const sellFirst = mine.slice().sort((a, b) => g.props[b].houses - g.props[a].houses);
      const sellHouses = () => { for (const i of sellFirst) if (g.props[i].houses > 0 && exec(g, pi, { type: 'sell', idx: i }) === null) return true; return false; };
      const mortgage = list => { for (const i of list) if (!g.props[i].mortgaged && exec(g, pi, { type: 'mortgage', idx: i }) === null) return true; return false; };
      if (L === 'hard') {
        // cheapest to lose first: lots that aren't part of a complete set, then houses, then everything else
        const loose = mine.filter(i => !ownsGroup(g, pi, SPACES[i].group)).sort((a, b) => SPACES[a].price - SPACES[b].price);
        if (mortgage(loose) || sellHouses() || mortgage(mine)) return true;
      } else if (sellHouses() || mortgage(mine)) return true;
      exec(g, pi, { type: 'bankrupt' });
      return true;
    }
    case 'post': {
      const reserve = L === 'hard' ? 180 : L === 'easy' ? 400 : 250;
      for (const i of owned(g, pi)) {
        if (g.props[i].mortgaged && p.cash - unmortgageCost(i) >= reserve + (L === 'hard' ? 50 : 100)) {
          if (exec(g, pi, { type: 'unmortgage', idx: i }) === null) return true;
        }
      }
      let buildable = owned(g, pi).filter(i => SPACES[i].type === 'prop' && g.props[i].houses < 5);
      if (L === 'hard') {
        // aim for 3 houses on the strongest sets first, then keep going while the bank balance is healthy
        buildable.sort((a, b) => ((g.props[a].houses >= 3) - (g.props[b].houses >= 3)) ||
          (BUILD_ORDER.indexOf(SPACES[a].group) - BUILD_ORDER.indexOf(SPACES[b].group)) || (g.props[a].houses - g.props[b].houses));
      } else buildable.sort((a, b) => g.props[a].houses - g.props[b].houses);
      const slow = L === 'easy' && g.turnNo % 2 === 1;   // easy computers only build every other turn
      if (!slow) {
        for (const i of buildable) {
          const hc = SPACES[i].hc, deep = g.props[i].houses >= 3;
          if (p.cash - hc >= (L === 'hard' && deep ? 400 : reserve) && manage(g, pi, 'build', i, true) === null) {
            exec(g, pi, { type: 'build', idx: i });
            return true;
          }
        }
      }
      if (g.botTradeAt !== g.turnNo && !g.rolledDoubles) {
        g.botTradeAt = g.turnNo;
        if (L === 'hard' || L === 'medium') {
          const idea = botTradeIdea(g, pi);
          if (idea && !g.trade) {
            // don't pester people: offers to a human wait out a cooldown (computers can trade with each other freely)
            const toHuman = !g.players[idea.to].bot;
            const gap = L === 'hard' ? 12 : 16;
            if (!toHuman || g.turnNo - (p.lastOffer == null ? -99 : p.lastOffer) >= gap) {
              if (exec(g, pi, idea) === null) { if (toHuman) p.lastOffer = g.turnNo; return true; }
            }
          }
        }
      }
      exec(g, pi, { type: g.rolledDoubles ? 'roll' : 'endTurn' });
      return true;
    }
  }
  return false;
}

return {
  SPACES, GROUPS, GROUP_COLORS, GROUP_NAMES, OWNABLE, CARDS, DEFAULTS, COLORS, ICONS,
  create, exec, botStep, manage, rentFor, netWorth, incomeTaxPercent, owned, ownsGroup, hasBuildings, alive,
  mortgageValue, unmortgageCost, applyTheme, lastBuild, botAcceptsTrade, botTradeIdea, tradeDelta,
};
})();
if (typeof module !== 'undefined') module.exports = Game;
