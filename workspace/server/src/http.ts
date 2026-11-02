import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import type { LocalAuth } from './auth';
import { publicHandlers, invoke } from './runtime';
import type { HandlerName } from './handlers';
import { LocalStorage, MediaError } from './storage';

class HttpError extends Error {constructor(readonly status: number) {super('Request rejected');}}
export function createHttpServer(auth: LocalAuth,options: {origin: string; staticRoot?: string; trustProxy?: boolean; migrationComplete?: boolean; storage?: LocalStorage; authorizeUpload?:(uid:string,key:string)=>Promise<void>}) {
  let heavyRequests=0;
  const heavy=new Set(['task-command','student-work-command','task-recording-command','pronunciation-command','review-command']);
  return createServer({requestTimeout:300_000,headersTimeout:10_000,maxHeaderSize:16_384},(req,res)=>{
    void handle(req,res).catch(error=>{
      if (!res.headersSent) json(res,error instanceof HttpError || error instanceof MediaError ? error.status : 500,{error:'REQUEST_FAILED'});
      else res.destroy();
    });
  });
  async function handle(req: IncomingMessage,res: ServerResponse): Promise<void> {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Cache-Control','no-store');
    const url = new URL(req.url ?? '/',options.origin);
    if (req.method === 'GET' && url.pathname === '/healthz') {json(res,200,{status:'ok',service:'yarei-english',dataMigration:options.migrationComplete?'imported':'pending',version:'0.128.0',sourceRevision:'1644caef'}); return;}
    if (url.pathname.startsWith('/media/') && (req.method==='GET'||req.method==='HEAD') && options.storage) {await options.storage.serve(url,req,res);return;}
    if (url.pathname.startsWith('/api/')) {
      if (req.headers.origin && req.headers.origin !== options.origin) throw new HttpError(403);
      if (req.method !== 'POST') throw new HttpError(405);
      if(url.pathname==='/api/media/upload' && options.storage && options.authorizeUpload){
        const token=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization??'')?.[1]??'',uid=auth.resolve(token);if(!uid)throw new HttpError(401);
        const key=url.searchParams.get('path')??'';json(res,200,await options.storage.acceptUpload(req,key,async()=>{if(auth.resolve(token)!==uid)throw new HttpError(401);await options.authorizeUpload!(uid,key);}));return;
      }
      if (!req.headers['content-type']?.startsWith('application/json')) throw new HttpError(415);
      const body = await readJson(req);
      const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization ?? '')?.[1] ?? '';
      if (url.pathname === '/api/auth/login') {
        if (typeof body.phone !== 'string' || typeof body.password !== 'string') throw new HttpError(400);
        // Caddy overwrites X-Real-IP; the application port is bound to localhost only.
        const ip = options.trustProxy && typeof req.headers['x-real-ip'] === 'string' ? req.headers['x-real-ip'] : req.socket.remoteAddress ?? '';
        const accessToken = await auth.login(body.phone,body.password,ip);
        if (!accessToken) {json(res,401,{error:'INVALID_USERNAME_OR_PASSWORD'}); return;}
        json(res,200,{accessToken,expiresIn:7200}); return;
      }
      if (url.pathname === '/api/auth/logout') {auth.logout(token); json(res,200,{ok:true}); return;}
      const name = url.pathname.replace(/^\/api\/functions\//,'');
      if (!publicHandlers.has(name)) throw new HttpError(404);
      const uid = auth.resolve(token);
      if (!uid) throw new HttpError(401);
      const isHeavy=heavy.has(name);if(isHeavy&&heavyRequests>=1)throw new HttpError(503);
      if(isHeavy)heavyRequests++;
      try {const result=await invoke(name as HandlerName,uid,body);json(res,200,{result});}finally{if(isHeavy)heavyRequests--;}return;
    }
    if (!options.staticRoot || (req.method !== 'GET' && req.method !== 'HEAD')) throw new HttpError(404);
    const root = resolve(options.staticRoot);
    let file = resolve(root,'.'+decodeURIComponent(url.pathname));
    if (!file.startsWith(root+sep) && file !== root) throw new HttpError(404);
    try {if (!(await stat(file)).isFile()) file=resolve(root,'index.html');}
    catch {if (extname(file)) throw new HttpError(404); file=resolve(root,'index.html');}
    const data = await readFile(file);
    const mime: Record<string,string> = {'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.ico':'image/x-icon'};
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    res.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream'});
    res.end(req.method === 'HEAD' ? undefined : data);
  }
}
async function readJson(req: IncomingMessage): Promise<Record<string,unknown>> {
  const parts: Buffer[]=[]; let size=0;
  for await (const part of req) {const b=Buffer.from(part); size+=b.length; if (size>1024*1024) throw new HttpError(413); parts.push(b);}
  try {const data: unknown=JSON.parse(Buffer.concat(parts).toString('utf8')); if (!data || typeof data!=='object' || Array.isArray(data)) throw new Error(); return data as Record<string,unknown>;}
  catch {throw new HttpError(400);}
}
function json(res: ServerResponse,status: number,data: unknown) {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}
