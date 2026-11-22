import { DatabaseSync, backup } from 'node:sqlite';
import { mkdir, copyFile, readdir, rm, link, cp } from 'node:fs/promises';
import { join } from 'node:path';
process.umask(0o077);
const root=process.env.YAREI_DATA_DIR??'/var/lib/yarei-v0128';
const base=join(root,'backups');
const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+Z$/,'Z');
const destination=join(base,stamp);
await mkdir(destination,{recursive:true,mode:0o700});
try {
  for (const name of ['business.sqlite','auth.sqlite','jobs.sqlite']) {
    const source=new DatabaseSync(join(root,name),{readOnly:true});
    try {await backup(source,join(destination,name));} finally {source.close();}
  }
  await copyFile(join(root,'secrets.json'),join(destination,'secrets.json'));
  for (const directory of ['storage','retained-media']) {
    await snapshotFiles(join(root,directory),join(destination,directory)).catch(error=>{if(error.code!=='ENOENT')throw error;});
  }
  await cp(join(root,'account-delivery'),join(destination,'account-delivery'),{recursive:true}).catch(error=>{if(error.code!=='ENOENT')throw error;});
  await copyFile(join(root,'migration-accounts.json'),join(destination,'migration-accounts.json'));
  await copyFile(join(root,'migration-report.json'),join(destination,'migration-report.json'));
  const snapshots=(await readdir(base)).filter(name=>/^\d{8}T\d{6}Z$/.test(name)).sort();
  for (const old of snapshots.slice(0,-14)) await rm(join(base,old),{recursive:true});
  console.log('Database snapshot completed.');
} catch (error) {await rm(destination,{recursive:true,force:true});throw error;}

async function snapshotFiles(from,to) {
  const entries=await readdir(from,{withFileTypes:true});await mkdir(to,{recursive:true,mode:0o700});
  for(const entry of entries){if(entry.name.includes('.upload-'))continue;const source=join(from,entry.name),target=join(to,entry.name);
    if(entry.isDirectory())await snapshotFiles(source,target);
    else if(entry.isFile())await link(source,target).catch(error=>{if(error.code!=='ENOENT')throw error;});
  }
}
