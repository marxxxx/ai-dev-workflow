# Compare demo-todo · codex: **worse**

Baseline: `/home/mx/src/ai-dev-workflow/docs/adw-e2e/2026-10-15T0938Z/demo-todo/codex`
Candidate: `/home/mx/src/ai-dev-workflow/docs/adw-e2e/2026-10-21T1448Z/demo-todo/codex`

## Signals

| Signal | Baseline | Candidate | Kind |
|---|---|---|---|
| median:agent | 497 | 777 | noise |
| error:harbor | 0 | 1 | regression |
| error:timeout | 0 | 1 | regression |

## What changed (fingerprint diff)

- `adw.dirty`: true → false
- `adw.sha`: b408a440dd02b4c7c1f228a7d9babb4a6ddd27df → d8bf3ac8a80414d6cedfe3ed11a547dfad202b1a
- `adw.version`: 0.25.0 → 0.27.0
- `code.agents`: 7f5997abe9fed3c12971846efcc906b799cacb5a450db838fbb6047836be4ab7 → d0da995efeca9c264b60d5b89daaaf8676038179c9502bfb8a4f804ba286495b
- `code.lib`: 448a9daff708940389a4d6fb40a52be9bf66943ee97aee330b24bbaf0395e2f2 → 4674f72ba86ec174e083cc0a55aa210119fcf023f49cc94ee29ca36d8c1b6ba9
- `config`: d86521c9a4663bdd8de6e2be965bbb601cf0ad1b235a7541cad6fe57faaced44 → f5c6aa7f243698fed6e9f44aec0e45008b7e243da239048257ac835fa7ac58a9
- `image.harnessVersion`: 0.162.1 → 0.163.0
- `image.id`: sha256:dd8a71df3012301ef215d301c0d6ac2f11cf249f7bef39dabe5c86e22175e09f → sha256:828bb04729e38109c5d06ccd361656988952d0db55aa925d3b6b4951606bb3f6
- `image.inventory`: f73312c8b32a0eff8a6e42407639392e80cae5d02d97ee54f12a4af8dc7a6d6e → 0fdc72c7d77ac4ba89ffe1399c59889caa06ccb0c6d6da5e65855eb0f432d268
- `image.superpowers`: bb92a77741419a4ab5f06e711a283343f1ada0c3 → b739a8af570e10a95898f2bdf6cec97467fa6c12
- `skill.includes`: 460615f461c8f598aa54476bf12030d302e9573c9d6b9d821e8f7b19b1b0d2a8:de8e8443addc7abd272af71c7102e56e4614e9ebd357888f3bba18a0414c9994 → 460615f461c8f598aa54476bf12030d302e9573c9d6b9d821e8f7b19b1b0d2a8:9905aed6ff6a01bbb005f626e5bf6af85f9bde49ed2b27cee46a1f2302aecce8
- `task`: 4420e5ab403a072da868fa9c61aca5844dc87ac417b3798ce5a069fb02029e18 → f71025708a1207559f1874c945fef083a9f2d36443341a231f0e3f3fd9b04b66
