import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// WHERE THE APP IS SERVED. The app lives at a path on the universe's apex (zpe.vc/jam), and the
// mount is baked at BUILD time: Vite writes it into index.html's asset tags and into
// import.meta.env.BASE_URL, which the client reads for the socket URL. `npm run build:root` keeps
// the old root build available for a local comparison.
const BASE = process.env.SITE_BASE || '/';
const OUT = process.env.SITE_OUT || 'dist';

export default defineConfig({
  base: BASE,
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: OUT,
    sourcemap: true,
  },
});
