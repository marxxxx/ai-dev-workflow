# Ticketing: Gitea Issues

Generated from `agent-src/includes/ticketing-gitea.md` for {{project.name}} — do not edit by hand.
Use the `tea` CLI (verified against 0.15.1) for every ticket operation. Issues live in
`{{repo.slug}}`.

- Every command passes `--login "{{ticketing.gitea.login}}" --repo {{repo.slug}}`. Keep the quotes:
  login names may contain spaces.
- Run `tea` from inside the git working tree; it aborts outside one even with `--repo`.
- If `tea` is missing, the login is not in `tea logins list`, or a command is rejected, stop and tell
  the human (with `tea --version`). Do not install, log in, or improvise commands.

## Read

```bash
tea issues --login "{{ticketing.gitea.login}}" --repo {{repo.slug}} <number>
tea comments list --login "{{ticketing.gitea.login}}" --repo {{repo.slug}} <number>
```

## Comment

```bash
BODY=$(cat <<'BODY_EOF'
## <Title>
...
BODY_EOF
)
tea comments add --login "{{ticketing.gitea.login}}" --repo {{repo.slug}} <number> "$BODY"
```

## Status

Status is a label; a transition swaps the old label for the new one. Before the first transition,
check with `tea labels list --login "{{ticketing.gitea.login}}" --repo {{repo.slug}}` that all three
labels exist; if one is missing, ask the human to create it.

| Label | Meaning |
|---|---|
| `{{status.new}}` | Ready to build |
| `{{status.in-progress}}` | agent-dev is working on it |
| `{{status.review}}` | Work finished; awaiting human review and acceptance |

```bash
tea issues edit --login "{{ticketing.gitea.login}}" --repo {{repo.slug}} \
  --remove-labels "{{status.new}}" --add-labels "{{status.in-progress}}" <number>
tea issues edit --login "{{ticketing.gitea.login}}" --repo {{repo.slug}} \
  --remove-labels "{{status.in-progress}}" --add-labels "{{status.review}}" <number>
```

Never close an issue — that is the human's acceptance.

## Branch

- `{{git.branchPattern}}` with the issue number (for example `feat/42_user-login`).
- If the issue body starts with `**Upstream:** <ref>`, use the upstream ticket number instead
  (`**Upstream:** AB#12345` → `feat/12345_user-login`).
- No ticket: drop the number and its separator, keeping only the slug of the spec topic.

## Pull Requests

Always open PRs as drafts; the human reviewer publishes them after reviewing and testing. `tea` has
no draft flag: Gitea treats a `WIP:` title prefix as a draft (work in progress).

```bash
tea pulls create --login "{{ticketing.gitea.login}}" --repo {{repo.slug}} \
  --base {{git.prTarget}} --head <branch> --title "WIP: <title> (#<number>)" --description "..."
```
