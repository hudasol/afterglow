// Starts the API server and the web dev server together and stops both on exit.
import { spawn } from 'node:child_process';

const commands = [
  ['server', 'npm', ['run', 'dev:server']],
  ['web', 'npm', ['run', 'dev:web']],
];

const children = commands.map(([name, cmd, args]) => {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  const prefix = (stream) => (chunk) => {
    for (const line of String(chunk).split('\n')) {
      if (line.trim() !== '') stream.write(`[${name}] ${line}\n`);
    }
  };
  child.stdout.on('data', prefix(process.stdout));
  child.stderr.on('data', prefix(process.stderr));
  child.on('exit', (code) => {
    if (!stopping) {
      console.error(`[${name}] exited with code ${code}. Stopping.`);
      stop(code ?? 1);
    }
  });
  return child;
});

let stopping = false;
function stop(code = 0) {
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 300);
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

console.log('API on http://127.0.0.1:8788 and web on http://127.0.0.1:5173. Open the web address.');
