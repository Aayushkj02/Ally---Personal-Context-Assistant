# Phase 1 — Ownership & Task Allocation

Baseline: `dev` @ `d5ea2ee` (Phase 0). Task IDs are the existing ones from the plan — no new IDs.

## 1. Team responsibility matrix

| Developer | Primary area | Owned directories |
|---|---|---|
| **Aayush** | Android, RN app, device capabilities, native modules, action execution, app orchestration | `app/modules/` · `app/src/native/` · `app/src/actions/` (except crashRecovery) · `app/src/navigation/` · `app/src/screens/{Home,ActiveContext,Permissions}/` · `app/app.json` · `app/eas.json` · `app/package.json` · `app/tsconfig.json` |
| **Shlok** | AI, intent parsing, fallback parser, prompts, validation, evaluation | `app/src/ai/` · `app/src/modes/` · `app/src/services/bridgeClient.ts` · `bridge/src/parse/` · `bridge/prompts/` · `evals/` |
| **Dhrey** | Database, memory, profiles, preferences, overrides, sessions, snapshots, policy, design system, crash recovery | `app/src/memory/` · `app/src/policy/` · `app/src/components/` · `app/src/theme/` · `app/src/store/` · `app/src/screens/{Onboarding,Profiles,Memory,History}/` · `app/src/services/sessionSync.ts` · `bridge/src/server/` · `app/src/actions/__tests__/crashRecovery.test.ts` |

## 2. Phase 1 task allocation

| Task ID | Developer | Task | Files/Directories owned | Dependencies | Start now? | Deliverable | Validation |
|---|---|---|---|---|---|---|---|
| **T1** | Aayush | Expo dev build | `app/package.json`, `app/app.json`, `app/eas.json` | none | **YES** | APK shared with both teammates | App launches; JS hot-reloads |
| **T2** | Aayush | Kotlin module scaffold | `app/modules/ally-native/` | T1 | after T1 | `AllyNative` resolves from JS | `requireOptionalNativeModule` returns non-null |
| **T3** | Aayush | **DND spike** | `app/src/native/capabilities/DndCapability.ts` | T2 | after T2 | DND toggles from JS | Status-bar icon on/off; priority contact rings; `DEVICE_NOTES.md` filled; ADR-103 |
| **T4** | Aayush | Brightness + WRITE_SETTINGS | `app/src/native/capabilities/BrightnessCapability.ts` | T2 | after T2 | Set + read-back + restore | Set 40 to reads 40 to restores exact prior value |
| **T8** | Aayush | MockDevice | `app/src/native/MockDevice.ts` | none | **DONE** | Shipped in Phase 0 | Runtime-verified: snapshot/execute/restore exact |
| **S1** | Shlok | Ollama install + model bake-off | `bridge/src/parse/` | none | **YES** | Model chosen on latency + JSON validity | Smallest model at 90%+ on golden set under 2s; ADR-201 |
| **S3** | Shlok | **FallbackParser** (write FIRST) | `app/src/ai/parsers/FallbackParser.ts` | none | **YES** | All 7 golden commands, offline | `npm run eval` passes with Wi-Fi off |
| **S4** | Shlok | IntentValidator | `app/src/ai/validators/` | none | **YES** | zod schema, enum-constrained | Unknown capability rejected, not coerced |
| **S6** | Shlok | Mode definition files | `app/src/modes/*.json` | none | **YES** *(partial — seeded in Phase 0)* | Behaviour change needs zero code change | Editing JSON alters resolved policy |
| **S2** | Shlok | `/parse` route + JSON schema | `bridge/src/parse/`, `app/src/ai/schemas/` | S1 | after S1 | Structured output, temperature 0 | Returns valid `Intent` for all 7 commands |
| **S8** | Shlok | Eval harness (40 cases) | `evals/` | S3 | after S3 | `npm run eval` prints per-field pass rate | 70%+ at the Phase 1 gate |
| **D1** | Dhrey | SQLite schema + repositories | `app/src/memory/` | none | **YES** | 8 tables + 5 repos, Study/Sleep seeded | Round-trips every row type |
| **D2** | Dhrey | `PolicyEngine.resolve()` | `app/src/policy/` | none | **YES** | Precedence + unit tests | `npm test` green; command > override > profile > default |
| **D4** | Dhrey | Design system | `app/src/theme/`, `app/src/components/` | none | **YES** | Tokens + 5 components | Renders; `theme/` frozen at gate |

**Seven of fourteen tasks start immediately with zero dependencies.** Every developer has at least three.

## 3. Dependency graph

```
AAYUSH   T1 ──► T2 ──┬──► T3  DND spike      ┐   ← critical path
                     └──► T4  brightness     │
         T8 ✅ done (Phase 0)                │
                                             │
SHLOK    S1 ──► S2  /parse route             ├──► PHASE 1 GATE
         S3 ──► S8  eval harness             │
         S4 ─────────────────────────────────┤
         S6 ─────────────────────────────────┤
                                             │
DHREY    D1 ─────────────────────────────────┤
         D2 ─────────────────────────────────┤
         D4 ─────────────────────────────────┘
```

**No cross-developer dependency exists in Phase 1.** Every arrow is internal to one person.
That is deliberate: the frozen contracts (ADR-006) and `MockDevice` (ADR-007) removed them.

