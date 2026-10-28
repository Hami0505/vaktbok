#!/bin/zsh
# Vaktbok – sikkerhetskopi av databasen til Macen.
# Bruk: vaktbok-backup        (tar ny kopi)
#       vaktbok-backup oppsett (første gang: lagrer tilkoblingen i nøkkelringen)
set -e
DIR=~/Documents/Vaktbok-backup
PGDUMP=$(command -v pg_dump || echo /opt/homebrew/opt/libpq/bin/pg_dump)

if [ "$1" = "oppsett" ]; then
  echo "Lim inn tilkoblingsadressen fra Supabase (Connect → Session pooler), med passordet fylt inn:"
  read -rs URI; echo
  [[ "$URI" == postgresql://* ]] || { echo "Det ser ikke ut som en postgresql://-adresse. Ingenting er lagret."; exit 1; }
  security add-generic-password -U -a vaktbok -s vaktbok-db -w "$URI"
  echo "Lagret i nøkkelringen. Kjør nå: vaktbok-backup"
  exit 0
fi

[ -x "$PGDUMP" ] || { echo "Fant ikke pg_dump. Installer den med: brew install libpq"; exit 1; }
URI=$(security find-generic-password -a vaktbok -s vaktbok-db -w 2>/dev/null) || { echo "Ingen tilkobling lagret. Kjør først: vaktbok-backup oppsett"; exit 1; }

mkdir -p "$DIR" && chmod 700 "$DIR"
FILE="$DIR/vaktbok-$(date +%Y-%m-%d-%H%M).dump"
echo "Tar sikkerhetskopi …"
"$PGDUMP" "$URI" --schema=public --schema=auth --no-owner --no-privileges -Fc -f "$FILE"
chmod 600 "$FILE"
echo "Ferdig: $FILE ($(du -h "$FILE" | cut -f1))"

# Behold de 12 nyeste
ls -t "$DIR"/vaktbok-*.dump 2>/dev/null | tail -n +13 | while read -r old; do rm -f "$old"; done
echo "Du har $(ls "$DIR"/vaktbok-*.dump | wc -l | tr -d ' ') sikkerhetskopier i $DIR"
