package me.rakkoon69.rakunminiitems.stat;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static me.rakkoon69.rakunminiitems.stat.StatDefinition.Condition.ALWAYS;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static me.rakkoon69.rakunminiitems.stat.StatDefinition.Condition.ANIMAL;
import static me.rakkoon69.rakunminiitems.stat.StatDefinition.Condition.UNDEAD;
import static me.rakkoon69.rakunminiitems.stat.StatDefinition.Family.BONUS_DAMAGE;
import static me.rakkoon69.rakunminiitems.stat.StatDefinition.Family.LIFESTEAL;
import static me.rakkoon69.rakunminiitems.stat.StatDefinition.Scale.FLAT;
import static me.rakkoon69.rakunminiitems.stat.StatDefinition.Scale.PERCENT;

/**
 * The stat session. Definitions, file texts, holder amounts, and one hit in. Warnings, registration records, and
 * the hit out. No server.
 */
class StatSessionTest {

    @Test
    void anEmptyStatsFolderLoadsWithNothingRegisteredAndNoWarning() {
        StatSession session = StatSession.open(List.of(), Map.of());

        assertEquals(List.of(), session.warnings());
        assertEquals(List.of(), session.registrations());
    }

    @Test
    void aLaterLoadOfAnEmptyFolderStillRegistersNothingAndWarnsNothing() {
        StatSession session = StatSession.open(List.of(), Map.of());

        session.reload(Map.of());

        assertEquals(List.of(), session.registrations());
        assertEquals(List.of(), session.warnings());
    }

    @Test
    void aHitWithNoSourceKeepsDamageDealtDamageTakenAndAddsNoHeal() {
        StatSession session = StatSession.open(List.of(), Map.of());

        AppliedHit hit = session.apply(HolderAmounts.none(), Hit.of(6.5));

        assertEquals(6.5, hit.damageDealt(), 0.0);
        assertEquals(6.5, hit.damageTaken(), 0.0);
        assertEquals(0.0, hit.heal(), 0.0);
    }

    @Test
    void aSecondHitIsJudgedAlone() {
        StatSession session = StatSession.open(List.of(), Map.of());

        AppliedHit first = session.apply(HolderAmounts.none(), Hit.of(4.0));
        AppliedHit second = session.apply(HolderAmounts.none(), Hit.of(11.0));

        assertEquals(4.0, first.damageDealt(), 0.0);
        assertEquals(4.0, first.damageTaken(), 0.0);
        assertEquals(0.0, first.heal(), 0.0);
        assertEquals(11.0, second.damageDealt(), 0.0);
        assertEquals(11.0, second.damageTaken(), 0.0);
        assertEquals(0.0, second.heal(), 0.0);
    }

    @Test
    void aStoredAmountAgainstAnAnimalLeavesTheHitAsItWas() {
        StatSession session = StatSession.open(List.of(), Map.of());

        AppliedHit hit = session.apply(
                HolderAmounts.of(Map.of("ANIMALS_BONUS_DAMAGE", 10.0)),
                Hit.againstAnimal(2.0));

        assertEquals(2.0, hit.damageDealt(), 0.0);
        assertEquals(2.0, hit.damageTaken(), 0.0);
        assertEquals(0.0, hit.heal(), 0.0);
        assertEquals(List.of(), session.registrations());
        assertEquals(List.of(), session.warnings());
    }

    @Test
    void anAnimalHitOfTwoWithFlatTenAndPercentTenDealsThirteenPointTwo() {
        StatSession session = StatSession.open(List.of(animalsBonusFlat(), animalsBonusPercent()), Map.of());

        AppliedHit hit = session.apply(
                HolderAmounts.of(Map.of("ANIMALS_BONUS_DAMAGE", 10.0, "ANIMALS_BONUS_DAMAGE_PERCENTAGE", 10.0)),
                Hit.againstAnimal(2.0));

        assertEquals(13.2, hit.damageDealt(), 0.0);
        assertEquals(13.2, hit.damageTaken(), 0.0);
        assertEquals(0.0, hit.heal(), 0.0);
    }

