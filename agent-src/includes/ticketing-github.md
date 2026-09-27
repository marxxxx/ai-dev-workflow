# Ticketing: GitHub Issues

Generated from `agent-src/includes/ticketing-github.md` for {{project.name}} — do not edit by hand.
Use the `gh` CLI for every ticket operation. Issues live in `{{repo.slug}}`.

## Read

```bash
gh issue view <number> --repo {{repo.slug}} --comments
```

## Create

Created straight into `{{status.in-progress}}`; the command prints the issue URL, whose last segment
is the number.

```bash
cat <<'BODY_EOF' | gh issue create --repo {{repo.slug}} --title "<title>" \
  --label "{{status.in-progress}}" --body-file -
<a few sentences summarizing the spec; spec path>
BODY_EOF
```

## Comment

A comment holds at most 65,536 characters.

```bash
cat <<'BODY_EOF' | gh issue comment <number> --repo {{repo.slug}} --body-file -
## <Title>
...
BODY_EOF
```

## Attach the spec

GitHub has no API for issue attachments, so the approved spec goes onto the issue as one comment,
collapsed. Comments are capped at 65,536 characters; for a longer spec, post only the path.

```bash
{ printf '## Spec\n`<spec path>`\n\n<details><summary>Approved spec</summary>\n\n'
  cat <spec path>; printf '\n</details>\n'; } | gh issue comment <number> --repo {{repo.slug}} --body-file -
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

## Pull Requests

Always open PRs as drafts; the human reviewer publishes them after reviewing and testing.

```bash
gh pr create --draft --repo {{repo.slug}} --base {{git.prTarget}} --head <branch> \
  --title "<pr-title>" --body-file <file>
```
