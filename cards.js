/* Playing cards for the card games, plus the rule for keeping hands private when people share one device.
   A card is a number: 0-51 is one deck (a second deck is 52-103). */
const Cards = (() => {
  'use strict';
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const SUITS = [['♠', 'Spades'], ['♥', 'Hearts'], ['♦', 'Diamonds'], ['♣', 'Clubs']];
  const rank = c => c % 13;
  const suit = c => Math.floor((c % 52) / 13);
  const isRed = s => s === 1 || s === 2;
  const name = c => `${RANKS[rank(c)]}${SUITS[suit(c)][0]}`;
  const plural = r => (r === 0 ? 'Aces' : r === 5 ? '6s' : r > 9 ? ['Jacks', 'Queens', 'Kings'][r - 10] : `${RANKS[r]}s`);
  const sortHand = hand => hand.slice().sort((a, b) => rank(a) - rank(b) || suit(a) - suit(b));

  function shuffle(list, rng = Math.random) {
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    return list;
  }
  const deck = (copies, rng) => shuffle([...Array(52 * copies).keys()], rng);

  // A card face. As a button when it can be tapped.
  function face(c, opts = {}) {
    const tag = opts.button ? 'button' : 'span';
    const s = suit(c);
    return `<${tag} class="pcard ${isRed(s) ? 'red' : ''} ${opts.cls || ''}" ${opts.attrs || ''} aria-label="${RANKS[rank(c)]} of ${SUITS[s][1]}"><b>${RANKS[rank(c)]}</b><i>${SUITS[s][0]}</i></${tag}>`;
  }
  const back = (cls = '') => `<span class="pcard back ${cls}" aria-hidden="true"></span>`;

  /* Whose hand may this device show right now?
     One person on the device: always theirs. Several people sharing: a hand only appears after its owner taps to
     say it is them, and they hide it before passing the device on.
     where(actor, over) -> { seat, cover, handoff, next }   seat: hand to show (or null); cover: seat to ask for */
  function privacy(api) {
    let revealed = null;
    return {
      get sharing() { return api.mySeats.length > 1; },
      where(actor, over) {
        const humans = api.mySeats;
        if (!humans.length) return { seat: null };
        if (humans.length === 1) return { seat: humans[0] };
        if (over) return { seat: null };
        const need = humans.includes(actor) ? actor : null;
        if (revealed !== null) return revealed === need ? { seat: revealed } : { seat: revealed, handoff: true, next: need };
        return need !== null ? { seat: null, cover: need } : { seat: null };
      },
      reveal(seat) { revealed = seat; },
      hide() { revealed = null; },
    };
  }
  const coverHTML = who => `<div class="sea-cover"><div class="big">🙈</div><h3>Pass the device to ${Core.esc(who)}</h3><p>Everyone else, no peeking!</p></div>`;

  // A small button used by the games under their table.
  function button(parent, text, cls, onTap, disabled) {
    const b = document.createElement('button');
    b.className = cls; b.textContent = text; b.disabled = !!disabled;
    b.addEventListener('click', onTap);
    parent.appendChild(b);
    return b;
  }

  return { RANKS, SUITS, rank, suit, isRed, name, plural, sortHand, shuffle, deck, face, back, privacy, coverHTML, button };
})();