    @Test
    void twoFlatsAddBeforeTwoPercentsBecomeOneFactor() {
        StatSession session = StatSession.open(List.of(
                bonus("FLAT_A", FLAT, ANIMAL),
                bonus("FLAT_B", FLAT, ANIMAL),
                bonus("PERCENT_A", PERCENT, ANIMAL),
                bonus("PERCENT_B", PERCENT, ANIMAL)), Map.of());

        AppliedHit hit = session.apply(
                HolderAmounts.of(Map.of("FLAT_A", 10.0, "FLAT_B", 10.0, "PERCENT_A", 10.0, "PERCENT_B", 10.0)),
                Hit.againstAnimal(2.0));

        assertEquals(26.4, hit.damageDealt(), 0.0);
        assertEquals(26.4, hit.damageTaken(), 0.0);
        assertEquals(0.0, hit.heal(), 0.0);
    }

    @Test
    void percentsAboveOneHundredStayInTheFactor() {
        StatSession session = StatSession.open(List.of(
                bonus("FLAT", FLAT, ANIMAL),
                bonus("PERCENT_A", PERCENT, ANIMAL),
                bonus("PERCENT_B", PERCENT, ANIMAL)), Map.of());

        AppliedHit hit = session.apply(
                HolderAmounts.of(Map.of("FLAT", 10.0, "PERCENT_A", 150.0, "PERCENT_B", 50.0)),
                Hit.againstAnimal(2.0));

        assertEquals(36.0, hit.damageDealt(), 0.0);
        assertEquals(36.0, hit.damageTaken(), 0.0);
        assertEquals(0.0, hit.heal(), 0.0);
    }

    @Test
    void aMatchingFlatOfZeroStillLetsThePercentApply() {
        StatSession session = StatSession.open(List.of(animalsBonusFlat(), animalsBonusPercent()), Map.of());

        AppliedHit hit = session.apply(
                HolderAmounts.of(Map.of("ANIMALS_BONUS_DAMAGE", 0.0, "ANIMALS_BONUS_DAMAGE_PERCENTAGE", 10.0)),
                Hit.againstAnimal(2.0));

        assertEquals(2.2, hit.damageDealt(), 0.0);
        assertEquals(2.2, hit.damageTaken(), 0.0);
        assertEquals(0.0, hit.heal(), 0.0);
    }

    @Test
    void aBonusDamageSourceWhoseConditionFailsIsAbsent() {
        StatSession session = StatSession.open(List.of(
                animalsBonusFlat(),
                bonus("NOT_AN_ANIMAL", PERCENT, UNDEAD)), Map.of());

        AppliedHit hit = session.apply(
                HolderAmounts.of(Map.of("ANIMALS_BONUS_DAMAGE", 10.0, "NOT_AN_ANIMAL", 80.0)),
                Hit.againstAnimal(2.0));

        assertEquals(12.0, hit.damageDealt(), 0.0);
        assertEquals(12.0, hit.damageTaken(), 0.0);
        assertEquals(0.0, hit.heal(), 0.0);
    }

    @Test
    void aVillagerAnIronGolemAndAPillagerTakeNoAnimalsBonusDamage() {
        StatSession session = StatSession.open(List.of(animalsBonusFlat(), animalsBonusPercent()), Map.of());
        HolderAmounts amounts = HolderAmounts.of(Map.of(
                "ANIMALS_BONUS_DAMAGE", 10.0,
                "ANIMALS_BONUS_DAMAGE_PERCENTAGE", 10.0));

        AppliedHit villager = session.apply(amounts, Hit.of(2.0));
        AppliedHit ironGolem = session.apply(amounts, Hit.of(2.0));
        AppliedHit pillager = session.apply(amounts, Hit.of(2.0));

        assertEquals(2.0, villager.damageDealt(), 0.0);
        assertEquals(2.0, villager.damageTaken(), 0.0);
        assertEquals(0.0, villager.heal(), 0.0);
        assertEquals(2.0, ironGolem.damageDealt(), 0.0);
        assertEquals(2.0, ironGolem.damageTaken(), 0.0);
        assertEquals(0.0, ironGolem.heal(), 0.0);
        assertEquals(2.0, pillager.damageDealt(), 0.0);
        assertEquals(2.0, pillager.damageTaken(), 0.0);
        assertEquals(0.0, pillager.heal(), 0.0);
    }

