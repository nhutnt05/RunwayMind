import { defineConfig } from 'tsup';

// Bundles the workspace TS packages (shared, agent) into dist/server.js; npm deps stay external.
export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  clean: true,
  noExternal: ['@runwaymind/shared', '@runwaymind/agent'],
});