- **Blocking:** T1 → T2 → T3/T4 (Aayush's own chain, and the project critical path)
- **Fully parallel:** all of Shlok's work, all of Dhrey's work, and Aayush's chain
- **Start first:** T1, S1, S3, D1, D2, D4

Order note: Aayush does **T3 before anything cosmetic** — it is the only task that can kill the demo.
Shlok writes **S3 before S1/S2** — insurance before enhancement (ADR-003).

## 4. Merge-conflict analysis

| Shared file | Single owner | Prevention |
|---|---|---|
| `app/src/types/**` | **Nobody — FROZEN** | ADR-006. Change needs all three to agree; one person edits. `tsc --noEmit` gates every phase. |
| `app/package.json` | **Aayush** | Others announce a dependency; Aayush installs. Two concurrent installs = lockfile conflict. |
| `app/tsconfig.json` | **Aayush** | Phase 1 extends `expo/tsconfig.base`, keeping `strict`, `noUncheckedIndexedAccess`, `@/*` (ADR-009). |
| `app/src/navigation/index.ts` | **Aayush** | Every screen registers here. Need a route? Ask — do not add it. |
| `app/src/store/index.ts` | **Dhrey** | Frozen at end of Phase 1. |
| `app/src/theme/index.ts` | **Dhrey** | Frozen at end of Phase 1. |
| `app/src/utils/index.ts` | Shared | Append-only, one block per owner. Blocks never move, so conflicts resolve by keeping both. |
| `app/src/services/` | Split per **file** | `bridgeClient.ts` Shlok, `sessionSync.ts` Dhrey. No shared file. |
| `bridge/` | Split per **directory** | `src/parse` + `prompts` Shlok, `src/server` Dhrey. One process, no shared code. |
| `DECISIONS.md` | Shared | ID-partitioned (0xx/1xx/2xx/3xx), append-only. Conflicts resolve by keeping both. |
| `FLOW.md` | Shared | Nine owner-partitioned sections. Edit only yours. |
| `.prettierrc` / `.gitattributes` | **Aayush** | Frozen. No formatter changes after Phase 0 — a reflow is a 200-line phantom conflict. |
| `app/src/modes/*.json` | **Shlok** | Aayush and Dhrey review, never edit. |

**Strategy:** where two developers need the same capability we define the interface, give
implementation to one owner, and let the other code against the contract. Three cases:
`ActionPlan` (Dhrey implements, Aayush consumes), `Intent` (Shlok implements, Dhrey consumes),
`DeviceCapability` (Aayush implements, everyone consumes via `MockDevice`).

## 5. Branch plan

All branches start from the latest `dev`. Never commit to `main`. Never push directly to `dev`.

```bash
git checkout dev && git pull --rebase origin dev && git checkout -b <branch>
```

| Developer | Branch | Tasks |
|---|---|---|
| Aayush | `feature/aayush/expo-dev-build` | T1, T2 |
| Aayush | `feature/aayush/device-capabilities` | T3, T4 |
| Shlok | `feature/shlok/fallback-parser` | S3, S4, S6 |
| Shlok | `feature/shlok/ollama-bridge` | S1, S2 |
| Shlok | `feature/shlok/eval-harness` | S8 |
| Dhrey | `feature/dhrey/data-layer` | D1 |
| Dhrey | `feature/dhrey/policy-engine` | D2 |
| Dhrey | `feature/dhrey/design-system` | D4 |

Land the first branch before starting the second. No branch outlives the Phase 1 gate.

## 6. Commit plan

Small, logically scoped, one unit of work each. Never mix unrelated changes.

**Aayush**
```
chore(android): add expo dev client and prebuild config
feat(native): scaffold ally-native expo module
feat(native): add DND capability via AutomaticZenRule
docs(device): record DND behaviour on target hardware
feat(native): add brightness capability with write-settings flow
fix(native): keep MockDevice in parity with capability interface
```

**Shlok**
```
feat(ai): add intent parser interface and parser registry
feat(ai): implement deterministic fallback parser
test(ai): add golden command cases for fallback parser
feat(ai): add zod intent validator with capability allow-list
feat(bridge): add ollama parse route with structured output
feat(ai): add engine selector with timeout and silent fallback
test(ai): add eval harness with per-field pass rate
```

**Dhrey**
```
feat(data): add sqlite schema and migrations
feat(data): add profile and preference repositories
feat(data): add session, override and snapshot repositories
feat(policy): implement precedence resolver
test(policy): add precedence and expiry unit tests
feat(ui): add design tokens
feat(ui): add core component set
```

## 7. Definition of done — every Phase 1 task

- [ ] Implementation complete against the frozen contract in `docs/CONTRACTS.md`
- [ ] Tests added or updated where the task is testable without a device
- [ ] `npx tsc --noEmit` passes
- [ ] `npm test` green — existing tests still pass
- [ ] `npx prettier --check` clean
- [ ] `DECISIONS.md` ADR added in your range if a real decision was made
- [ ] `FLOW.md` section updated **in the same commit** if the flow changed
- [ ] `MockDevice` parity maintained if the native surface changed (ADR-007)
- [ ] No unrelated changes in the diff
- [ ] Committed, branch pushed
- [ ] PR opened into `dev`, reviewer = the owner of the adjacent contract

## 8. Phase 1 gate

Do not start Phase 2 until all of these pass:

- Aayush: DND toggles from a JS call on real hardware; APK on all three phones
- Shlok: all 7 golden commands parse correctly **with the network off**; `npm run eval` at 70%+
- Dhrey: `npm test` green; `resolve()` returns the correct merged policy
- All: `tsc --noEmit` clean, working tree clean, `dev` merged to `main`
- `theme/` and `store/` frozen