    @Test
    void anUndeadTakesNoAnimalsBonusDamage() {
        StatSession session = StatSession.open(List.of(animalsBonusFlat(), animalsBonusPercent()), Map.of());

        AppliedHit hit = session.apply(
                HolderAmounts.of(Map.of(
                        "ANIMALS_BONUS_DAMAGE", 10.0,
                        "ANIMALS_BONUS_DAMAGE_PERCENTAGE", 10.0)),
                Hit.againstUndead(2.0));

        assertEquals(2.0, hit.damageDealt(), 0.0);
        assertEquals(2.0, hit.damageTaken(), 0.0);
        assertEquals(0.0, hit.heal(), 0.0);
    }

    @Test
    void anUndeadConditionCountsOnlyAgainstAnUndead() {
        StatSession session = StatSession.open(List.of(), Map.of());
        List<Contribution> undeadPercent = List.of(Contribution.of(BONUS_DAMAGE, PERCENT, UNDEAD, 10.0));

        AppliedHit undead = session.apply(HolderAmounts.none(), undeadPercent, Hit.againstUndead(2.0));
        AppliedHit animal = session.apply(HolderAmounts.none(), undeadPercent, Hit.againstAnimal(2.0));
        AppliedHit villager = session.apply(HolderAmounts.none(), undeadPercent, Hit.of(2.0));

        assertEquals(2.2, undead.damageDealt(), 0.0);
        assertEquals(2.2, undead.damageTaken(), 0.0);
        assertEquals(0.0, undead.heal(), 0.0);
        assertEquals(2.0, animal.damageDealt(), 0.0);
        assertEquals(2.0, villager.damageDealt(), 0.0);
    }

    @Test
    void theNextAnimalHitStartsOver() {
        StatSession session = StatSession.open(List.of(animalsBonusFlat(), animalsBonusPercent()), Map.of());
        HolderAmounts amounts = HolderAmounts.of(Map.of(
                "ANIMALS_BONUS_DAMAGE", 10.0,
                "ANIMALS_BONUS_DAMAGE_PERCENTAGE", 10.0));

        AppliedHit first = session.apply(amounts, Hit.againstAnimal(2.0));
        AppliedHit second = session.apply(HolderAmounts.none(), Hit.againstAnimal(2.0));
        AppliedHit third = session.apply(amounts, Hit.againstAnimal(2.0));

        assertEquals(13.2, first.damageDealt(), 0.0);
        assertEquals(13.2, first.damageTaken(), 0.0);
        assertEquals(0.0, first.heal(), 0.0);
        assertEquals(2.0, second.damageDealt(), 0.0);
        assertEquals(2.0, second.damageTaken(), 0.0);
        assertEquals(0.0, second.heal(), 0.0);
        assertEquals(13.2, third.damageDealt(), 0.0);
        assertEquals(13.2, third.damageTaken(), 0.0);
        assertEquals(0.0, third.heal(), 0.0);
    }

    @Test
    void aSourceThatIsNotAStatJoinsTheSameBonusDamageSum() {
        StatSession session = StatSession.open(List.of(animalsBonusFlat()), Map.of());

        AppliedHit hit = session.apply(
                HolderAmounts.of(Map.of("ANIMALS_BONUS_DAMAGE", 10.0)),
                List.of(
                        Contribution.of(BONUS_DAMAGE, PERCENT, ANIMAL, 10.0),
                        Contribution.of(BONUS_DAMAGE, FLAT, UNDEAD, 50.0)),
                Hit.againstAnimal(2.0));

        assertEquals(13.2, hit.damageDealt(), 0.0);
        assertEquals(13.2, hit.damageTaken(), 0.0);
        assertEquals(0.0, hit.heal(), 0.0);
    }

