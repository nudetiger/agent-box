---
files: [src/main/java/me/rakkoon69/rakunminiitems/ability/DashHandler.java]
sealed: [src/test/java/me/rakkoon69/rakunminiitems/ability/DashHandlerTest.java]
test: "bash ./gradlew --console=plain test"
steps: 25
---
Remove `DashHandler`'s own cooldown map, as #50 asked. MMOItems already applies cooldown, mana and stamina itself in `AbilityData.getResult`/`whenCast` from the handler's `cooldown`/`mana`/`stamina` parameters, so the handler's map is a second cooldown path.

Required:
- Delete the `cooldowns` field, `isOnCooldown`, the cooldown checks in `getResult` and `cast`, and the `cooldowns.put` in `cast`. Drop imports that become unused.
- Keep publishing `cooldown`, `mana`, `stamina` as handler parameters through `update` (unchanged).
- `cast(player, abilityData)` still works as a direct entry point and returns true for a player, false for null. Update its javadoc to drop the cooldown wording.
- The sealed `DashHandlerTest` fixes the behaviour: an immediate second cast fires.

Out of scope: `MobCooldowns`, `MobAbilityListener` (mobs keep their own per-mob cooldown, #51), every other file.
