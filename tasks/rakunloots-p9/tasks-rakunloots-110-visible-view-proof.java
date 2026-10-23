package me.rakkoon69.rakunloots.claim;
import be.seeseemelk.mockbukkit.MockBukkit;
import me.rakkoon69.rakunloots.items.ItemSourceRegistry;
import me.rakkoon69.rakunloots.menu.*;
import me.rakkoon69.rakunloots.server.ServerAdapter;
import me.rakkoon69.rakunloots.storage.*;
import me.rakkoon69.rakunloots.summon.FakeServerAdapter;
import me.rakkoon69.rakunloots.summonitem.SummonItemMaker;
import org.bukkit.Material;
import org.bukkit.inventory.ItemStack;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import static org.junit.jupiter.api.Assertions.*;
class Phase9ClaimVisibleViewProofTest {
 @TempDir Path folder;
 @Test void aClickOnTheStillVisibleOldRowCannotClaimADifferentLoot() throws Exception {
  StreamableServerMock.mock();
  var delegate=new FakeServerAdapter(UUID.randomUUID()); var player=UUID.randomUUID(); delegate.addOnlinePlayer(player);
  var store=SqliteStores.open(folder); var pending=new ArrayList<Runnable>(); var hold=new AtomicBoolean();
  try {
   var config=Phase9ClaimLanguageSnapshotProofTest.snapshot("NEXT");
   ServerAdapter adapter=(ServerAdapter)java.lang.reflect.Proxy.newProxyInstance(ServerAdapter.class.getClassLoader(),new Class<?>[]{ServerAdapter.class},(proxy,method,args)->{
    if(method.getName().equals("updateMenu") && hold.compareAndSet(true,false)) {
     var result=new CompletableFuture<Void>();
     // A physical update submitted from async is still waiting on the player/main thread.
     pending.add(()->{try {((CompletableFuture<?>)method.invoke(delegate,args)).whenComplete((value,error)->{if(error==null)result.complete(null);else result.completeExceptionally(error);});}catch(Exception error){result.completeExceptionally(error);}});
     return result;
    }
    try{return method.invoke(delegate,args);}catch(java.lang.reflect.InvocationTargetException error){throw error.getCause();}
   });
   store.addUnclaimedSummonItems(player,"loot0",2); store.addUnclaimedSummonItems(player,"loot1",3);
   var sources=ItemSourceRegistry.create(); var maker=new SummonItemMaker(sources); var failures=new ArrayList<String>();
   var claims=new UnclaimedSummonItems(adapter,()->config,store,maker,(what,cause)->failures.add(what));
   var renderer=new MenuRenderer(sources,key->config.message("",key),MenuWarnings.ignore); var menus=new MenuService(adapter,renderer);
   var menu=new ClaimMenu(adapter,()->config,claims,maker,menus,renderer,(what,cause)->failures.add(what));
   menu.open(player,()->fail("owed rows must open")); delegate.globalScheduler().stepTicks(3);
   assertTrue(delegate.menuOpens().get(0).contents().get(0).getItemMeta().getDisplayName().contains("loot0"));
   hold.set(true); menus.click(player,0).join(); delegate.globalScheduler().stepTicks(3);
   assertEquals(1,pending.size()); assertTrue(delegate.menuUpdates().isEmpty(),"the player still sees loot0, not loot1");
   menus.click(player,0).join(); delegate.globalScheduler().stepTicks(3);
   assertEquals(2,delegate.inventoryOf(player).countOfType(Material.NETHER_STAR),"clicking visible loot0 must not take loot1");
   assertEquals(List.of(new UnclaimedSummonItem("loot1",3,false)),store.unclaimedSummonItems(player,config));
   assertTrue(failures.isEmpty(),failures.toString());
  } finally { List.copyOf(pending).forEach(Runnable::run); store.close(); MockBukkit.unmock(); }
 }
 @Test void aDeferredClickCannotRunTheNewIconActionAfterAnInPlaceRefresh() {
  StreamableServerMock.mock();
  try {
   var adapter=new FakeServerAdapter(UUID.randomUUID()); var player=UUID.randomUUID(); adapter.addOnlinePlayer(player);
   var menus=new MenuService(adapter); var oldClicks=new AtomicInteger(); var newClicks=new AtomicInteger();
   var before=new MenuView("Before",1,Map.of(0,new MenuIcon(new ItemStack(Material.DIAMOND),Optional.of(oldClicks::incrementAndGet),Optional.empty())));
   var after=new MenuView("After",1,Map.of(0,new MenuIcon(new ItemStack(Material.EMERALD),Optional.of(newClicks::incrementAndGet),Optional.empty())));
   menus.open(player,before).join();
   menus.clickLater(player,0).join(); assertEquals(0,oldClicks.get()); assertEquals(0,newClicks.get());
   menus.refresh(player,after).join(); adapter.runNextTickActions();
   assertEquals(0,newClicks.get(),"a click received for the old visible icon must not run the replacement action");
  } finally {MockBukkit.unmock();}
 }
}