    @Test
    void tenPercentLifestealHealsOnePointThreeTwoOfTheDamageDealt() {
        StatSession session = StatSession.open(List.of(animalsBonusFlat(), animalsBonusPercent()), Map.of());

        AppliedHit hit = session.apply(
                HolderAmounts.of(Map.of(
                        "ANIMALS_BONUS_DAMAGE", 10.0,
                        "ANIMALS_BONUS_DAMAGE_PERCENTAGE", 10.0)),
                List.of(Contribution.of(LIFESTEAL, PERCENT, ALWAYS, 10.0)),
                Hit.againstAnimal(2.0));

        assertEquals(13.2, hit.damageDealt(), 0.0);
        assertEquals(13.2, hit.damageTaken(), 0.0);
        assertEquals(1.32, hit.heal(), 0.0);
    }

    @Test
    void fivePercentAndFivePercentHealTenPercentOfTheDamageDealt() {
        StatSession session = StatSession.open(List.of(
                lifesteal("LIFESTEAL", ALWAYS),
                lifesteal("SECOND", ALWAYS)), Map.of());

        AppliedHit hit = session.apply(
                HolderAmounts.of(Map.of("LIFESTEAL", 5.0, "SECOND", 5.0)),
                Hit.of(40.0));

        assertEquals(40.0, hit.damageDealt(), 0.0);
        assertEquals(40.0, hit.damageTaken(), 0.0);
        assertEquals(4.0, hit.heal(), 0.0);
    }

    @Test
    void lifestealAndUndeadMobsLifestealHealTenPercentOnlyAgainstAnUndead() {
        StatSession session = StatSession.open(List.of(
                lifesteal("LIFESTEAL", ALWAYS),
                lifesteal("UNDEAD_MOBS_LIFESTEAL", UNDEAD)), Map.of());
        HolderAmounts amounts = HolderAmounts.of(Map.of(
                "LIFESTEAL", 5.0,
                "UNDEAD_MOBS_LIFESTEAL", 5.0));

        AppliedHit undead = session.apply(amounts, Hit.againstUndead(40.0));
        AppliedHit animal = session.apply(amounts, Hit.againstAnimal(40.0));
        AppliedHit villager = session.apply(amounts, Hit.of(40.0));

        assertEquals(40.0, undead.damageDealt(), 0.0);
        assertEquals(40.0, undead.damageTaken(), 0.0);
        assertEquals(4.0, undead.heal(), 0.0);
        assertEquals(40.0, animal.damageDealt(), 0.0);
        assertEquals(2.0, animal.heal(), 0.0);
        assertEquals(40.0, villager.damageDealt(), 0.0);
        assertEquals(2.0, villager.heal(), 0.0);
    }

    @Test
    void aHitWithNoBonusDamageHealsFromThatDamageDealt() {
        StatSession session = StatSession.open(List.of(lifesteal("LIFESTEAL", ALWAYS)), Map.of());

        AppliedHit hit = session.apply(HolderAmounts.of(Map.of("LIFESTEAL", 10.0)), Hit.of(20.0));

        assertEquals(20.0, hit.damageDealt(), 0.0);
        assertEquals(20.0, hit.damageTaken(), 0.0);
        assertEquals(2.0, hit.heal(), 0.0);
    }

