package me.rakkoon69.rakunloots.claim;

import be.seeseemelk.mockbukkit.MockBukkit;
import me.rakkoon69.rakunloots.config.*;
import me.rakkoon69.rakunloots.storage.*;
import me.rakkoon69.rakunloots.summon.FakeServerAdapter;
import org.bukkit.Material;
import org.bukkit.inventory.ItemStack;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.Path;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** The single-row claim crosses the same SQLite and inventory boundary as a full claim. */
@Timeout(10)
class Phase9SingleClaimAcceptanceTest {
    @TempDir Path folder;
    private final List<String> failures=new ArrayList<>();
    private LootBoxStore store;
    private FakeServerAdapter adapter;
    private ConfigSnapshot config;
    private UnclaimedSummonItems claims;
    private UUID player;

    @BeforeEach void start() throws Exception {
        StreamableServerMock.mock();
        player=UUID.randomUUID();
        adapter=new FakeServerAdapter(UUID.randomUUID());
        adapter.addOnlinePlayer(player);
        store=SqliteStores.open(folder);
        // Only known vanilla ids occur in this storage/give fixture.
        config=ConfigLoader.load(ConfigSources.builder().globals("language: en\n")
            .worlds("{}\n").language("en","claim_given: 'given {loot} {amount}'\nclaim_kept: 'kept {loot} {amount}'\nclaim_loot_missing: 'missing {loot}'\n")
            .loot("one", "display_name: One\nopen_mode: drop\nblock: barrel\nroll:\n  entries:\n    a:\n      item:\n        id: diamond\n")
            .loot("two", "display_name: Two\nopen_mode: drop\nblock: barrel\nroll:\n  entries:\n    a:\n      item:\n        id: diamond\n")
            .build(), id -> Optional.of(id));
        assertTrue(config.loot("one").isPresent(),"fixture loot one must load");
        assertTrue(config.loot("two").isPresent(),"fixture loot two must load");
        claims=new UnclaimedSummonItems(adapter,()->config,store,
            loot -> new ItemStack(Material.COMPASS),
            (what,cause)->failures.add(what+": "+cause));
    }
    @AfterEach void stop() throws Exception { store.close(); MockBukkit.unmock(); assertTrue(failures.isEmpty(),failures.toString()); }

    @Test void readingPreservesStoredOrderAndMissingRowsWithoutChangingThem() throws Exception {
        store.addUnclaimedSummonItems(player,"two",3);
        store.addUnclaimedSummonItems(player,"gone",4);
        store.addUnclaimedSummonItems(player,"one",5);
        var before=store.unclaimedSummonItems(player,config);
        assertEquals(before,claims.owed(player).get());
        assertTrue(before.stream().anyMatch(row->row.lootId().equals("gone") && row.lootMissing()));
        assertEquals(before,store.unclaimedSummonItems(player,config));
    }
    @Test void takingOneLootLeavesEveryOtherRowAndCommitsBeforeGiving() throws Exception {
        store.addUnclaimedSummonItems(player,"one",5);
        store.addUnclaimedSummonItems(player,"two",7);
        List<List<UnclaimedSummonItem>> atGive=new ArrayList<>();
        adapter.onGive(()->{
            try { atGive.add(store.unclaimedSummonItems(player,config)); }
            catch(Exception error) { throw new AssertionError(error); }
        });
        var result=claims.claim(player,"one").get();
        assertEquals(5,result.given());
        assertEquals(List.of(new UnclaimedSummonItem("two",7,false)),atGive.get(0));
        assertEquals(atGive.get(0),claims.owed(player).get());
        assertEquals(5,adapter.inventoryOf(player).count(new ItemStack(Material.COMPASS)));
    }
    @Test void aMissingLootCannotBeTakenAndStaysOwed() throws Exception {
        store.addUnclaimedSummonItems(player,"gone",9);
        claims.claim(player,"gone").get();
        assertEquals(List.of(new UnclaimedSummonItem("gone",9,true)),claims.owed(player).get());
        assertEquals(0,adapter.inventoryOf(player).count(new ItemStack(Material.COMPASS)));
    }
}
