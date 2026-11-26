/* The rest of the game shelf: the property game (its own page for now) and games still to come. */
(() => {
'use strict';
Core.register({
  id: 'property', name: 'Property Tycoon', emoji: '🏙️', color: '#ffb020', blurb: 'Buy streets, build houses, collect rent. Has its own room code for now.',
  min: 2, max: 4, href: 'property.html',
});
[
  ['candy', 'Candy Trail', '🍭', '#ff7ac3', 'Follow the colours down a sweet path.'],
  ['bump', 'Bump Back', '🎯', '#ff4d6d', 'Race your pawns home and bump rivals back.'],
  ['sea', 'Sea Battle', '🚢', '#3d8bfd', 'Hunt for your rival’s hidden fleet.'],
  ['memory', 'Memory Match', '🧠', '#a45cf0', 'Flip cards and find the pairs.'],
  ['gofish', 'Go Fish', '🐟', '#12b8c9', 'Ask for cards and collect sets.'],
  ['dice', 'Dice Yacht', '🎲', '#7bd23f', 'Roll five dice and chase high scores.'],
  ['eights', 'Crazy Eights', '🃏', '#f2683c', 'Be first to play all your cards.'],
].forEach(([id, name, emoji, color, blurb]) => Core.register({ id, name, emoji, color, blurb, soon: true }));
})();
