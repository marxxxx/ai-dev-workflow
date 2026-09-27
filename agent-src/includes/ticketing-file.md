# Ticketing: File-Based Issues

Generated from `agent-src/includes/ticketing-file.md` for {{project.name}} — do not edit by hand.
Issues are Markdown files `{{ticketing.dir}}/<number>_<slug>.md` with YAML frontmatter; use plain
shell commands.

## Read

```bash
cat {{ticketing.dir}}/<number>_*.md   # comments are appended sections in the same file
```

## Create

Take the next number from `{{ticketing.metadataFile}}` (created on first use), then write the file
straight into `{{status.in-progress}}`:

```bash
NEXT_ID=$(node -e "const fs=require('fs'),p=require('path'),f='{{ticketing.metadataFile}}';
const d=fs.existsSync(f)?JSON.parse(fs.readFileSync(f,'utf8')):{next_id:1};console.log(d.next_id);
d.next_id++;fs.mkdirSync(p.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(d)+'\n')")
mkdir -p {{ticketing.dir}}
cat > "{{ticketing.dir}}/${NEXT_ID}_<short_title_slug>.md" <<'BODY_EOF'
---
title: "<title>"
status: {{status.in-progress}}
---

<a few sentences summarizing the spec; spec path>
BODY_EOF
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

## Pull Requests

This backend has no PR tooling of its own. Use the git host's CLI if one is configured and always
open a draft (for example `gh pr create --draft --base {{git.prTarget}} --title "<pr-title>"`);
otherwise push the branch and leave the PR to the human.
