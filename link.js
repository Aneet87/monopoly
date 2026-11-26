/* The CONNECTION layer. It passes messages between the host and friends through Google Firebase
   (Realtime Database). Think of it as an online whiteboard: one side writes a note, the other reads it
   and wipes it off. The rest of the site only uses Link.host(), Link.join(), Link.test() and Link.explain().

   Layout of one room:   rooms/CODE/meta      who the host is
                         rooms/CODE/online    true while the host has the game open
                         rooms/CODE/guests    which friends are connected right now
                         rooms/CODE/up        notes from friends to the host
                         rooms/CODE/down      notes from the host to each friend
   firebase-rules.json makes sure each friend can only read their own notes. */
const Link = (() => {
  'use strict';
  const WAIT_MS = 20000;
  const STALE_MS = 12 * 60 * 60 * 1000;   // an unused room code is free again after 12 hours

  const available = () => typeof firebase !== 'undefined' && typeof firebase.database === 'function' &&
    typeof firebase.auth === 'function' && typeof FIREBASE_CONFIG !== 'undefined';
  const parse = d => { try { return typeof d === 'string' ? JSON.parse(d) : null; } catch (e) { return null; } };
  const quietly = p => { if (p && p.catch) p.catch(() => {}); };
  const timed = (p, ms = WAIT_MS) => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });

  // What went wrong, in one word: 'setup' (anonymous sign-in off), 'rules' (access rules missing) or 'service'.
  function problem(err) {
    const text = `${(err && err.code) || ''} ${(err && err.message) || ''}`;
    if (/operation-not-allowed|admin-restricted|configuration-not-found/i.test(text)) return 'setup';
    if (/permission.denied/i.test(text)) return 'rules';
    return 'service';
  }
  function explain(why) {
    if (why === 'setup') return 'The game service is not fully set up: turn on "Anonymous" sign-in in Firebase (see HOW-TO-PLAY.txt).';
    if (why === 'rules') return 'The game service refused access. Publish the access rules in Firebase (see HOW-TO-PLAY.txt).';
    return 'Could not reach the game service. Check your internet connection, turn off any VPN or ad blocker for this page, or try another network.';
  }

  let signingIn = null;
  // Each device gets a temporary, nameless ID. Nobody types an email or password.
  function ready() {
    if (!signingIn) {
      signingIn = timed(Promise.resolve().then(() => {
        if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
        return firebase.auth().signInAnonymously();
      })).then(cred => ({ uid: cred.user.uid, db: firebase.database() }));
      signingIn.catch(() => { signingIn = null; });
    }
    return signingIn;
  }

  /* Open a room. handlers: { data(channel, msg), closed(channel) }
     Resolves to { close() }; rejects with 'taken', 'setup', 'rules' or 'service'. */
  async function host(code, handlers) {
    try {
      const { uid, db } = await ready();
      const room = db.ref('rooms/' + code);
      const meta = (await timed(room.child('meta').once('value'))).val();
      if (meta && meta.host !== uid && meta.seen > Date.now() - STALE_MS) throw new Error('taken');
      const claim = () => room.child('meta').set({ host: uid, seen: firebase.database.ServerValue.TIMESTAMP });
      await timed(claim());
      await timed(Promise.all(['guests', 'up', 'down'].map(k => room.child(k).remove())));   // clear leftovers
      return await open(db, room, claim, handlers);
    } catch (err) {
      throw err && err.message === 'taken' ? 'taken' : problem(err);
    }
  }

  function open(db, room, claim, handlers) {
    return new Promise((resolve, reject) => {
      const online = room.child('online'), guests = room.child('guests'), connected = db.ref('.info/connected');
      const links = new Map();   // "uid/sid" -> one friend's connection
      let closed = false, isConnected = false, started = false, timer = null, heartbeat = null;

      function drop(key) {
        const link = links.get(key);
        if (!link) return;
        links.delete(key);
        link.inbox.off();
        quietly(room.child('up/' + key).remove());
        quietly(room.child('down/' + key).remove());
        handlers.closed(link.channel);
      }
      function add(key) {
        const inbox = room.child('up/' + key);
        const channel = {
          send(o) { if (links.has(key)) quietly(room.child('down/' + key).push(JSON.stringify(o))); },
          close() { if (links.has(key)) { quietly(guests.child(key).remove()); drop(key); } },
        };
        links.set(key, { channel, inbox });
        inbox.on('child_added', snap => {
          const m = parse(snap.val());
          quietly(snap.ref.remove());
          if (m && links.has(key)) handlers.data(channel, m);
        });
      }
      function watchGuests() {
        guests.on('value', snap => {
          const now = new Set();
          Object.entries(snap.val() || {}).forEach(([u, sessions]) => Object.keys(sessions).forEach(s => now.add(`${u}/${s}`)));
          [...links.keys()].filter(k => !now.has(k)).forEach(drop);
          now.forEach(k => { if (!links.has(k)) add(k); });
        }, err => console.warn('room notice', err));
      }
      // Say "the host is here", and have the server erase that the moment this device disconnects.
      const announce = () => online.onDisconnect().remove().then(() => online.set(true));

      function close() {
        if (closed) return;
        closed = true;
        clearTimeout(timer); clearInterval(heartbeat);
        connected.off('value', onConnected); online.off(); guests.off();
        links.forEach(l => l.inbox.off()); links.clear();
        quietly(online.onDisconnect().cancel());
        ['online', 'guests', 'up', 'down'].forEach(k => quietly(room.child(k).remove()));
      }
      function onConnected(snap) {
        isConnected = snap.val() === true;
        if (!isConnected || closed) return;
        announce().then(() => {
          if (started || closed) return;
          started = true;
          clearTimeout(timer);
          resolve({ close });
          setTimeout(() => {
            if (closed) return;
            watchGuests();
            online.on('value', s => { if (s.val() !== true && isConnected && !closed) quietly(announce()); });
          }, 0);
        }, err => { if (!started) { close(); reject(err); } });
      }
      timer = setTimeout(() => { close(); reject(new Error('timeout')); }, WAIT_MS);
      heartbeat = setInterval(() => quietly(claim()), 30 * 60 * 1000);
      connected.on('value', onConnected);
    });
  }

  /* Join a room. handlers: { open(channel), data(msg), lost(), fail(reason) }
     reason: 'notfound' | 'setup' | 'rules' | 'service'. Returns { close() }. */
  function join(code, handlers) {
    let done = false, opened = false, cleanup = () => {};
    const stop = () => { if (done) return; done = true; cleanup(); };
    const end = fn => { if (done) return; stop(); fn(); };
    (async () => {
      const { uid, db } = await ready();
      if (done) return;
      const room = db.ref('rooms/' + code), online = room.child('online'), connected = db.ref('.info/connected');
      const here = (await timed(online.once('value'))).val() === true;
      if (done) return;
      if (!here) { end(() => handlers.fail('notfound')); return; }
      const sid = room.child('guests/' + uid).push().key;
      const mine = ['guests', 'up', 'down'].map(k => room.child(`${k}/${uid}/${sid}`));
      const [presence, outbox, inbox] = mine;
      let onOnline, onPresence, onConnected;
      cleanup = () => {
        inbox.off();
        if (onOnline) online.off('value', onOnline);
        if (onPresence) presence.off('value', onPresence);
        if (onConnected) connected.off('value', onConnected);
        // a short pause lets a last message (such as "I'm leaving") arrive first
        setTimeout(() => mine.forEach(r => { quietly(r.onDisconnect().cancel()); quietly(r.remove()); }), 400);
      };
      await timed(Promise.all(mine.map(r => r.onDisconnect().remove())));
      await timed(presence.set(true));
      if (done) { cleanup(); return; }
      opened = true;
      const channel = {
        send(o) { if (!done) quietly(outbox.push(JSON.stringify(o))); },
        close() { stop(); },
      };
      inbox.on('child_added', snap => {
        const m = parse(snap.val());
        quietly(snap.ref.remove());
        if (m && !done) handlers.data(m);
      });
      const lost = () => end(handlers.lost);
      onOnline = online.on('value', s => { if (s.val() !== true) lost(); });
      onPresence = presence.on('value', s => { if (s.val() !== true) lost(); });
      onConnected = connected.on('value', s => { if (s.val() === false) lost(); });
      if (!done) handlers.open(channel);
    })().catch(err => { console.warn('join failed', err); end(() => (opened ? handlers.lost() : handlers.fail(problem(err)))); });
    return { close: stop };
  }

  // Plain-language check that this device can use the game service.
  async function test() {
    try {
      const { db } = await ready();
      await timed(db.ref('rooms/CHECK/online').once('value'), 12000);
      return '✅ This device can reach the game service. You are ready to play.';
    } catch (err) { return '❌ ' + explain(problem(err)); }
  }

  return { host, join, test, explain, available };
})();
