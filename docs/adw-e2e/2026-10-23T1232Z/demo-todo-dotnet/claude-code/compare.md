# Compare demo-todo-dotnet · claude-code: **worse**

Baseline: `/home/mx/src/ai-dev-workflow/docs/adw-e2e/2026-10-15T0840Z/demo-todo-dotnet/claude-code`
Candidate: `/home/mx/src/ai-dev-workflow/docs/adw-e2e/2026-10-23T1232Z/demo-todo-dotnet/claude-code`

## Signals

| Signal | Baseline | Candidate | Kind |
|---|---|---|---|
| review:conventions | 4 | 5 | improvement |
| review:architecture | 4 | 5 | improvement |
| median:tokens | 3,640,145 | 6,251,527 | noise |
| median:cost | 2.136 | 3.421 | regression |
| median:agent | 428 | 770 | noise |

## What changed (fingerprint diff)

- `adw.sha`: b408a440dd02b4c7c1f228a7d9babb4a6ddd27df → e440089a92a5d01c965ef0827b0ad775a4601224
- `adw.version`: 0.25.0 → 0.28.0
- `code.agents`: 7f5997abe9fed3c12971846efcc906b799cacb5a450db838fbb6047836be4ab7 → d0da995efeca9c264b60d5b89daaaf8676038179c9502bfb8a4f804ba286495b
- `code.lib`: 448a9daff708940389a4d6fb40a52be9bf66943ee97aee330b24bbaf0395e2f2 → 4674f72ba86ec174e083cc0a55aa210119fcf023f49cc94ee29ca36d8c1b6ba9
- `config`: d86521c9a4663bdd8de6e2be965bbb601cf0ad1b235a7541cad6fe57faaced44 → 1ff0716c9335e44bede9e57b40bcf1538fd283d6c6850d494fb142cff041ebf0
- `image.harnessVersion`: 2.1.299 → 2.1.309
- `image.id`: sha256:ace9073ee964d44277cf61280e09662d29a37dc9e9d1a04e3b764ad86ffe10cb → sha256:0150386d54bedb60ce043bcddee75b3a451c1eb5dc658af364ccd46ddfeacc16
- `image.inventory`: f73312c8b32a0eff8a6e42407639392e80cae5d02d97ee54f12a4af8dc7a6d6e → be1ece0171d7af148100fdcf1ba8aa846a6a088e455ab86b227b30b6a32614ec
- `image.superpowers`: bb92a77741419a4ab5f06e711a283343f1ada0c3 → 2ce8aa15d05bd57213e6f746f953aafb7ded7a8b
- `skill.includes`: 460615f461c8f598aa54476bf12030d302e9573c9d6b9d821e8f7b19b1b0d2a8:de8e8443addc7abd272af71c7102e56e4614e9ebd357888f3bba18a0414c9994 → 460615f461c8f598aa54476bf12030d302e9573c9d6b9d821e8f7b19b1b0d2a8:9905aed6ff6a01bbb005f626e5bf6af85f9bde49ed2b27cee46a1f2302aecce8
- `task`: 67609e58374d53fd00a5fa2ba22dd73ff7c7913af90752eefe0d07d75840883c → 02affc8ba4e07c87b38ccd27fe73c2ce3c0081fc46b00875b175a50e6051e960
