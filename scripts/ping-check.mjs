#!/usr/bin/env node
// Standalone ping-ack check against the realtime gateway's 'ping' handler -
// curl can't reach this (it's a Socket.IO event, not an HTTP route, and the
// gateway is websocket-only). Usage:
//
//   node scripts/ping-check.mjs [BASE_URL]
//
// Defaults to http://127.0.0.1:3000.
import { io } from 'socket.io-client';

const base = process.argv[2] ?? 'http://127.0.0.1:3000';

const res = await fetch(`${base}/auth/guest`, { method: 'POST' });
if (!res.ok) {
  console.error('guest auth failed', res.status, await res.text());
  process.exit(1);
}
const { accessToken } = await res.json();

const socket = io(base, { auth: { token: accessToken }, transports: ['websocket'] });

socket.on('connect', () => {
  const sentAt = Date.now();
  socket.timeout(3000).emit('ping', sentAt, (err, response) => {
    if (err) {
      console.log('PING TIMED OUT / UNSUPPORTED:', err.message);
    } else {
      console.log('PING OK - echoed:', response, 'rtt ms:', Date.now() - sentAt);
    }
    socket.disconnect();
    process.exit(0);
  });
});

socket.on('connect_error', (e) => {
  console.error('connect_error', e.message);
  process.exit(1);
});
