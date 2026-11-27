/* Games still to come. */
(() => {
'use strict';
[
  ['memory', 'Memory Match', '🧠', '#a45cf0', 'Flip cards and find the pairs.'],
  ['gofish', 'Go Fish', '🐟', '#12b8c9', 'Ask for cards and collect sets.'],
  ['dice', 'Dice Yacht', '🎲', '#7bd23f', 'Roll five dice and chase high scores.'],
  ['eights', 'Crazy Eights', '🃏', '#f2683c', 'Be first to play all your cards.'],
].forEach(([id, name, emoji, color, blurb]) => Core.register({ id, name, emoji, color, blurb, soon: true }));
})();
