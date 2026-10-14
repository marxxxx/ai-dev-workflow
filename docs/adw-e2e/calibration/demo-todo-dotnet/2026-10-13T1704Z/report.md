# Verifier calibration: **pass**

Verifier hash `cf30252` · verifier `claude-sonnet-5-5` · review `claude-sonnet-5-5` · runs per variant: 3

## Findings

| Variant | Check | Expected | Got | Kind |
|---|---|---|---|---|
| — | | | | |

## Acceptance verdicts (one per run)

| Variant | AC1 | AC2 | AC3 | AC4 | AC5 | AC6 | AC7 |
|---|---|---|---|---|---|---|---|
| reference | pass pass pass | pass pass pass | pass pass pass | pass pass pass | pass pass pass | pass pass pass | pass pass pass |
| alt-interface | pass pass pass | pass pass pass | pass pass pass | pass pass pass | pass pass pass | pass pass pass | pass pass pass |
| broken-done | pass pass pass | pass pass pass | pass pass pass | fail fail fail | pass pass pass | pass pass pass | pass pass pass |
| broken-ui | pass pass pass | pass pass pass | pass pass pass | pass pass pass | pass pass pass | fail fail fail | fail fail fail |
| messy | pass pass pass | pass pass pass | pass pass pass | pass pass pass | pass pass pass | pass pass pass | pass pass pass |

## Review medians

| Variant | requirements | scope | tests | conventions | architecture | codeQuality |
|---|---|---|---|---|---|---|
| reference | 5 | 5 | 4 | 4 | 4 | 4 |
| alt-interface | 4 | 4 | 3 | 3 | 3 | 3 |
| broken-done | 3 | 4 | 3 | 4 | 3 | 3 |
| broken-ui | 2 | 4 | 2 | 4 | 4 | 2 |
| messy | 3 | 3 | 1 | 2 | 2 | 2 |

## Errors

none
