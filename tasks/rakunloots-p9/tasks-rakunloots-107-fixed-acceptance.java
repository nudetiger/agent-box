package me.rakkoon69.rakunloots.roll;

import me.rakkoon69.rakunloots.config.*;
import me.rakkoon69.rakunloots.lootbox.MessageText;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** Independent issue #107 acceptance: oracle enumerates every weighted draw order. */
class Phase9ChanceAcceptanceTest {
    private static Roll roll(int min, int max, int... weights) {
        StringBuilder yaml = new StringBuilder("language: en\nblock: barrel\nopen_mode: drop\nroll:\n  min: " + min + "\n  max: " + max + "\n  entries:\n");
        for (int i=0; i<weights.length; i++) yaml.append("    e").append(i).append(":\n      weight: ").append(weights[i]).append("\n      item:\n        id: diamond\n");
        return ConfigLoader.load(ConfigSources.builder().globals("language: en\n").language("en", "text: test\n").loot("demo", yaml.toString()).build(), written -> Optional.of(written)).loot("demo").orElseThrow().roll();
    }
    private static void enumerate(int[] w, boolean[] picked, int remaining, double probability, double[] result) {
        if (remaining==0) { for (int i=0;i<w.length;i++) if(picked[i]) result[i]+=probability; return; }
        long total=0; for(int i=0;i<w.length;i++) if(!picked[i] && w[i]>0) total+=w[i];
        if(total==0) { enumerate(w,picked,0,probability,result); return; }
        for(int i=0;i<w.length;i++) if(!picked[i] && w[i]>0) { picked[i]=true; enumerate(w,picked,remaining-1,probability*w[i]/total,result); picked[i]=false; }
    }
    @Test void probabilitiesMatchEveryDrawOrder() {
        int[][] cases={{1,2,3},{1,1000,3,7},{1,1000000,4},{1,1,1,1,1,1,1}};
        int[][] ranges={{0,1},{1,1},{1,3},{0,10},{2,5},{3,2},{8,9},{0,0}};
        for(int[] weights:cases) for(int[] range:ranges) {
            // Use the loaded roll's corrected min/max, as the player-facing config loader does.
            Roll r=roll(range[0],range[1],weights);
            double[] expected=new double[weights.length];
            int min=Math.max(0,r.min()), max=Math.max(0,r.max()); if(min>=max) min=max;
            for(int k=min;k<=max;k++) enumerate(weights,new boolean[weights.length],Math.min(k,weights.length),1.0/(max-min+1),expected);
            Map<String,LootChance.EntryChance> actual=LootChance.calculate(r);
            for(int i=0;i<weights.length;i++) assertEquals(expected[i],actual.get("e"+i).probability(),1e-9,Arrays.toString(weights)+" "+Arrays.toString(range)+" entry "+i);
        }
    }
    @Test void exactEdgesAndSpecialEntries() {
        assertEquals(0.5,LootChance.calculate(roll(0,1,1)).get("e0").probability());
        assertEquals(1.0,LootChance.calculate(roll(8,9,1,2)).get("e0").probability());
        assertEquals(0.0,LootChance.calculate(roll(0,0,1,2)).get("e1").probability());
        var special=LootChance.calculate(RawRollFixture.roll(1,1,-1,0,2));
        assertEquals(LootChance.Kind.ALWAYS,special.get("e0").kind());
        assertEquals(LootChance.Kind.HIDDEN,special.get("e1").kind());
        for(var entry:LootChance.calculate(roll(2,2,1,1,1,1,1)).values()) assertEquals(0.4,entry.probability(),1e-12);
    }
    @Test void timerEligibilityAndTotalMatchWorldTimer() {
        var weights=Map.of("airdrops",100,"treasure_chest",30,"buried_stash",30,"head_trophy",20,"deep_vault",10,"missing",500,"zero",0,"negative",-5);
        var actual=TimerChance.calculate(weights,Set.of("airdrops","treasure_chest","buried_stash","head_trophy","deep_vault","zero","negative"));
        assertEquals(5,actual.size()); assertEquals(100.0/190,actual.get("airdrops"));
    }
    @Test void percentValuesPreserveRareAndUncertainChances() {
        var config=ConfigLoader.load(ConfigSources.builder().globals("language: en\n").language("en","percent: '{chance}|{chance:2}|{chance:0}|{chance:6}|{label}'\n").build(), written -> Optional.of(written));
        assertEquals("<0.1|<0.01|<1|0.004000|ok",MessageText.render(config,"demo","percent",Map.of("label","ok"),Map.of("chance",0.00004)));
        assertEquals("99.9|99.99|99|99.996000|ok",MessageText.render(config,"demo","percent",Map.of("label","ok"),Map.of("chance",0.99996)));
        assertEquals("0.0|0.00|0|0.000000|ok",MessageText.render(config,"demo","percent",Map.of("label","ok"),Map.of("chance",0.0)));
        assertEquals("100.0|100.00|100|100.000000|ok",MessageText.render(config,"demo","percent",Map.of("label","ok"),Map.of("chance",1.0)));
        assertEquals("12.5|12.50|13|12.500000|ok",MessageText.render(config,"demo","percent",Map.of("label","ok"),Map.of("chance",0.125)));
    }
}
