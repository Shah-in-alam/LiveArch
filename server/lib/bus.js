'use strict';

/**
 * bus.js — pub/sub used to fan snapshot updates out to connected SSE viewers.
 *
 * Phase 2 uses an in-process EventEmitter: correct for a single Node instance
 * (`next dev`, `next start`, or self-hosting). For multi-instance serverless on
 * Vercel, replace publish/subscribe with a shared broker (Upstash Redis pub/sub)
 * — nothing else in the app changes. See docs/BACKEND-DESIGN.md.
 */

const { EventEmitter } = require('events');

const bus = new EventEmitter();
bus.setMaxListeners(0); // many concurrent viewers

function publish(key, data) {
  bus.emit(key, data);
}

/** Subscribe to a key; returns an unsubscribe function. */
function subscribe(key, cb) {
  bus.on(key, cb);
  return () => bus.off(key, cb);
}

module.exports = { publish, subscribe };
