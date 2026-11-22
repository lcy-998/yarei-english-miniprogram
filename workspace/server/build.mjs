import { rm } from 'node:fs/promises';
import { build } from 'esbuild';
await rm('dist', {recursive:true,force:true});
await build({entryPoints:{main:'src/main.ts',operator:'src/operator.ts','server.node':'test/server.node.ts','media.node':'test/media.node.ts'},outdir:'dist',outExtension:{'.js':'.cjs'},bundle:true,platform:'node',target:'node22',format:'cjs',sourcemap:true});
