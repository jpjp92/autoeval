import { cpSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const standalone = join(root, '.next/standalone');

if (!existsSync(join(standalone, 'server.js'))) {
  throw new Error('Production build missing. Run npm run build first.');
}

// Next.js standalone output omits static assets; mirror Docker packaging locally.
cpSync(join(root, '.next/static'), join(standalone, '.next/static'), { recursive: true });
if (existsSync(join(root, 'public'))) {
  cpSync(join(root, 'public'), join(standalone, 'public'), { recursive: true });
}

process.env.HOSTNAME = process.env.FRONTEND_HOST || '0.0.0.0';
process.env.PORT ||= '3000';
await import(pathToFileURL(join(standalone, 'server.js')).href);
