import { defineConfig } from 'vite';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  define: { __VERSION__: JSON.stringify(pkg.version) },
  build: {
    lib: { entry: 'src/omnium-enhanced-map-card.ts', formats: ['es'], fileName: () => 'omnium-enhanced-map-card.js' },
    outDir: 'dist',
    emptyOutDir: true,
  },
  // `npm run serve` exposes dist on the local network so HA can load it straight from your machine
  preview: { host: true, port: 5180, cors: true },
});
