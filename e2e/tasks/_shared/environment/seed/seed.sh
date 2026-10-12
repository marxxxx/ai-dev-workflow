#!/usr/bin/env bash
# Startup hook (runs as dev in /workspace): seeds Gitea with the demo repo + ticket #1,
# clones it into /workspace and registers the `e2e` tea login. Idempotent per container.
set -euo pipefail
# Post-verification (e2e/lib/postverify.mjs) reuses this image without Gitea: nothing to seed.
[[ "${E2E_VERIFY:-}" == 1 ]] && exit 0
[[ -f /tmp/e2e-ready ]] && exit 0
until [[ -s /shared/token ]]; do sleep 1; done
TOKEN="$(cat /shared/token)"
API=http://gitea:3000/api/v1
api() { curl -fsS -H "Authorization: token $TOKEN" -H 'content-type: application/json' "$@"; }
until curl -fsS "$API/version" >/dev/null 2>&1; do sleep 1; done

git config --global user.name "ADW E2E Agent"
git config --global user.email agent@e2e.local
if ! api "$API/repos/adw/demo-todo" >/dev/null 2>&1; then
  api -X POST "$API/user/repos" -d '{"name":"demo-todo","default_branch":"main"}' >/dev/null
  for L in new in-progress review; do
    api -X POST "$API/repos/adw/demo-todo/labels" -d "{\"name\":\"status:$L\",\"color\":\"#ededed\"}" >/dev/null
  done
  cd /workspace
  git init -q -b main
  git add -A
  git commit -qm "Initial demo-todo"
  git remote add origin "http://adw:$TOKEN@gitea:3000/adw/demo-todo.git"
  git push -q -u origin main
  NEW_ID="$(api "$API/repos/adw/demo-todo/labels" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).find(l=>l.name==="status:new").id))')"
  BODY="$(node -e 'console.log(JSON.stringify({title:"Fälligkeitsdatum für Todos",body:require("fs").readFileSync("/opt/e2e/issue.md","utf8"),labels:[Number(process.argv[1])]}))' "$NEW_ID")"
  api -X POST "$API/repos/adw/demo-todo/issues" -d "$BODY" >/dev/null
fi
tea logins list 2>/dev/null | grep -q '\be2e\b' ||
  tea login add --name e2e --url http://gitea:3000 --token "$TOKEN" >/dev/null
printf ".acpxrc.json\n" >> /workspace/.git/info/exclude
touch /tmp/e2e-ready
