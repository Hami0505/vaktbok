# Oppdaterer Vaktbok fra nyeste vaktbok*.zip i Downloads.
# Legg i ~/.zshrc. Sletter også filer som er fjernet fra prosjektet, men aldri js/config.js,
# personvern.html eller .git. Viser alle endringer og spør før noe pushes.
vaktbok-oppdater() {
  local repo=~/"Intro til KI"/Vaktbok
  local zip=$(ls -t ~/Downloads/vaktbok*.zip 2>/dev/null | head -1)
  [ -z "$zip" ] && { echo "Fant ingen vaktbok-zip i Downloads"; return 1; }
  echo "Bruker $zip"
  rm -rf /tmp/vaktbok-ny && unzip -q "$zip" -d /tmp/vaktbok-ny || return 1
  local src=/tmp/vaktbok-ny/vaktbok
  if [ ! -f "$src/js/app.js" ] || [ ! -f "$src/js/logic.js" ] || ! grep -q '"name": "vaktbok"' "$src/package.json" 2>/dev/null; then
    echo "Dette ser ikke ut som en Vaktbok-zip. Avbryter."; return 1
  fi
  cd "$repo" || return 1
  git remote get-url origin | grep -qi 'Hami0505/vaktbok' || { echo "Feil repo. Avbryter."; return 1; }
  [ -n "$(git status --porcelain)" ] && { echo "Du har uncommittede endringer. Commit eller forkast dem først:"; git status --short; return 1; }
  git pull --rebase || { echo "Kunne ikke hente fra GitHub. Ingenting er endret."; return 1; }
  rsync -a --delete --exclude '.git' --exclude 'js/config.js' --exclude 'personvern.html' --exclude 'node_modules' --exclude '.DS_Store' "$src/" ./ || return 1
  if [ -z "$(git status --porcelain)" ]; then echo "Ingen endringer i denne zip-fila."; return 0; fi
  echo; echo "Endringer (D = slettet):"; git status --short; echo
  npm test >/tmp/vaktbok-test.log 2>&1 || { echo "Testene feilet. Setter tilbake."; git checkout -- . && git clean -fdq; tail -20 /tmp/vaktbok-test.log; return 1; }
  echo "Alle tester består."
  read "svar?Pushe dette? (y/n) "
  if [[ "$svar" != [yY] ]]; then git checkout -- . && git clean -fdq; echo "Avbrutt. Mappa er satt tilbake."; return 0; fi
  git add -A
  git commit -m "${1:-Oppdatering fra Claude}" && git push && rm -f ~/Downloads/vaktbok*.zip
}