    @Test
    void aLifestealSourceThatIsNotAStatJoinsTheSamePercent() {
        StatSession session = StatSession.open(List.of(lifesteal("LIFESTEAL", ALWAYS)), Map.of());

        AppliedHit hit = session.apply(
                HolderAmounts.of(Map.of("LIFESTEAL", 5.0)),
                List.of(Contribution.of(LIFESTEAL, PERCENT, ALWAYS, 5.0)),
                Hit.of(40.0));

        assertEquals(40.0, hit.damageDealt(), 0.0);
        assertEquals(40.0, hit.damageTaken(), 0.0);
        assertEquals(4.0, hit.heal(), 0.0);
    }

    @Test
    void aLifestealSourceWhoseConditionFailsIsAbsent() {
        StatSession session = StatSession.open(List.of(
                lifesteal("LIFESTEAL", ALWAYS),
                lifesteal("UNDEAD_MOBS_LIFESTEAL", UNDEAD)), Map.of());

        AppliedHit hit = session.apply(
                HolderAmounts.of(Map.of("LIFESTEAL", 5.0, "UNDEAD_MOBS_LIFESTEAL", 80.0)),
                List.of(Contribution.of(LIFESTEAL, PERCENT, UNDEAD, 50.0)),
                Hit.of(40.0));

        assertEquals(40.0, hit.damageDealt(), 0.0);
        assertEquals(40.0, hit.damageTaken(), 0.0);
        assertEquals(2.0, hit.heal(), 0.0);
    }

    @Test
    void lifestealPercentsAboveOneHundredHealInFull() {
        StatSession session = StatSession.open(List.of(
                lifesteal("LIFESTEAL", ALWAYS),
                lifesteal("SECOND", ALWAYS)), Map.of());

        AppliedHit hit = session.apply(
                HolderAmounts.of(Map.of("LIFESTEAL", 150.0, "SECOND", 50.0)),
                Hit.of(10.0));

        assertEquals(10.0, hit.damageDealt(), 0.0);
        assertEquals(10.0, hit.damageTaken(), 0.0);
        assertEquals(20.0, hit.heal(), 0.0);
    }

    @Test
    void theNextHitStartsLifestealOver() {
        StatSession session = StatSession.open(List.of(lifesteal("LIFESTEAL", ALWAYS)), Map.of());
        HolderAmounts amounts = HolderAmounts.of(Map.of("LIFESTEAL", 10.0));

        AppliedHit first = session.apply(amounts, Hit.of(10.0));
        AppliedHit second = session.apply(HolderAmounts.none(), Hit.of(10.0));
        AppliedHit third = session.apply(amounts, Hit.of(40.0));

        assertEquals(10.0, first.damageDealt(), 0.0);
        assertEquals(1.0, first.heal(), 0.0);
        assertEquals(10.0, second.damageDealt(), 0.0);
        assertEquals(0.0, second.heal(), 0.0);
        assertEquals(40.0, third.damageDealt(), 0.0);
        assertEquals(4.0, third.heal(), 0.0);
    }

    private static StatDefinition bonus(String id, StatDefinition.Scale scale, StatDefinition.Condition condition) {
        return new StatDefinition(id, id, BONUS_DAMAGE, scale, condition, id, "COOKED_BEEF", Map.of());
    }

    private static StatDefinition animalsBonusFlat() {
        return new StatDefinition(
                "ANIMALS_BONUS_DAMAGE",
                "Animals Bonus Damage",
                BONUS_DAMAGE,
                FLAT,
                ANIMAL,
                "Animals Bonus Damage",
                "COOKED_BEEF",
                Map.of());
    }

    private static StatDefinition animalsBonusPercent() {
        return new StatDefinition(
                "ANIMALS_BONUS_DAMAGE_PERCENTAGE",
                "Animals Bonus Damage Percentage",
                BONUS_DAMAGE,
                PERCENT,
                ANIMAL,
                "Animals Bonus Damage",
                "COOKED_BEEF",
                Map.of());
    }

    private static StatDefinition lifesteal(String id, StatDefinition.Condition condition) {
        return new StatDefinition(id, id, LIFESTEAL, PERCENT, condition, id, "REDSTONE", Map.of());
    }
}
