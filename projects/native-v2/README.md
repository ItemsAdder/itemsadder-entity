# Permanent Entity V2 fixtures

- `ender_dragon_v2`: real entity hierarchy, Flight Blend and Procedural Motion reference.
- `ender_dragon_blend_v2`: Flight Blend alone.
- `ender_dragon_procedural_v2`: Procedural Motion alone.
- `ender_dragon_hybrid_v2`: Flight Blend and Procedural Motion together.
- `pig_v2`: ordinary Vanilla model, geometry, gait and Entity V2 parity.
- `zombie_v2`: humanoid hierarchy, Vanilla texture and semantic arm motion.
- `goofy_goblin`, `armored_grub`: artist authored non Vanilla rigs.

Editable projects and required textures live in each `source/`; Dragon bundles in `contents/` are canonical export references. Blockbench tests load Pig and Zombie directly from these sources.
