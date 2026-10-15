# Compare demo-todo · codex: **worse**

Baseline: `/home/mx/src/ai-dev-workflow/docs/adw-e2e/2026-10-14T1114Z/demo-todo/codex`
Candidate: `/home/mx/src/ai-dev-workflow/docs/adw-e2e/2026-10-15T0938Z/demo-todo/codex`

## Signals

| Signal | Baseline | Candidate | Kind |
|---|---|---|---|
| review:tests | 5 | 4 | regression |
| review:conventions | 5 | 4 | regression |
| median:agent | 1,642 | 497 | improvement |

## What changed (fingerprint diff)

- `adw.sha`: ff0376ff580c31de8242b7dff7d1444db1c20bd1 → b408a440dd02b4c7c1f228a7d9babb4a6ddd27df
- `ccusage`: undefined → 20.0.32
- `code.lib`: 80c703ef6e27057c99e2e779c4523b5fdd0e0accecac1626625543e62841b255 → 448a9daff708940389a4d6fb40a52be9bf66943ee97aee330b24bbaf0395e2f2
- `config`: 725f81f133bc532b5fb5af520da7d2a91f1f8c45c86ae11045092e673b28d6ae → d86521c9a4663bdd8de6e2be965bbb601cf0ad1b235a7541cad6fe57faaced44
- `image.harnessVersion`: 0.161.0 → 0.162.1
- `image.id`: sha256:c7f645dcd33246ef49f1bde90a784c5c78c91de3ba5cd94a6b37c2c04b1f2354 → sha256:dd8a71df3012301ef215d301c0d6ac2f11cf249f7bef39dabe5c86e22175e09f
- `image.inventory`: b96901724607dea7e3f16a6bc912ce331efa22dbc4777ab298def7f01d4f527a → f73312c8b32a0eff8a6e42407639392e80cae5d02d97ee54f12a4af8dc7a6d6e
- `image.superpowers`: 8ca22dba9a94f28898bbce59f2537ff4d87c747d → bb92a77741419a4ab5f06e711a283343f1ada0c3
- `skill.claude`: ea87673f3e7d4c579c63688260ede3671cbda5cd7006b80ce7c8269fd031a555 → 97ab0aaaeab67eedb3f401565ce8904dbd5c729cf72b085b434142fd5d634550
- `skill.codex`: ea87673f3e7d4c579c63688260ede3671cbda5cd7006b80ce7c8269fd031a555 → 97ab0aaaeab67eedb3f401565ce8904dbd5c729cf72b085b434142fd5d634550
- `skill.includes`: 460615f461c8f598aa54476bf12030d302e9573c9d6b9d821e8f7b19b1b0d2a8:bb994111b36588f4909cc177d39df55899df4efbbb9e3d69d1a9a807ddd51afd → 460615f461c8f598aa54476bf12030d302e9573c9d6b9d821e8f7b19b1b0d2a8:de8e8443addc7abd272af71c7102e56e4614e9ebd357888f3bba18a0414c9994
- `skill.opencode`: ea87673f3e7d4c579c63688260ede3671cbda5cd7006b80ce7c8269fd031a555 → 97ab0aaaeab67eedb3f401565ce8904dbd5c729cf72b085b434142fd5d634550
- `task`: 5eb740134f777a402937f52ee7641b709cf792dc53974cb4d80092b5858bea11 → 4420e5ab403a072da868fa9c61aca5844dc87ac417b3798ce5a069fb02029e18
