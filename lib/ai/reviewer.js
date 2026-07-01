'use strict';

/**
 * reviewer.js — AI architecture review via the Claude API (v0.4 Pro feature).
 *
 * Sends the architecture graph to Claude and returns a list of suggestions:
 *   [{ severity: 'warning'|'info', node: '<id>'|'', message, suggestion }]
 *
 * The Anthropic SDK is loaded lazily so the core tool works without it.
 */

const { SYSTEM, SUGGESTION_SCHEMA, buildUserPrompt } = require('./prompts');

// Default to the latest, most capable model; override with LIVEARCH_MODEL.
const DEFAULT_MODEL = 'claude-opus-4-8';

class ReviewError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function loadSdk() {
  try {
    const mod = require('@anthropic-ai/sdk');
    return mod && mod.default ? mod.default : mod; // handle ESM/CJS default export
  } catch {
    throw new ReviewError('SDK_MISSING',
      'The Anthropic SDK is not installed. Run: npm install @anthropic-ai/sdk');
  }
}

/** Extract the JSON text from a Messages API response (skips thinking blocks). */
function extractJson(content) {
  const text = (content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  // Be forgiving if the model wrapped the JSON in prose/fences.
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : text;
}

/**
 * Review an architecture graph.
 * @param {object} arch  arch object from analyser.analyse().
 * @param {object} [opts]
 * @param {string} [opts.apiKey]  Anthropic API key (else ANTHROPIC_API_KEY).
 * @param {string} [opts.model]   Model id (else LIVEARCH_MODEL or the default).
 * @param {object} [opts.client]  Injected client (for testing).
 * @returns {Promise<object[]>} suggestions
 */
async function review(arch, opts = {}) {
  const apiKey = opts.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!opts.client && !apiKey) {
    throw new ReviewError('NO_API_KEY',
      'Set ANTHROPIC_API_KEY to use AI review (LiveArch Pro).');
  }
  const model = opts.model || process.env.LIVEARCH_MODEL || DEFAULT_MODEL;

  let client = opts.client;
  if (!client) {
    const Anthropic = loadSdk();
    client = new Anthropic({ apiKey });
  }

  const resp = await client.messages.create({
    model,
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: SUGGESTION_SCHEMA },
    },
    system: SYSTEM,
    messages: [{ role: 'user', content: buildUserPrompt(arch) }],
  });

  let parsed;
  try {
    parsed = JSON.parse(extractJson(resp.content));
  } catch {
    throw new ReviewError('BAD_RESPONSE', 'Could not parse the model response as JSON.');
  }
  return Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
}

module.exports = { review, ReviewError, DEFAULT_MODEL };
