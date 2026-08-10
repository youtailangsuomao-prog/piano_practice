import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // GitHub Pages serves this project from /piano_practice/, not the domain root.
  base: process.env.GITHUB_PAGES ? '/piano_practice/' : '/',
  plugins: [react()],
});
