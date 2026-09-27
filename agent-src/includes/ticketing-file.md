# Ticketing: File-Based Issues

Generated from `agent-src/includes/ticketing-file.md` for {{project.name}} — do not edit by hand.
Issues are Markdown files `{{ticketing.dir}}/<number>_<slug>.md` with YAML frontmatter; use plain
shell commands.

## Read

```bash
cat {{ticketing.dir}}/<number>_*.md   # comments are appended sections in the same file
```

## Comment

Append a section:

```bash
cat >> {{ticketing.dir}}/<number>_<slug>.md <<'BODY_EOF'

---
## <Title>
...
BODY_EOF
```

## Status

Status is the `status:` frontmatter field.

| Value | Meaning |
|---|---|
| `{{status.new}}` | Ready to build |
| `{{status.in-progress}}` | agent-dev is working on it |
| `{{status.review}}` | Work finished; awaiting human review and acceptance |

```bash
sed -i "s/^status: .*/status: {{status.in-progress}}/" {{ticketing.dir}}/<number>_<slug>.md
sed -i "s/^status: .*/status: {{status.review}}/" {{ticketing.dir}}/<number>_<slug>.md
```

Never set `closed` — that is the human's acceptance.

## Branch

- `{{git.branchPattern}}` with the issue number (for example `feat/42_user-login`).
- If the frontmatter has a non-empty `upstream:` (for example `"AB#12345"`), use the upstream number
  instead (`feat/12345_user-login`).
- No ticket: drop the number and its separator, keeping only the slug of the spec topic.

## Pull Requests

This backend has no PR tooling of its own. Use the git host's CLI if one is configured and always
open a draft (for example `gh pr create --draft --base {{git.prTarget}}`); otherwise push the branch
and leave the PR to the human.
