# Compare demo-todo · opencode: **worse**

Baseline: `/home/ai/src/ai-dev-workflow/docs/adw-e2e/2026-10-23T2009Z/demo-todo/opencode`
Candidate: `/home/ai/src/ai-dev-workflow/docs/adw-e2e/2026-11-01T1600Z/demo-todo/opencode`

## Signals

| Signal | Baseline | Candidate | Kind |
|---|---|---|---|
| rewardRate | 1 | 0 | regression |
| review:conventions | 4 | 5 | improvement |
| review:architecture | 4 | 5 | improvement |
| median:tokens | 3,734,520 | 6,117,679 | regression |

## What changed (fingerprint diff)

- `adw.dirty`: false → true
- `adw.sha`: 4c6196612bf8d5cda078fb168d0843e19286a923 → fe1008afb211e9f52b5988e4bb307f31e2366833
- `adw.version`: 0.28.0 → 0.29.1
- `code.agents`: d0da995efeca9c264b60d5b89daaaf8676038179c9502bfb8a4f804ba286495b → 1eadd18e4adb30f8a23b1b462c648fb05751115e5020228fd38062b5d4f1404e
- `code.lib`: 4674f72ba86ec174e083cc0a55aa210119fcf023f49cc94ee29ca36d8c1b6ba9 → 111974075d79e79d6221fda2e8acf38ed24d1e7f1fbc6ea7cbfd1fdb7afa780b
- `config`: 1ff0716c9335e44bede9e57b40bcf1538fd283d6c6850d494fb142cff041ebf0 → a4909ab6baa953566d2d849ffba7effc04b089e43d535064fa94c5784cab9db1
- `image.harnessVersion`: 1.19.4 → 2.2.3
- `image.id`: sha256:bbaca401df37e55ff018b03b0a9e946eee10fff6a14635991da8951ff590f70a → sha256:2a6d97cd22c3814476944c4e385570ca0f5bc49c84d692410d5fb03207c0cab8
- `image.inventory`: be1ece0171d7af148100fdcf1ba8aa846a6a088e455ab86b227b30b6a32614ec → 744051c6c8aed8068d0e43ed8a7b2db293ec5168e46b3dd94c7aa34e41678f06
- `skill.claude`: 97ab0aaaeab67eedb3f401565ce8904dbd5c729cf72b085b434142fd5d634550 → 48d019a0096fa1f224f4a6d60422882148dfbf6a9680aca05cd948531f281e0e
- `skill.codex`: 97ab0aaaeab67eedb3f401565ce8904dbd5c729cf72b085b434142fd5d634550 → 48d019a0096fa1f224f4a6d60422882148dfbf6a9680aca05cd948531f281e0e
- `skill.opencode`: 97ab0aaaeab67eedb3f401565ce8904dbd5c729cf72b085b434142fd5d634550 → 48d019a0096fa1f224f4a6d60422882148dfbf6a9680aca05cd948531f281e0e
- `task`: 697d1a3a2075179ae8908caee40fdf29606b4060ce9633702017fc2c40339bba → 8a5565521b06dd7c3aaa1cfa17b438d5e2849af40fa061f0c8104a0a26968e68
