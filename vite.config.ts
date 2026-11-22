import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Les écrans du jeu. Le serveur (server/index.ts) les sert lui-même :
// en dev via le middleware Vite, en production depuis le dossier dist/.
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
});
