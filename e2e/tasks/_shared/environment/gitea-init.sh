#!/bin/sh
# Starts Gitea, then creates the admin user and an API token for the seed hook.
/usr/bin/entrypoint &
until su git -c "gitea admin user create --username adw --password adw-e2e-pass \
    --email adw@e2e.local --admin --must-change-password=false" 2>/dev/null; do sleep 2; done
su git -c "gitea admin user generate-access-token --username adw --token-name e2e --scopes all --raw" \
  > /shared/token.tmp && mv /shared/token.tmp /shared/token
chmod 0644 /shared/token
wait
