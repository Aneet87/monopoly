/* RELAY SERVER SETTINGS
   Many home, phone, work and VPN networks can't connect two computers directly. A "relay" (TURN) server
   passes the game messages between them. See HOW-TO-PLAY-ONLINE.txt, "SET UP THE RELAY".

   HOW TO FILL THIS IN:
   In your Metered dashboard, copy the "ICE Servers Array". Paste it below so that it REPLACES the
   two square brackets [] after the = sign. Keep the semicolon at the end. It should look like:

   const RELAY_SERVERS = [
     { urls: "stun:..." },
     { urls: "turn:...", username: "...", credential: "..." },
   ];

   Note: this file is public on your website, so anyone who finds it could use up your free monthly
   allowance. Use a free account only, with no payment card attached. */

const RELAY_SERVERS = [];
