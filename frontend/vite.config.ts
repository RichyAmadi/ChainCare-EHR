import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
/** Security headers the static web server must send (mirrors the production Nginx config). */
const securityHeaders = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};
const target = process.env.API_TARGET ?? 'http://localhost:4000';
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': target } },
  preview: { port: Number(process.env.PREVIEW_PORT ?? 4173), proxy: { '/api': target }, headers: securityHeaders },
});
