#!/bin/bash
set -euo pipefail
backup=/var/backups/yarei-cutover-20261102
mkdir -p "$backup"
chmod 700 "$backup"
cp /etc/systemd/system/yarei.service "$backup/yarei.service"
cp /etc/systemd/system/yarei-backup.service "$backup/yarei-backup.service"
cp /opt/yarei/backup.mjs "$backup/backup.mjs"
/usr/local/bin/node /opt/yarei/backup.mjs
rollback() {
  systemctl stop yarei || true
  cp "$backup/yarei.service" /etc/systemd/system/yarei.service
  cp "$backup/yarei-backup.service" /etc/systemd/system/yarei-backup.service
  cp "$backup/backup.mjs" /opt/yarei/backup.mjs
  systemctl daemon-reload
  systemctl start yarei
}
trap rollback ERR
systemctl stop yarei-stage yarei
install -m 644 /var/lib/yarei-source/yarei.service /etc/systemd/system/yarei.service
install -m 644 /var/lib/yarei-source/yarei-backup.service /etc/systemd/system/yarei-backup.service
install -m 644 /var/lib/yarei-source/backup.mjs /opt/yarei/backup.mjs
systemctl daemon-reload
systemctl start yarei
healthy=0
for attempt in {1..20}; do
  if curl -fsS http://127.0.0.1:3200/healthz > "$backup/health.json"; then healthy=1;break;fi
  sleep 1
done
test "$healthy" = 1
/usr/local/bin/node -e 'const r=require("/var/backups/yarei-cutover-20261102/health.json");if(r.version!=="0.128.0"||r.dataMigration!=="imported")process.exit(1)'
curl -fsS https://video.aimanhua.xin/healthz
trap - ERR
systemctl start yarei-backup
systemctl is-active yarei yarei-caddy yarei-backup.timer
