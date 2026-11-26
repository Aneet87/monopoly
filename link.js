/* The CONNECTION layer, kept on its own so it can be swapped (for example to Firebase) without touching any game.
   Today it uses PeerJS: a free service introduces the computers, then they talk to each other.
   The rest of the site only uses: Link.host(), Link.join() and Link.test(). Messages are plain objects. */
const Link = (() => {
  'use strict';
  const PREFIX = 'gamenight-';
  const CONNECT_TIMEOUT_MS = 25000;
  const STUN_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }];
  const relayList = () => (typeof RELAY_SERVERS !== 'undefined' && Array.isArray(RELAY_SERVERS) ? RELAY_SERVERS : []);
  const hasRelay = () => relayList().some(s => [].concat(s.urls || []).some(u => /^turns?:/.test(u)));

  function peerOptions() {
    const config = { iceServers: STUN_SERVERS.concat(relayList()), sdpSemantics: 'unified-plan' };
    if (new URLSearchParams(location.search).get('relayonly') === '1') config.iceTransportPolicy = 'relay';
    return { debug: 0, config };
  }
  const available = () => typeof Peer !== 'undefined';
  const parse = d => { try { return typeof d === 'string' ? JSON.parse(d) : null; } catch (e) { return null; } };
  const quietly = fn => { try { fn(); } catch (e) { /* already closed */ } };

  // If the link to the matchmaking service drops, retry with longer and longer waits. Retrying instantly can
  // flood the free service and get this network temporarily blocked.
  const RECONNECT_WAITS = [3000, 8000, 20000, 45000, 90000];
  function gentleReconnect(peer, wanted) {
    let tries = 0, timer = null;
    peer.on('open', () => { tries = 0; });
    peer.on('disconnected', () => {
      if (timer || !wanted()) return;
      timer = setTimeout(() => {
        timer = null;
        if (!peer.destroyed && peer.disconnected && wanted()) { try { peer.reconnect(); } catch (e) { /* closed */ } }
      }, RECONNECT_WAITS[Math.min(tries++, RECONNECT_WAITS.length - 1)]);
    });
  }

  // One friend's connection, as the rest of the site sees it.
  const channel = conn => ({
    send(o) { quietly(() => { if (conn.open) conn.send(JSON.stringify(o)); }); },
    close() { quietly(() => conn.close()); },
  });

  /* Open a room. handlers: { data(channel, msg), closed(channel) }
     Resolves to { close() }; rejects with 'taken' or 'error'. */
  function host(code, handlers, retries = 0) {
    return new Promise((resolve, reject) => {
      let peer, opened = false;
      try { peer = new Peer(PREFIX + code, peerOptions()); } catch (e) { reject('error'); return; }
      peer.on('open', () => { opened = true; resolve({ close: () => quietly(() => peer.destroy()) }); });
      peer.on('error', err => {
        if (opened) { console.warn('connection notice', err); return; }
        quietly(() => peer.destroy());
        if (err.type === 'unavailable-id' && retries > 0) setTimeout(() => host(code, handlers, retries - 1).then(resolve, reject), 1500);
        else reject(err.type === 'unavailable-id' ? 'taken' : 'error');
      });
      peer.on('connection', conn => {
        const ch = channel(conn);
        conn.on('data', d => { const m = parse(d); if (m) handlers.data(ch, m); });
        conn.on('close', () => handlers.closed(ch));
      });
      gentleReconnect(peer, () => true);
    });
  }

  /* Join a room. handlers: { open(channel), data(msg), lost(), fail(reason), retry() }
     reason: 'notfound' | 'service' | 'noroute'. Returns { close() }. */
  function join(code, handlers) {
    let peer = null, done = false, opened = false, timer = null, attempt = 0;
    const stop = () => { done = true; clearTimeout(timer); const p = peer; peer = null; setTimeout(() => quietly(() => p && p.destroy()), 400); };
    const end = fn => { if (done) return; stop(); fn(); };
    function start() {
      let mine;
      try { mine = peer = new Peer(peerOptions()); } catch (e) { end(() => handlers.fail('service')); return; }
      const noRoute = () => {
        if (done || opened || peer !== mine) return;
        clearTimeout(timer);
        if (attempt++ === 0) { peer = null; quietly(() => mine.destroy()); handlers.retry(); start(); } else end(() => handlers.fail('noroute'));
      };
      mine.once('open', () => {   // once: reconnecting to the service must not open a second link to the host
        if (done || peer !== mine) return;
        const conn = mine.connect(PREFIX + code, { reliable: true });
        const ch = channel(conn);
        conn.on('open', () => { if (done || peer !== mine) return; opened = true; clearTimeout(timer); handlers.open(ch); });
        conn.on('data', d => { const m = parse(d); if (m && !done) handlers.data(m); });
        conn.on('close', () => { if (peer !== mine) return; if (opened) end(handlers.lost); else noRoute(); });
        conn.on('error', () => { if (!opened) noRoute(); });
      });
      mine.on('error', err => {
        if (done || peer !== mine) return;
        if (err.type === 'peer-unavailable') end(() => handlers.fail('notfound'));
        else if (opened) { if (err.type !== 'webrtc') end(handlers.lost); }
        else if (err.type === 'webrtc') noRoute();
        else end(() => handlers.fail('service'));
      });
      gentleReconnect(mine, () => peer === mine && !done);
      clearTimeout(timer);
      timer = setTimeout(noRoute, CONNECT_TIMEOUT_MS);
    }
    start();
    return { close: stop };
  }

  const failMessage = () => 'Could not make a link to the host. Check the code and that the host has the game open on screen. ' +
    'Then try another network (for example, one person on home Wi-Fi and the other on phone data) and turn off any VPN.';

  // Plain-language check of what kind of connection this device and network can make.
  async function test() {
    try {
      const pc = new RTCPeerConnection({ iceServers: peerOptions().config.iceServers });
      const found = new Set();
      const finished = new Promise(resolve => {
        setTimeout(resolve, 10000);
        pc.onicecandidate = e => { if (!e.candidate) resolve(); else found.add(e.candidate.type); };
      });
      pc.createDataChannel('probe');
      await pc.setLocalDescription(await pc.createOffer());
      await finished;
      pc.close();
      if (found.has('relay')) return '✅ Relay is working. This device should be able to play with friends on other networks.';
      if (hasRelay()) return '❌ A relay is set up but did not answer. Check relay-settings.js, or this network is blocking it.';
      if (found.has('srflx')) return '⚠️ This device can try a direct link. It works for many pairs of networks, but not all. If joining fails, try a different network.';
      return '❌ This network blocks direct links. Turn off any VPN or try another network.';
    } catch (e) { return '❌ This browser could not run the test. Try the latest Chrome, Edge or Safari.'; }
  }

  return { host, join, test, failMessage, available };
})();
