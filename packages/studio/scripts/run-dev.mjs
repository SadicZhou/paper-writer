import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..', '..');

const tsxPath = path.join(root, 'node_modules', '.pnpm', 'tsx@4.21.0', 'node_modules', 'tsx', 'dist', 'cli.mjs');
const vitePath = path.join(root, 'node_modules', '.pnpm', 'vite@6.4.1_@types+node@22.1_4a693eca497d8b1590f230ff11b5192b', 'node_modules', 'vite', 'bin', 'vite.js');

const studioDir = path.resolve(__dirname, '..');

const server = spawn(process.execPath, [tsxPath, 'watch', '--clear-screen=false', 'src/api/index.ts'], {
  cwd: studioDir,
  env: { ...process.env, INKOS_STUDIO_PORT: '4569', INKOS_PROJECT_ROOT: '../..' },
  stdio: 'inherit',
});

const client = spawn(process.execPath, [vitePath, '--host', '--port', '4567'], {
  cwd: studioDir,
  stdio: 'pipe',
});

client.stdout.on('data', (d) => process.stdout.write('[vite] ' + d));
client.stderr.on('data', (d) => process.stderr.write('[vite:err] ' + d));
client.on('error', (err) => {
  console.error('Vite process error:', err.message);
});

client.on('close', (code) => {
  console.error('Vite process exited with code:', code);
});

function cleanup() {
  server.kill();
  client.kill();
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
