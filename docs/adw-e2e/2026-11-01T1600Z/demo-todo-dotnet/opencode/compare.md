# Compare demo-todo-dotnet · opencode: **worse**

Baseline: `/home/ai/src/ai-dev-workflow/docs/adw-e2e/2026-10-23T2009Z/demo-todo-dotnet/opencode`
Candidate: `/home/ai/src/ai-dev-workflow/docs/adw-e2e/2026-11-01T1600Z/demo-todo-dotnet/opencode`

## Signals

| Signal | Baseline | Candidate | Kind |
|---|---|---|---|
| check:ticket_review | 0.67 | 1 | improvement |
| check:summary_comment | 0.67 | 1 | improvement |
| check:cost_comment | 0.67 | 1 | improvement |
| check:pr_draft | 0.67 | 1 | improvement |
| check:branch_naming | 0.67 | 1 | improvement |
| check:pr_title_naming | 0.67 | 1 | improvement |
| check:acceptance | 0.33 | 1 | improvement |
| check:ownTests | 0.67 | 1 | improvement |
| check:ac:AC1 | 0.67 | 1 | improvement |
| check:ac:AC2 | 0.67 | 1 | improvement |
| check:ac:AC3 | 0.33 | 1 | improvement |
| check:ac:AC4 | 0.33 | 1 | improvement |
| check:ac:AC5 | 0.67 | 1 | improvement |
| check:ac:AC6 | 0.67 | 1 | improvement |
| check:ac:AC7 | 0.33 | 1 | improvement |
| check:show_me_read | 0 | 0.33 | improvement |
| review:requirements | 3.5 | 5 | improvement |
| review:architecture | 3 | 4 | improvement |
| review:codeQuality | 2.5 | 4 | improvement |
| median:cost | 1.395 | 0.684 | improvement |
| median:agent | 2,701 | 900 | improvement |
| error:judge | 0 | 1 | regression |

## What changed (fingerprint diff)

- `adw.sha`: 4c6196612bf8d5cda078fb168d0843e19286a923 → fe1008afb211e9f52b5988e4bb307f31e2366833
- `adw.version`: 0.28.0 → 0.29.1
- `code.agents`: d0da995efeca9c264b60d5b89daaaf8676038179c9502bfb8a4f804ba286495b → 1eadd18e4adb30f8a23b1b462c648fb05751115e5020228fd38062b5d4f1404e
- `code.lib`: 4674f72ba86ec174e083cc0a55aa210119fcf023f49cc94ee29ca36d8c1b6ba9 → 111974075d79e79d6221fda2e8acf38ed24d1e7f1fbc6ea7cbfd1fdb7afa780b
- `config`: 1ff0716c9335e44bede9e57b40bcf1538fd283d6c6850d494fb142cff041ebf0 → a4909ab6baa953566d2d849ffba7effc04b089e43d535064fa94c5784cab9db1
- `image.harnessVersion`: 1.19.4 → 2.2.3
- `image.id`: sha256:0150386d54bedb60ce043bcddee75b3a451c1eb5dc658af364ccd46ddfeacc16 → sha256:4096fc4dcc771abd47dbdf2651f5dba4e30c4151ecd3070b7a757abfac8de325
- `image.inventory`: be1ece0171d7af148100fdcf1ba8aa846a6a088e455ab86b227b30b6a32614ec → 744051c6c8aed8068d0e43ed8a7b2db293ec5168e46b3dd94c7aa34e41678f06
- `skill.claude`: 97ab0aaaeab67eedb3f401565ce8904dbd5c729cf72b085b434142fd5d634550 → 48d019a0096fa1f224f4a6d60422882148dfbf6a9680aca05cd948531f281e0e
- `skill.codex`: 97ab0aaaeab67eedb3f401565ce8904dbd5c729cf72b085b434142fd5d634550 → 48d019a0096fa1f224f4a6d60422882148dfbf6a9680aca05cd948531f281e0e
- `skill.opencode`: 97ab0aaaeab67eedb3f401565ce8904dbd5c729cf72b085b434142fd5d634550 → 48d019a0096fa1f224f4a6d60422882148dfbf6a9680aca05cd948531f281e0e
- `task`: 02affc8ba4e07c87b38ccd27fe73c2ce3c0081fc46b00875b175a50e6051e960 → 02f3bc8b7df8bf0a3cf0980f916af00e3b348323bad9757899aa679095f67472
