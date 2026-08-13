# Gitea backend setup

Only relevant for `ticketing.backend: "gitea"`. Three things have to be in place; the generator does
none of them for you.

## 1. The `tea` CLI

Install [`tea`](https://gitea.com/gitea/tea) (Gitea's official CLI) so it is on `PATH` — packages,
binaries, and `go install` instructions are on the project page. It is a single static binary; no
Gitea server-side plugin or MCP server is involved.

**Version.** Every generated command is verified against **tea 0.15.1** — each subcommand and flag
checked against that binary's own `--help`. The include leans on the `comments` command group
(`tea comments list` / `tea comments add`) and on passing `--login` / `--repo` to every subcommand. If
a command comes back as unknown, check `tea --version` first — a differing CLI version is the likely
cause, not the generated include.

## 2. A login profile

```bash
tea login add       # once per machine — asks for the instance URL and an access token
tea logins list     # the name in the first column is what `init` asks for
```

That profile name goes into `ticketing.gitea.login` in `ai-project.json`, and every generated command
passes it as `--login "<name>"`. Because the instance URL and token live in the profile, no server URL
or credential ever reaches `ai-project.json` or the generated files — the profile name is the only
Gitea-specific value the generator stores.

`tea login add` accepts spaces in a profile name (`gitea ki` is a perfectly ordinary result of
accepting its default), so the generator **quotes the login in every rendered command**. Unquoted, the
name is split into two arguments and `tea` answers `Error: login name 'gitea' does not exist`. Nothing
to do on your side — just don't strip those quotes when copying a command out of the include.

Agents never create logins or handle tokens: if the profile is missing they stop and ask you to run
`tea login add`.

## 3. The workflow status labels

This step is not optional, and it is the one that bites silently. Gitea does not create labels
implicitly when one is assigned — and worse, it **ignores an unknown label in a filter** rather than
erroring: `tea issues list --labels "status:new"` against a repository without that label returns
*every* open issue instead of none. Since that is exactly the query the workflow uses to pick up work,
a missing label makes the agents treat unrelated issues as ready-to-build tickets. Create all six
before the first ticket moves:

```bash
for L in new in-progress review test failed acceptance-test; do
  tea labels create --login <profile> --repo <owner/repo> \
    --name "status:$L" --color "#ededed"
done
```

Only the names matter — pick whatever colors you like. The agents verify the set with
`tea labels list` before their first query and stop to ask you rather than running a query whose
filter might be silently dropped.

**Making it a server-wide default (optional).** If you administer the Gitea instance, you can have
every newly created repository offer these labels instead of running the loop per repo. Drop a file
into the instance's `custom/options/label/` directory — say `ai-dev-workflow.yaml`:

```yaml
labels:
  - name: "status:new"
    color: ededed
    description: Ready for development
  - name: "status:in-progress"
    color: 1d76db
    description: Implementation running or interrupted
  - name: "status:review"
    color: fbca04
    description: Awaiting code review
  - name: "status:test"
    color: 0e8a16
    description: Ready for acceptance QA
  - name: "status:failed"
    color: d93f0b
    description: Review or QA failure
  - name: "status:acceptance-test"
    color: 5319e7
    description: PR/human acceptance pending
```

After a restart the set appears in the **Issue Labels** dropdown when creating a repository. Two
limits: it applies only at repository *creation* — existing repos still need the loop above — and it
needs filesystem access to the server, so it is out of reach on a hosted instance. Organization-wide
labels are the other route (they cover every repo in an org, retroactively), but they are created in
the org's web UI; `tea labels create` has no `--org` flag.
