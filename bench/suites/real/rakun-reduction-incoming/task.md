---
files: [src/main/java/me/rakkoon69/rakunminiitems/stat/StatSession.java]
test: "bash ./gradlew --console=plain test --tests me.rakkoon69.rakunminiitems.stat.StatSessionTest"
---
# Take damage reduction off the incoming hit, not the damage dealt

`StatSession.apply` removes the matching damage-reduction percents from the damage dealt (the hit
after bonus damage). That is the wrong base: reduction protects the holder from the hit coming in.
With a hit of 2 that bonus damage raises to 13.2 and 10% reduction, the damage taken must be 1.8,
not 11.88.

- Damage taken is the incoming hit's base damage minus the matching reduction percents added together.
- With no matching reduction percent, damage taken stays what it is today.
- The damage dealt and the heal do not change. A flat reduction is still not applied.

Update the class Javadoc and the `apply` Javadoc so they describe the new base.
