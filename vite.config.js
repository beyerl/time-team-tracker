import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths keep one build working in three places: a GitHub
  // Pages project site (/time-team-tracker/), a custom domain, and the
  // file:// style asset root a Capacitor Android app serves from.
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
  },
  server: { host: true, port: 5173 },
});
