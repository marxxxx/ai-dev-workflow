# Compare demo-todo-dotnet · opencode: **worse**

Baseline: `/home/mx/src/ai-dev-workflow/docs/adw-e2e/2026-10-15T1447Z/demo-todo-dotnet/opencode`
Candidate: `/home/mx/src/ai-dev-workflow/docs/adw-e2e/2026-10-23T2009Z/demo-todo-dotnet/opencode`

## Signals

| Signal | Baseline | Candidate | Kind |
|---|---|---|---|
| check:ticket_review | 1 | 0.67 | regression |
| check:summary_comment | 1 | 0.67 | regression |
| check:cost_comment | 1 | 0.67 | regression |
| check:only_allowed_comments | 0.67 | 1 | improvement |
| check:pr_draft | 1 | 0.67 | regression |
| check:branch_naming | 1 | 0.67 | regression |
| check:pr_title_naming | 1 | 0.67 | regression |
| check:acceptance | 0.67 | 0.33 | regression |
| check:ownTests | 1 | 0.67 | regression |
| check:ac:AC1 | 1 | 0.67 | regression |
| check:ac:AC2 | 1 | 0.67 | regression |
| check:ac:AC3 | 0.67 | 0.33 | regression |
| check:ac:AC4 | 1 | 0.33 | regression |
| check:ac:AC5 | 1 | 0.67 | regression |
| check:ac:AC6 | 1 | 0.67 | regression |
| check:ac:AC7 | 1 | 0.33 | regression |
| review:requirements | 5 | 3.5 | regression |
| median:cost | 0.482 | 1.395 | regression |
| median:agent | 1,005 | 2,701 | noise |
| error:harbor | 0 | 1 | regression |
| error:timeout | 0 | 1 | regression |

## What changed (fingerprint diff)

- `adw.sha`: 576ccfbdba8954564f92e5b7af0773f1a2bef01e → 4c6196612bf8d5cda078fb168d0843e19286a923
- `adw.version`: 0.25.0 → 0.28.0
- `code.lib`: 448a9daff708940389a4d6fb40a52be9bf66943ee97aee330b24bbaf0395e2f2 → 4674f72ba86ec174e083cc0a55aa210119fcf023f49cc94ee29ca36d8c1b6ba9
- `config`: d86521c9a4663bdd8de6e2be965bbb601cf0ad1b235a7541cad6fe57faaced44 → 1ff0716c9335e44bede9e57b40bcf1538fd283d6c6850d494fb142cff041ebf0
- `image.harnessVersion`: 1.19.0 → 1.19.4
- `image.id`: sha256:ace9073ee964d44277cf61280e09662d29a37dc9e9d1a04e3b764ad86ffe10cb → sha256:0150386d54bedb60ce043bcddee75b3a451c1eb5dc658af364ccd46ddfeacc16
- `image.inventory`: f73312c8b32a0eff8a6e42407639392e80cae5d02d97ee54f12a4af8dc7a6d6e → be1ece0171d7af148100fdcf1ba8aa846a6a088e455ab86b227b30b6a32614ec
- `image.superpowers`: bb92a77741419a4ab5f06e711a283343f1ada0c3 → 2ce8aa15d05bd57213e6f746f953aafb7ded7a8b
- `skill.includes`: 460615f461c8f598aa54476bf12030d302e9573c9d6b9d821e8f7b19b1b0d2a8:de8e8443addc7abd272af71c7102e56e4614e9ebd357888f3bba18a0414c9994 → 460615f461c8f598aa54476bf12030d302e9573c9d6b9d821e8f7b19b1b0d2a8:9905aed6ff6a01bbb005f626e5bf6af85f9bde49ed2b27cee46a1f2302aecce8
- `task`: 1a98141d9bd37e45588304d38388bb6353872f09a58b2828c3a115305ced3b16 → 02affc8ba4e07c87b38ccd27fe73c2ce3c0081fc46b00875b175a50e6051e960
