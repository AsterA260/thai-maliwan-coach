#!/bin/sh
# Odbudowa lokalnej bazy AsterA Coach od zera. Kolejność jest umową:
# stan bazowy → migracje → dane startowe → import z arkusza.
set -e
cd "$(dirname "$0")/.."
su postgres -c "psql -h /tmp -p 5433 -d postgres -q \
  -c 'drop database if exists coach' -c 'create database coach'" >/dev/null
for f in db/00_supabase_lokalnie.sql db/01_schema.sql db/02_rls.sql; do
  su postgres -c "psql -h /tmp -p 5433 -d coach -v ON_ERROR_STOP=1 -q -f $PWD/$f"
done
node narzedzia/migruj.js | tail -2
for f in db/04_dane_startowe.sql db/05_import.sql; do
  su postgres -c "psql -h /tmp -p 5433 -d coach -v ON_ERROR_STOP=1 -q -f $PWD/$f"
done
echo "baza odbudowana"
