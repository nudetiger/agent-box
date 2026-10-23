package me.rakkoon69.rakunloots.wiki;

import me.rakkoon69.rakunloots.config.*;
import me.rakkoon69.rakunloots.server.TaskHandle;
import me.rakkoon69.rakunloots.server.TaskScheduler;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** Jobs are deliberately held, then completed out of order, just as reload can overlap old work. */
class Phase9ChanceCacheAcceptanceTest {
    private static ConfigSnapshot config(int secondWeight) {
        var snapshot = ConfigLoader.load(ConfigSources.builder().globals("language: en\n")
            .worlds("{}\n").language("en","text: test\n")
            .loot("demo","open_mode: drop\nblock: barrel\nroll:\n  min: 1\n  max: 1\n  entries:\n    a:\n      item: {id: diamond}\n      weight: 1\n    b:\n      item: {id: emerald}\n      weight: "+secondWeight+"\n")
            .build(),id->Optional.of(id));
        assertTrue(snapshot.loot("demo").isPresent(),"fixture loot demo must load");
        return snapshot;
    }
    @Test void chanceWorkWaitsForTheAsyncSchedulerRatherThanPageReads() {
        var scheduler=new HeldScheduler();
        var cache=new LootChanceCache(scheduler);
        var snapshot=config(1);
        cache.load(snapshot);
        assertEquals(1,scheduler.jobs.size());
        assertTrue(cache.chances(snapshot,"demo").isEmpty());
        assertTrue(cache.chances(snapshot,"demo").isEmpty());
        assertEquals(1,scheduler.jobs.size(),"reading does not enqueue more computation");
        scheduler.jobs.removeFirst().run();
        assertEquals(0.5,cache.chances(snapshot,"demo").orElseThrow().get("a").probability(),1e-9);
    }
    @Test void anOldJobFinishingLastCannotPublishForTheNewSnapshot() {
        var scheduler=new HeldScheduler();
        var cache=new LootChanceCache(scheduler);
        var old=config(1);
        var current=config(3);
        cache.load(old);
        cache.load(current);
        assertTrue(cache.chances(current,"demo").isEmpty());
        scheduler.jobs.removeLast().run();
        assertEquals(0.25,cache.chances(current,"demo").orElseThrow().get("a").probability(),1e-9);
        scheduler.jobs.removeFirst().run();
        assertEquals(0.25,cache.chances(current,"demo").orElseThrow().get("a").probability(),1e-9);
        assertTrue(cache.chances(old,"demo").isEmpty());
    }
    private static class HeldScheduler implements TaskScheduler {
        final Deque<Runnable> jobs=new ArrayDeque<>();
        // Each held body represents work already started on another thread and paused before computation.
        // TaskHandle.cancel explicitly lets an already-started run finish, so cancellation cannot hide this race.
        @Override public TaskHandle run(Runnable job) { jobs.addLast(job); return ()->{}; }
        @Override public TaskHandle runLater(Runnable job,long ticks) { throw new AssertionError("unexpected delayed chance job"); }
        @Override public TaskHandle repeat(Runnable job,long delay,long period) { throw new AssertionError("unexpected repeating chance job"); }
    }
}
