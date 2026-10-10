import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import vault from './vault-plugin';

export default defineConfig({ plugins: [react(), vault()], server: { port: 7777, strictPort: true, host: 'localhost' } });
