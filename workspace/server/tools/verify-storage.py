import json,pathlib,hashlib
source=pathlib.Path('/var/lib/yarei-source/yarei-cloudbase-migration-20261028/storage-verification.json');root=pathlib.Path('/var/lib/yarei-v0128/storage');manifest=json.loads(source.read_text())['manifest'];count=0;total=0
for item in manifest:
 p=root/item['key'];data=p.read_bytes();assert len(data)==item['size'] and hashlib.sha256(data).hexdigest()==item['sha256'];count+=1;total+=len(data)
report={'files':count,'bytes':total,'allSha256Matched':True};(root.parent/'storage-verification.json').write_text(json.dumps(report));print(json.dumps(report))
