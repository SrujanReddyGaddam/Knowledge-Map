import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import vault from './vault-plugin.ts';

export default defineConfig({ plugins: [react(), vault()], server: { port: Number(process.env.KM_PORT) || 7777, strictPort: true, host: 'localhost' } });
