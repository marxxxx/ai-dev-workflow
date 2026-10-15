# Compare demo-todo · opencode: **worse**

Baseline: `/home/mx/src/ai-dev-workflow/docs/adw-e2e/2026-10-14T1445Z/demo-todo/opencode`
Candidate: `/home/mx/src/ai-dev-workflow/docs/adw-e2e/2026-10-15T1159Z/demo-todo/opencode`

## Signals

| Signal | Baseline | Candidate | Kind |
|---|---|---|---|
| review:conventions | 5 | 4 | regression |
| review:architecture | 4 | 3 | regression |
| median:tokens | 881,140 | 1,486,186 | noise |

## What changed (fingerprint diff)

- `adw.sha`: 8795ced52a0b0f35e5e4d149ab6b6e49b9b20d0e → e886701457f87b766e69e1fbbc76a02e34ef873e
- `ccusage`: 20.0.31 → 20.0.32
- `config`: 3b96dd9306a3f11f73c185a46f87e13f4a175276b42eabf9a7fe62a24c12b0fb → d86521c9a4663bdd8de6e2be965bbb601cf0ad1b235a7541cad6fe57faaced44
- `image.harnessVersion`: 1.18.35 → 1.19.0
- `image.id`: sha256:c7f645dcd33246ef49f1bde90a784c5c78c91de3ba5cd94a6b37c2c04b1f2354 → sha256:dd8a71df3012301ef215d301c0d6ac2f11cf249f7bef39dabe5c86e22175e09f
- `image.inventory`: b96901724607dea7e3f16a6bc912ce331efa22dbc4777ab298def7f01d4f527a → f73312c8b32a0eff8a6e42407639392e80cae5d02d97ee54f12a4af8dc7a6d6e
- `image.superpowers`: 8ca22dba9a94f28898bbce59f2537ff4d87c747d → bb92a77741419a4ab5f06e711a283343f1ada0c3
- `skill.claude`: ea87673f3e7d4c579c63688260ede3671cbda5cd7006b80ce7c8269fd031a555 → 97ab0aaaeab67eedb3f401565ce8904dbd5c729cf72b085b434142fd5d634550
- `skill.codex`: ea87673f3e7d4c579c63688260ede3671cbda5cd7006b80ce7c8269fd031a555 → 97ab0aaaeab67eedb3f401565ce8904dbd5c729cf72b085b434142fd5d634550
- `skill.includes`: 460615f461c8f598aa54476bf12030d302e9573c9d6b9d821e8f7b19b1b0d2a8:bb994111b36588f4909cc177d39df55899df4efbbb9e3d69d1a9a807ddd51afd → 460615f461c8f598aa54476bf12030d302e9573c9d6b9d821e8f7b19b1b0d2a8:de8e8443addc7abd272af71c7102e56e4614e9ebd357888f3bba18a0414c9994
- `skill.opencode`: ea87673f3e7d4c579c63688260ede3671cbda5cd7006b80ce7c8269fd031a555 → 97ab0aaaeab67eedb3f401565ce8904dbd5c729cf72b085b434142fd5d634550
- `task`: 5eb740134f777a402937f52ee7641b709cf792dc53974cb4d80092b5858bea11 → 3dea70a503184309c5f8bbd3e7e717d537f0b372eb3ed69dc9a288b856de256f
