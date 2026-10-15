# Compare demo-todo-dotnet · opencode: **worse**

Baseline: `/home/mx/src/ai-dev-workflow/docs/adw-e2e/2026-10-15T1159Z/demo-todo-dotnet/opencode`
Candidate: `/home/mx/src/ai-dev-workflow/docs/adw-e2e/2026-10-15T1447Z/demo-todo-dotnet/opencode`

## Signals

| Signal | Baseline | Candidate | Kind |
|---|---|---|---|
| rewardRate | 0 | 0.33 | improvement |
| check:only_allowed_comments | 1 | 0.67 | regression |
| check:e2e_performed | 0 | 1 | improvement |
| check:acceptance | 1 | 0.67 | regression |
| check:ac:AC3 | 1 | 0.67 | regression |
| review:requirements | 4 | 5 | improvement |
| review:conventions | 3 | 4 | improvement |
| review:architecture | 4 | 3 | regression |
| median:tokens | 1,476,328 | 4,799,720 | regression |
| median:cost | 0.2 | 0.482 | regression |
| median:agent | 386 | 1,005 | regression |

## What changed (fingerprint diff)

- `adw.sha`: e886701457f87b766e69e1fbbc76a02e34ef873e → 576ccfbdba8954564f92e5b7af0773f1a2bef01e
- `code.agents`: 7f5997abe9fed3c12971846efcc906b799cacb5a450db838fbb6047836be4ab7 → d0da995efeca9c264b60d5b89daaaf8676038179c9502bfb8a4f804ba286495b
