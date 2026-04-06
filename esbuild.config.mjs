import { build } from 'esbuild';
import { GasPlugin } from 'esbuild-gas-plugin';

const commonOptions = {
  bundle: true,
  format: 'iife',
  target: 'es2019',
  plugins: [GasPlugin],
  charset: 'utf8',
};

// Bundle main entry point (doPost + all handlers)
await build({
  ...commonOptions,
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.js',
});

// Bundle seed script
await build({
  ...commonOptions,
  entryPoints: ['src/scripts/seed.ts'],
  outfile: 'dist/seed.js',
});

// Bundle setup script
await build({
  ...commonOptions,
  entryPoints: ['src/scripts/setup.ts'],
  outfile: 'dist/setup.js',
});

console.log('Build complete → dist/');
