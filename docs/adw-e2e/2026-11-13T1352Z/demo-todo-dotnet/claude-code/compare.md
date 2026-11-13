# Compare demo-todo-dotnet · claude-code: **worse**

Baseline: `/home/max/src/ai-dev-workflow/docs/adw-e2e/2026-10-23T1232Z/demo-todo-dotnet/claude-code`
Candidate: `/home/max/src/ai-dev-workflow/docs/adw-e2e/2026-11-13T1352Z/demo-todo-dotnet/claude-code`

## Signals

| Signal | Baseline | Candidate | Kind |
|---|---|---|---|
| check:show_me_read | 0 | 1 | improvement |
| review:scope | 4 | 5 | improvement |
| review:conventions | 5 | 4 | regression |

## What changed (fingerprint diff)

- `adw.sha`: e440089a92a5d01c965ef0827b0ad775a4601224 → e3196af9515e82022066c159723fa196b20a46de
- `adw.version`: 0.28.0 → 0.31.0
- `code.agents`: d0da995efeca9c264b60d5b89daaaf8676038179c9502bfb8a4f804ba286495b → 46dfe21209c52305d6bee9dd9a17f9e84e1b42d20d70d8b012d8948cb49abaa7
- `code.lib`: 4674f72ba86ec174e083cc0a55aa210119fcf023f49cc94ee29ca36d8c1b6ba9 → af5a9613b1e2c83cda32e00b4d03a00bad8b63da0e6689cdf0b51ab73e0ce93f
- `config`: 1ff0716c9335e44bede9e57b40bcf1538fd283d6c6850d494fb142cff041ebf0 → a4909ab6baa953566d2d849ffba7effc04b089e43d535064fa94c5784cab9db1
- `image.harnessVersion`: 2.1.309 → 2.1.322
- `image.id`: sha256:0150386d54bedb60ce043bcddee75b3a451c1eb5dc658af364ccd46ddfeacc16 → sha256:2e9e6b12042037ea3f4327766f0ce5b228a3571149e105b8dee692e80fb7b224
- `image.inventory`: be1ece0171d7af148100fdcf1ba8aa846a6a088e455ab86b227b30b6a32614ec → 06d2eff6f5803d13f194d0d44678eb7dc851467ee76a86c1a5ab71f4191a716a
- `image.superpowers`: 2ce8aa15d05bd57213e6f746f953aafb7ded7a8b → 22f0b463e7a5e579904dd6211a520321035526f7
- `skill.claude`: 97ab0aaaeab67eedb3f401565ce8904dbd5c729cf72b085b434142fd5d634550 → 48d019a0096fa1f224f4a6d60422882148dfbf6a9680aca05cd948531f281e0e
- `skill.codex`: 97ab0aaaeab67eedb3f401565ce8904dbd5c729cf72b085b434142fd5d634550 → 48d019a0096fa1f224f4a6d60422882148dfbf6a9680aca05cd948531f281e0e
- `skill.opencode`: 97ab0aaaeab67eedb3f401565ce8904dbd5c729cf72b085b434142fd5d634550 → 48d019a0096fa1f224f4a6d60422882148dfbf6a9680aca05cd948531f281e0e
- `task`: 02affc8ba4e07c87b38ccd27fe73c2ce3c0081fc46b00875b175a50e6051e960 → 015ef37ea6ede8bb9b12355120fa96354b212b858310b6c52c03816166a3284f
