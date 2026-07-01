'use strict';

/**
 * prompts.js — prompt templates for the AI architecture reviewer.
 */

// JSON Schema the model must return (structured outputs / output_config.format).
// `node` is a node id, or an empty string for a whole-architecture suggestion.
const SUGGESTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['suggestions'],
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'node', 'message', 'suggestion'],
        properties: {
          severity: { type: 'string', enum: ['warning', 'info'] },
          node: { type: 'string', description: 'node id, or "" for a whole-project suggestion' },
          message: { type: 'string' },
          suggestion: { type: 'string' },
        },
      },
    },
  },
};

const SYSTEM = [
  'You are a senior software architecture reviewer.',
  'You are given a machine-generated architecture graph of a codebase (tech stack, components, layers, and connections).',
  'Return concise, actionable suggestions about the architecture only — do not invent files or details that are not in the graph.',
  'Focus on: oversized/over-connected components, missing layers (auth, error handling, state, tests), possible circular dependencies, and scalability or security gaps.',
  'Prefer a small number of high-signal suggestions over many generic ones. If the architecture looks healthy, return an empty list.',
].join(' ');

/**
 * Compact the arch object into just what the model needs (keeps tokens small).
 */
function summariseArch(arch) {
  return {
    name: arch.name,
    fileCount: arch.fileCount,
    layers: (arch.layers && arch.layers.order) || [],
    nodes: (arch.nodes || []).map((n) => ({ id: n.id, label: n.label, type: n.type, layer: n.layer, file: n.file })),
    edges: (arch.edges || []).map((e) => ({ from: e.from, to: e.to, label: e.label })),
  };
}

/**
 * Build the user message for a review request.
 */
function buildUserPrompt(arch) {
  const s = summariseArch(arch);
  return [
    'Review this architecture and return JSON matching the provided schema.',
    '',
    'Architecture:',
    '- Project: ' + s.name,
    '- File count: ' + s.fileCount,
    '- Layers: ' + s.layers.join(' → '),
    '- Nodes: ' + JSON.stringify(s.nodes),
    '- Edges: ' + JSON.stringify(s.edges),
  ].join('\n');
}

module.exports = { SYSTEM, SUGGESTION_SCHEMA, summariseArch, buildUserPrompt };
