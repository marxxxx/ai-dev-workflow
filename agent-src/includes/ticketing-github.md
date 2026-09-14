# Ticketing System: GitHub Issues

This generated include defines GitHub ticket operations for `{{project.name}}`. Edit
`agent-src/includes/ticketing-github.md` or select another backend in `ai-project.json`, then regenerate.

## Repository

All issues are managed in the `{{repo.slug}}` repository.

## CLI Tool

Use the `gh` CLI through the harness's shell tool for all ticketing operations.

## Issue Status Labels

Statuses are stored as GitHub labels on the issue.

| Status Label | Meaning | Set By |
|--------------|---------|--------|
| `{{status.new}}` | Ready for development | Product-architect (on issue creation) |
| `{{status.in-progress}}` | Developer actively working | Developer (before starting work) |
| `{{status.review}}` | Implementation complete, awaiting code review | Developer (after implementation) |
| `{{status.test}}` | Code review passed, ready for QA | Code reviewer |
| `{{status.acceptance-test}}` | QA passed; PR/human acceptance pending | QA engineer |
| `{{status.failed}}` | Review or QA found blocking issues | Code reviewer or QA engineer |
| **Closed** | Human has verified and accepted | **Human only — NEVER closed by automation** |

## Upstream Ticket

Record the optional originating ticket as the body's first line:
`**Upstream:** <url-or-number>`. Use `**Upstream:** None` when absent. The reference links the
requirement source and supplies the branch number; without one, this issue is the source of truth.

## Commands Reference

### Reading Issues

```bash
# View an issue
gh issue view <number> --repo {{repo.slug}}

# View issue with comments
gh issue view <number> --repo {{repo.slug}} --comments

# List issues by status
gh issue list --repo {{repo.slug}} --label "{{status.new}}"

# List all open issues with metadata
gh issue list --repo {{repo.slug}} --state open --json number,title,labels
```

### Creating Issues

```bash
gh issue create --repo {{repo.slug}} \
  --title "[Issue Title]" \
  --body "## Overview
..." \
  --label "{{status.new}}"
```

### Updating Issues

```bash
# Add a comment
gh issue comment <number> --repo {{repo.slug}} --body "..."

# Transition status (remove the old label, add the new one)
gh issue edit <number> --repo {{repo.slug}} --remove-label "{{status.review}}" --add-label "{{status.test}}"

# Close an issue (HUMAN ONLY — agents must not do this)
gh issue close <number> --repo {{repo.slug}} --reason completed
```

### Pull Requests

```bash
gh pr create --repo {{repo.slug}} \
  --base {{git.prTarget}} --head {{git.branchPattern}} \
  --title "feat: [issue title] #[number]" \
  --body "..."
```

A human reviews, merges, and closes. Automation leaves the issue open at `{{status.acceptance-test}}`.

## Issue Comment Artifacts

Use named comments for `{{artifact.implementationNotes}}` (developer),
`{{artifact.reviewFeedback}}` (reviewer), `{{artifact.testResults}}` (QA),
`{{artifact.costOrigin}}` (product-architect), and `{{artifact.costSummary}}` (`dev-cycle`).
`{{artifact.journal}}` — the workflow's progress record — is the only mutable artifact: create it once and edit it in place.

## The Journal Comment

The `{{artifact.journal}}` comment is one mutable comment per issue, addressed by its numeric
**comment id** and rewritten in place on every update. Its content and protocol are defined in the
handoff include; the four operations below are the GitHub mechanics.

Use `gh api`, not `gh issue comment`. `gh issue comment --edit-last` targets "the last comment of the
current user" rather than an id you chose — a different actor's comment, or a second comment from the
workflow, silently changes what it edits. Never use it for the journal.

Note the endpoint asymmetry: **create** is nested under the issue (`issues/<number>/comments`), while
**get / update** address the comment directly (`issues/comments/<comment-id>` — no issue number).

```bash
# Create the journal comment and capture its id (do this once per issue)
CID=$(cat <<'JOURNAL_EOF' | gh api -X POST repos/{{repo.slug}}/issues/<number>/comments \
        -F 'body=@-' --jq '.id'
## {{artifact.journal}}
...the full journal, per the handoff include...
JOURNAL_EOF
)

# Discover the id of an existing journal comment (once per ticket; newest match wins)
gh api repos/{{repo.slug}}/issues/<number>/comments \
  --jq '[.[] | select(.body | startswith("## {{artifact.journal}}"))] | last | .id'

# Read the journal by id — no issue listing, no full ticket read
gh api repos/{{repo.slug}}/issues/comments/<comment-id> --jq '.body'

# Update the journal in place by id (replaces the whole body, and keeps the same id)
cat <<'JOURNAL_EOF' | gh api -X PATCH repos/{{repo.slug}}/issues/comments/<comment-id> -F 'body=@-'
## {{artifact.journal}}
...the updated journal...
JOURNAL_EOF
```

Pass the body as `-F 'body=@-'` (read from stdin) as shown, never as `-f body="..."`. Journal bodies
are multi-line Markdown full of backticks, quotes, and `$`; inline shell quoting corrupts them, and
`@-` needs no `jq` on the machine. `--jq` above is different — that is `gh`'s own built-in filter and
is always available.

## Issue Body Templates

### Feature Issue Template

```markdown
**Upstream:** [upstream ticket URL/number, or None]

## Overview
[Brief description of the feature and its value to the user]

## Requirements
- [ ] Requirement 1
- [ ] Requirement 2

## Explicit Exclusions
- [Out-of-scope behavior, or None]

## Architecture & Implementation Guidance
[High-level technical approach agreed upon with the human.]

### Affected Layers
- **Frontend:** [Components, services, or modules affected]
- **Backend:** [Controllers, services, or modules affected]
- **Data Model:** [Schema changes if any]

### Approach
[Description of the agreed-upon technical approach]

### Constraints & Hints
- [Specific patterns the developer must follow]
- [Libraries or utilities to use or avoid]

## Dependencies
[List dependent issues or "None"]

## Acceptance Criteria
### Functional Criteria
- [ ] Criterion 1
- [ ] Criterion 2

### Visual Criteria [HUMAN REVIEW]
- [ ] [VISUAL - HUMAN REVIEW] [Subjective criterion; omit section when none]
```

### Bug Issue Template

```markdown
**Upstream:** [upstream ticket URL/number, or None]

## Overview
[Brief description of the bug]

## Steps to Reproduce
1. Step 1
2. Step 2

## Expected Behavior
[What should happen]

## Actual Behavior
[What actually happens]

## Evidence
- Screenshots: [attach or reference]
- Console errors: [relevant error messages]

## Explicit Exclusions
- [Out-of-scope behavior, or None]

## Architecture & Implementation Guidance
### Likely Root Cause
[Analysis of where the bug likely originates]

### Suggested Fix Approach
[High-level guidance on how to fix it]

## Acceptance Criteria
### Functional Criteria
- [ ] Bug no longer occurs when following reproduction steps

### Visual Criteria [HUMAN REVIEW]
- [ ] [VISUAL - HUMAN REVIEW] [Subjective criterion; omit section when none]
```

## Git Branching Convention

- Branch name: `{{git.branchPattern}}` (for example `feat/42_user-login`).
- When the issue body records an upstream ticket (`**Upstream:**` line), the branch's first segment is
  the **upstream ticket number** instead of the implementation issue number — for example an
  `**Upstream:** AB#12345` issue uses `feat/12345_user-login`. With no upstream ticket
  (`**Upstream:** None`), use the implementation issue number as before.
- All implementation work happens on the feature branch.
- Merged into `{{git.prTarget}}` only after human acceptance.
