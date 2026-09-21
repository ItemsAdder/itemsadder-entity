# V2 export verification

Verified 2026-09-17 against Blockbench 5.1.6 on the shared headless Xvfb display.

## Build and focused tests

```sh
env -u npm_config_prefix rtk npm run build
```

PASS. Latest build ID: `local-fe42e993bc97ed2deb48efa6b97e11ac6d9879a5b94acc86cd3021d95d024da5`.

```sh
for f in src/animationSettings.test.ts src/boneEffects.test.ts src/exporters/modelJsonWriter.test.ts src/exporters/v2LocalTransforms.test.ts src/exporters/v2GeometryProfiles.test.ts src/format/v2EmbeddedTextures.test.ts src/format/EntityV2Codec.test.ts src/textureVariant.test.ts; do rtk node -r ts-node/register "$f" || exit; done
```

PASS: all eight suites. The model-writer test verifies standalone overlay declarations remain complete and repeated/multiple V2 exports have merge-safe, resource-owned overlay directory names. The embedded-texture tests include the canonical animated-texture hash golden, same-PNG/different-`.mcmeta` separation, PNG validation, payload validation, and the 256-entry bound.

### Multiple-export overlay aggregation follow-up

ItemsAdder reserves and emits the global `ia_overlay_1_21_6_plus` and `ia_overlay_modern_atlas` declarations, then merges declarations from every content pack by directory name. Reusing those names in each standalone V2 export therefore produced duplicate-entry warnings. V2 geometry exports now use deterministic directories owned by the model resource ID:

```text
ia_overlay_v2_<sha256(namespace:entity/model)>_1_21_6_plus
ia_overlay_v2_<sha256(namespace:entity/model)>_modern_atlas
```

The focused filesystem suite creates two standalone packs, verifies each declares both required overlays exactly once, repeats each export to prove idempotency, and merges all declarations to prove there are no duplicate names or collisions with ItemsAdder's reserved overlays. It also verifies two models sharing one standalone pack retain four unique declarations. Build and all eight focused suites passed after this change.

```sh
BLOCKBENCH_DISPLAY=:99 BLOCKBENCH_PROFILE_DIR=/mnt/scratch/tmp/codex/task.BG0UnZ/blockbench-overlay-unique-final BLOCKBENCH_TEST_V2_GEOMETRY=1 rtk timeout 110 rtk node tests/blockbench/run.js
```

PASS, exit 0: three profiles, 27 files, unique resource-owned overlay directories, and a byte-identical second export. Output: `/mnt/scratch/tmp/codex/task.BG0UnZ/blockbench-overlay-unique-final/v2-geometry-output`. The server was not relaunched for this exporter-only path/declaration follow-up.

## Real editor and exporter

```sh
BLOCKBENCH_DISPLAY=:99 BLOCKBENCH_PROFILE_DIR=/mnt/scratch/tmp/codex/task.BG0UnZ/blockbench-layered-embedded-final BLOCKBENCH_TEST_V2=1 rtk timeout 110 rtk node tests/blockbench/run.js
```

PASS, exit 0. Output: `/mnt/scratch/tmp/codex/task.BG0UnZ/blockbench-layered-embedded-final/v2-output`.

This run creates, renames, edits, previews, round-trips, and deletes a texture variant through the real editor UI. It also edits the visibility/tint effect channels and animation layer settings through their real UI. The replacement PNG is referenced only by the declared `blink` variant; the test requires both base and blink payload digests in `metadata.textures`, exact source bytes in both sidecars, and the digest reference in the blink profile model. A second export is byte-identical, and no unexpected page error is accepted.

```sh
BLOCKBENCH_DISPLAY=:99 BLOCKBENCH_PROFILE_DIR=/mnt/scratch/tmp/codex/task.BG0UnZ/blockbench-local-geometry-embedded-final BLOCKBENCH_TEST_V2_GEOMETRY=1 rtk timeout 110 rtk node tests/blockbench/run.js
```

PASS, exit 0: three profiles, 27 files, byte-identical second export. Output: `/mnt/scratch/tmp/codex/task.BG0UnZ/blockbench-local-geometry-embedded-final/v2-geometry-output`.

```sh
BLOCKBENCH_DISPLAY=:99 BLOCKBENCH_PROFILE_DIR=/mnt/scratch/tmp/codex/task.BG0UnZ/blockbench-artists-embedded BLOCKBENCH_TEST_V2_ARTISTS=1 rtk timeout 180 rtk node tests/blockbench/run.js
```

PASS, exit 0. Output: `/mnt/scratch/tmp/codex/task.BG0UnZ/blockbench-artists-embedded/v2-artist-output`.

- `goofy_goblin`: 161 files, 53 bones, `pose` and `walk` preserved.
- `armored_grub`: 120 files, 20 bones, `idle` preserved.
- Both editable projects retain embedded PNG data. Runtime metadata contains referenced base/variant textures only; unreferenced editor assets remain in the project.
- Each conversion includes `oracle.json` and `conversion-report.json`; its second export is byte-identical.

## Checkout limitation

`env -u npm_config_prefix rtk npm run fixtures:check` cannot run in this task checkout because its tracked checker expects the absent `test-fixtures/golden` directory. The real Blockbench fixtures above perform their own fresh-output and byte-determinism checks.
