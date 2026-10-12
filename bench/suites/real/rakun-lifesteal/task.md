---
files: [src/main/java/me/rakkoon69/rakunminiitems/stat/StatSession.java]
test: "bash ./gradlew --console=plain test --tests me.rakkoon69.rakunminiitems.stat.StatSessionTest"
---
# Apply lifesteal when a hit is judged

`StatSession.apply` computes the damage dealt but always returns a heal of zero, so lifesteal stats
do nothing. Make the heal come from the lifesteal family:

- The heal is the matching lifesteal percents, added together, applied to the damage dealt (after
  bonus damage). With a hit that deals 13.2 and 10% lifesteal, the heal is 1.32 exactly; floating
  point error is not acceptable.
- Lifesteal never changes the damage dealt or the damage taken.
- Matching follows the same rules as bonus damage: a source whose condition fails is absent, a
  `Contribution` that is not a stat joins the same sum, other families stay out, there is no cap
  (over 100% heals more than the damage), and each hit is judged alone.

Update the class Javadoc and the `apply` Javadoc to say what the heal now is.
