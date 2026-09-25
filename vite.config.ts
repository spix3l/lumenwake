import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const BUILD_ID_PLACEHOLDER = '__BUILD_ID__';

function stampServiceWorker(): Plugin {
  let outDir = 'dist';
  return {
    name: 'lumenwake:stamp-service-worker',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const file = resolve(outDir, 'sw.js');
      const source = readFileSync(file, 'utf8');
      const buildId = Date.now().toString(36);
      writeFileSync(file, source.replace(BUILD_ID_PLACEHOLDER, buildId));
    },
  };
}

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
  },
  plugins: [stampServiceWorker()],
});
