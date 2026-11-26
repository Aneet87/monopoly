/* Board themes. Only names, icons and colours change; prices and rents stay the same.
   `names` maps board position -> new name for the 28 ownable spaces:
   1,3 brown | 5 rail | 6,8,9 light blue | 11,13,14 pink | 12 utility | 15 rail | 16,18,19 orange
   21,23,24 red | 25 rail | 26,27,29 yellow | 28 utility | 31,32,34 green | 35 rail | 37,39 dark blue */
const THEMES = {
  classic: {
    name: 'Hometown', emoji: '🏡', blurb: 'A friendly small town, from Maple Lane to Skyline Drive.',
    rr: '🚂', util: '💡', accent: '#ffc233', accent2: '#ff8a1f', c1: '#2c4a9a', c2: '#14214a', c3: '#0d1530',
    names: {},
  },
  nyc: {
    name: 'New York City', emoji: '🗽', blurb: 'Ride the subway from Coney Island to Times Square.',
    rr: '🚇', util: '💡', accent: '#ffb300', accent2: '#ff7a00', c1: '#44506e', c2: '#1b2338', c3: '#0d1220',
    names: {
      1: 'Coney Island', 3: 'Rockaway Beach', 5: 'Penn Station',
      6: 'Bronx Zoo', 8: 'Brooklyn Bridge', 9: 'Prospect Park',
      11: 'Greenwich Village', 12: 'Con Edison', 13: 'SoHo', 14: 'Chinatown', 15: 'Grand Central',
      16: 'Yankee Stadium', 18: 'Madison Sq. Garden', 19: 'Radio City',
      21: 'Central Park', 23: 'Rockefeller Center', 24: 'Empire State Bldg', 25: 'Staten Island Ferry',
      26: 'The High Line', 27: 'Chelsea Market', 28: 'Croton Aqueduct', 29: 'Flatiron Building',
      31: 'Wall Street', 32: 'Broadway', 34: 'Madison Avenue', 35: 'Port Authority',
      37: 'Fifth Avenue', 39: 'Times Square',
    },
  },
  japan: {
    name: 'Japan', emoji: '🗾', blurb: 'Bullet trains, castles and neon from Hakone to Shinjuku.',
    rr: '🚄', util: '💡', accent: '#ff6b8b', accent2: '#e8344f', c1: '#8a2f55', c2: '#3b1a3a', c3: '#1b0f22',
    names: {
      1: 'Hakone', 3: 'Kamakura', 5: 'Tokaido Shinkansen',
      6: 'Nikko', 8: 'Nagano', 9: 'Kanazawa',
      11: 'Nara Deer Park', 12: 'Kansai Power', 13: 'Hiroshima', 14: 'Nagasaki', 15: 'Yamanote Line',
      16: 'Osaka Castle', 18: 'Himeji Castle', 19: 'Fushimi Inari',
      21: 'Okinawa Beach', 23: 'Hokkaido Snow', 24: 'Kyoto Gion', 25: 'Hokuriku Shinkansen',
      26: 'Tokyo Tower', 27: 'Shibuya Crossing', 28: 'Tokyo Waterworks', 29: 'Akihabara',
      31: 'Ginza', 32: 'Mt. Fuji', 34: 'Tokyo Skytree', 35: 'Narita Express',
      37: 'Imperial Palace', 39: 'Shinjuku',
    },
  },
  world: {
    name: 'World Tour', emoji: '🌍', blurb: 'Collect famous cities on every continent.',
    rr: '🚆', util: '💡', accent: '#2dd4bf', accent2: '#0ea5a4', c1: '#1f6f78', c2: '#0f3a4a', c3: '#081c28',
    names: {
      1: 'Marrakech', 3: 'Cairo', 5: 'Orient Express',
      6: 'Bangkok', 8: 'Mumbai', 9: 'Istanbul',
      11: 'Rio de Janeiro', 12: 'Three Gorges Dam', 13: 'Buenos Aires', 14: 'Mexico City', 15: 'Trans-Siberian',
      16: 'Cape Town', 18: 'Moscow', 19: 'Sydney',
      21: 'Rome', 23: 'Barcelona', 24: 'Dubai', 25: 'Eurostar',
      26: 'Singapore', 27: 'Seoul', 28: 'Panama Canal', 29: 'Hong Kong',
      31: 'Berlin', 32: 'Paris', 34: 'London', 35: 'Shanghai Maglev',
      37: 'New York', 39: 'Tokyo',
    },
  },
  space: {
    name: 'Space Voyage', emoji: '🚀', blurb: 'Settle the Moon, Mars and the stars beyond.',
    rr: '🚀', util: '☀️', accent: '#a78bfa', accent2: '#7c5cff', c1: '#4b2f8f', c2: '#1b1346', c3: '#0b0824',
    names: {
      1: 'Lunar Outpost', 3: 'Crater Camp', 5: 'Moon Shuttle',
      6: 'Mercury Mine', 8: 'Venus Cloud City', 9: 'Earth Orbit',
      11: 'Mars Colony', 12: 'Solar Array', 13: 'Olympus Mons', 14: 'Valles Marineris', 15: 'Mars Express',
      16: 'Asteroid Belt', 18: 'Ceres Dome', 19: 'Vesta Base',
      21: 'Jupiter Station', 23: 'Europa Ice Base', 24: 'Io Volcano', 25: 'Comet Cruiser',
      26: 'Saturn Rings', 27: 'Titan Harbor', 28: 'Fusion Reactor', 29: 'Enceladus Springs',
      31: 'Uranus Outpost', 32: 'Neptune Deepport', 34: 'Pluto Gate', 35: 'Warp Gate',
      37: 'Alpha Centauri', 39: 'Andromeda',
    },
  },
  fantasy: {
    name: 'Fantasy Kingdom', emoji: '🐉', blurb: 'Dragons, wizards and a throne to win.',
    rr: '🐉', util: '✨', accent: '#86efac', accent2: '#34d399', c1: '#1f7a4d', c2: '#0f3d2b', c3: '#08201a',
    names: {
      1: 'Goblin Market', 3: 'Mushroom Hollow', 5: 'Griffin Express',
      6: 'Elven Glade', 8: 'Mermaid Lagoon', 9: 'Fairy Meadow',
      11: 'Dwarf Mines', 12: 'Wishing Well', 13: 'Troll Bridge', 14: 'Halfling Hamlet', 15: 'Magic Carpet',
      16: 'Wizard Tower', 18: "Dragon's Lair", 19: 'Phoenix Roost',
      21: 'Enchanted Forest', 23: 'Crystal Caverns', 24: 'Griffin Peak', 25: 'Dragon Flight',
      26: 'Moonlit Lake', 27: 'Unicorn Meadow', 28: 'Fountain of Youth', 29: 'Giant Beanstalk',
      31: 'Silver Castle', 32: 'Royal Library', 34: "Knight's Keep", 35: 'Pegasus Post',
      37: 'Crown Jewel Vault', 39: 'Royal Palace',
    },
  },
  sweets: {
    name: 'Sweet Treats', emoji: '🍭', blurb: 'A candy-coated board from Lollipop Lane to Cake Palace.',
    rr: '🍬', util: '🍯', accent: '#f9a8d4', accent2: '#ec4899', c1: '#a23b86', c2: '#4a1a58', c3: '#230c2e',
    names: {
      1: 'Gumdrop Gardens', 3: 'Lollipop Lane', 5: 'Licorice Line',
      6: 'Blueberry Bay', 8: 'Mint Meadows', 9: 'Soda Springs',
      11: 'Strawberry Fields', 12: 'Sugar Mill', 13: 'Bubblegum Bay', 14: 'Cupcake Corner', 15: 'Jellybean Express',
      16: 'Donut Drive', 18: 'Pretzel Plaza', 19: 'Waffle Way',
      21: 'Chocolate Falls', 23: 'Fudge Factory', 24: 'Caramel Cove', 25: 'Taffy Train',
      26: 'Lemon Drop Hill', 27: 'Banana Split Bay', 28: 'Syrup Spring', 29: 'Honey Hollow',
      31: 'Pistachio Park', 32: 'Gelato Gardens', 34: 'Sundae Square', 35: 'Peppermint Railway',
      37: 'Candy Castle', 39: 'Grand Cake Palace',
    },
  },
};
