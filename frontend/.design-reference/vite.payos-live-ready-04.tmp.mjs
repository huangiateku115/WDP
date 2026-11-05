import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ root: 'C:/Users/taing/OneDrive/Desktop/WDP/frontend', envDir: 'C:/Users/taing/AppData/Local/Packages/sandbox.{105f7362-a5c0-4cff-a627-8375ef8e7c1c}/AC/Temp/wdp-payos-live-ready-04-env', plugins: [react()], resolve: { alias: { '@': 'C:/Users/taing/OneDrive/Desktop/WDP/frontend/src' } } });
