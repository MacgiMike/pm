#!/bin/sh
# Nightly database dump. Sleeps until 02:30 local time, dumps, prunes old files.
set -e
KEEP="${KEEP:-14}"
mkdir -p /backups
while true; do
  now=$(date +%s)
  target=$(date -d "$(date +%Y-%m-%d) 02:30" +%s 2>/dev/null || date -D "%Y-%m-%d %H:%M" -d "$(date +%Y-%m-%d) 02:30" +%s)
  if [ "$target" -le "$now" ]; then target=$((target + 86400)); fi
  sleep $((target - now))
  file="/backups/lockred-$(date +%Y%m%d-%H%M).sql.gz"
  if pg_dump --no-owner --format=plain | gzip > "$file.tmp"; then
    mv "$file.tmp" "$file"
    echo "backup written: $file"
  else
    rm -f "$file.tmp"
    echo "backup FAILED" >&2
  fi
  ls -1t /backups/lockred-*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
done
