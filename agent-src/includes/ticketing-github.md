# Ticketing: GitHub Issues

Generated from `agent-src/includes/ticketing-github.md` for {{project.name}} — do not edit by hand.
Use the `gh` CLI for every ticket operation. Issues live in `{{repo.slug}}`.

## Read

```bash
gh issue view <number> --repo {{repo.slug}} --comments
```

## Comment

```bash
cat <<'BODY_EOF' | gh issue comment <number> --repo {{repo.slug}} --body-file -
## <Title>
...
BODY_EOF
```

## Status

Status is a label; a transition swaps the old label for the new one.

| Label | Meaning |
|---|---|
| `{{status.new}}` | Ready to build |
| `{{status.in-progress}}` | agent-dev is working on it |
| `{{status.review}}` | Work finished; awaiting human review and acceptance |

```bash
gh issue edit <number> --repo {{repo.slug}} --remove-label "{{status.new}}" --add-label "{{status.in-progress}}"
gh issue edit <number> --repo {{repo.slug}} --remove-label "{{status.in-progress}}" --add-label "{{status.review}}"
```

Never close an issue — that is the human's acceptance.

## Branch

- `{{git.branchPattern}}` with the issue number (for example `feat/42_user-login`).
- If the issue body starts with `**Upstream:** <ref>`, use the upstream ticket number instead
  (`**Upstream:** AB#12345` → `feat/12345_user-login`).
- No ticket: drop the number and its separator, keeping only the slug of the spec topic.

## Pull Requests

Always open PRs as drafts; the human reviewer publishes them after reviewing and testing.

```bash
gh pr create --draft --repo {{repo.slug}} --base {{git.prTarget}} --head <branch> \
  --title "<title> (#<number>)" --body-file <file>
```
