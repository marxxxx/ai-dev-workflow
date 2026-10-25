# Compare demo-todo · claude-code: **worse**

Baseline: `/home/mx/src/ai-dev-workflow/docs/adw-e2e/2026-10-15T0840Z/demo-todo/claude-code`
Candidate: `/home/mx/src/ai-dev-workflow/docs/adw-e2e/2026-10-23T1232Z/demo-todo/claude-code`

## Signals

| Signal | Baseline | Candidate | Kind |
|---|---|---|---|
| review:architecture | 4 | 5 | improvement |
| median:cost | 1.491 | 2.443 | regression |
| median:agent | 287 | 465 | regression |

## What changed (fingerprint diff)

- `adw.sha`: b408a440dd02b4c7c1f228a7d9babb4a6ddd27df → e440089a92a5d01c965ef0827b0ad775a4601224
- `adw.version`: 0.25.0 → 0.28.0
- `code.agents`: 7f5997abe9fed3c12971846efcc906b799cacb5a450db838fbb6047836be4ab7 → d0da995efeca9c264b60d5b89daaaf8676038179c9502bfb8a4f804ba286495b
- `code.lib`: 448a9daff708940389a4d6fb40a52be9bf66943ee97aee330b24bbaf0395e2f2 → 4674f72ba86ec174e083cc0a55aa210119fcf023f49cc94ee29ca36d8c1b6ba9
- `config`: d86521c9a4663bdd8de6e2be965bbb601cf0ad1b235a7541cad6fe57faaced44 → 1ff0716c9335e44bede9e57b40bcf1538fd283d6c6850d494fb142cff041ebf0
- `image.harnessVersion`: 2.1.299 → 2.1.309
- `image.id`: sha256:dd8a71df3012301ef215d301c0d6ac2f11cf249f7bef39dabe5c86e22175e09f → sha256:bbaca401df37e55ff018b03b0a9e946eee10fff6a14635991da8951ff590f70a
- `image.inventory`: f73312c8b32a0eff8a6e42407639392e80cae5d02d97ee54f12a4af8dc7a6d6e → be1ece0171d7af148100fdcf1ba8aa846a6a088e455ab86b227b30b6a32614ec
- `image.superpowers`: bb92a77741419a4ab5f06e711a283343f1ada0c3 → 2ce8aa15d05bd57213e6f746f953aafb7ded7a8b
- `skill.includes`: 460615f461c8f598aa54476bf12030d302e9573c9d6b9d821e8f7b19b1b0d2a8:de8e8443addc7abd272af71c7102e56e4614e9ebd357888f3bba18a0414c9994 → 460615f461c8f598aa54476bf12030d302e9573c9d6b9d821e8f7b19b1b0d2a8:9905aed6ff6a01bbb005f626e5bf6af85f9bde49ed2b27cee46a1f2302aecce8
- `task`: 4420e5ab403a072da868fa9c61aca5844dc87ac417b3798ce5a069fb02029e18 → 697d1a3a2075179ae8908caee40fdf29606b4060ce9633702017fc2c40339bba
