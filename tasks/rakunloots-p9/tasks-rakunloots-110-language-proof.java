package me.rakkoon69.rakunloots.claim;
import be.seeseemelk.mockbukkit.MockBukkit;
import me.rakkoon69.rakunloots.config.*;
import me.rakkoon69.rakunloots.items.ItemSourceRegistry;
import me.rakkoon69.rakunloots.menu.*;
import me.rakkoon69.rakunloots.storage.*;
import me.rakkoon69.rakunloots.summon.FakeServerAdapter;
import org.bukkit.Material;
import org.bukkit.inventory.ItemStack;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.Path;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.*;
import static org.junit.jupiter.api.Assertions.*;
class Phase9ClaimLanguageSnapshotProofTest {
 @TempDir Path folder;
 @Test void pageLabelsUseTheSameSnapshotAsTheRowsWhenReloadInstallsNewConfigDuringRender() throws Exception {
  StreamableServerMock.mock();
  var adapter=new FakeServerAdapter(UUID.randomUUID()); var player=UUID.randomUUID(); adapter.addOnlinePlayer(player);
  var store=SqliteStores.open(folder);
  try {
   var original=snapshot("OLD_NEXT"); var reloaded=snapshot("NEW_NEXT"); var config=new AtomicReference<>(original);
   for(int i=0;i<46;i++) store.addUnclaimedSummonItems(player,"loot"+i,1);
   var failures=new ArrayList<String>(); var changed=new AtomicBoolean();
   SummonItemFactory realMaker=new me.rakkoon69.rakunloots.summonitem.SummonItemMaker(ItemSourceRegistry.create());
   SummonItemFactory maker=loot->{if(changed.compareAndSet(false,true)) config.set(reloaded); return realMaker.create(loot);};
   var claims=new UnclaimedSummonItems(adapter,config::get,store,maker,(what,cause)->failures.add(what));
   var renderer=new MenuRenderer(ItemSourceRegistry.create(),key->config.get().message("",key),MenuWarnings.ignore);
   var menus=new MenuService(adapter,renderer);
   var menu=new ClaimMenu(adapter,config::get,claims,maker,menus,renderer,(what,cause)->failures.add(what));
   // A reload installs the new config before its later module updates close menus. This interleaving changes
   // that field during item rendering, before the service generation is turned over by menus.reload.
   menu.open(player,()->fail("owed rows must open"));
   adapter.globalScheduler().stepTicks(3);
   assertEquals(1,adapter.menuOpens().size());
   var next=adapter.menuOpens().get(0).contents().get(53);
   assertEquals("OLD_NEXT",next.getItemMeta().getDisplayName(),"one operation must use one config for rows AND paging labels");
   assertTrue(failures.isEmpty(),failures.toString());
  } finally {store.close(); MockBukkit.unmock();}
 }
 @Test void anOlderQueuedRefreshCannotOverwriteANewerPageTurn() throws Exception {
  StreamableServerMock.mock();
  var delegate=new FakeServerAdapter(UUID.randomUUID()); var player=UUID.randomUUID(); delegate.addOnlinePlayer(player);
  var store=SqliteStores.open(folder);
  try {
   var config=snapshot("NEXT",47); var pending=new ArrayList<Runnable>(); var holdNext=new AtomicBoolean();
   // Paper updates called from async queue on main; a later update already on main runs immediately.
   // This adapter seam holds the first physical update and permits the later owner's update to finish first.
   me.rakkoon69.rakunloots.server.ServerAdapter adapter=(me.rakkoon69.rakunloots.server.ServerAdapter)java.lang.reflect.Proxy.newProxyInstance(
    me.rakkoon69.rakunloots.server.ServerAdapter.class.getClassLoader(),new Class<?>[]{me.rakkoon69.rakunloots.server.ServerAdapter.class},(proxy,method,args)->{
     if(method.getName().equals("updateMenu") && holdNext.compareAndSet(true,false)) {
      var held=new java.util.concurrent.CompletableFuture<Void>();
      pending.add(()->{try {((java.util.concurrent.CompletableFuture<?>)method.invoke(delegate,args)).whenComplete((value,error)->{if(error!=null)held.completeExceptionally(error);else held.complete(null);});}catch(Exception error){held.completeExceptionally(error);}});
      return held;
     }
     try{return method.invoke(delegate,args);}catch(java.lang.reflect.InvocationTargetException error){throw error.getCause();}
    });
   for(int i=0;i<47;i++) store.addUnclaimedSummonItems(player,"loot"+i,1);
   var sources=ItemSourceRegistry.create(); var maker=new me.rakkoon69.rakunloots.summonitem.SummonItemMaker(sources);
   var failures=new ArrayList<String>(); var claims=new UnclaimedSummonItems(adapter,()->config,store,maker,(what,cause)->failures.add(what));
   var renderer=new MenuRenderer(sources,key->config.message("",key),MenuWarnings.ignore); var menus=new MenuService(adapter,renderer);
   var menu=new ClaimMenu(adapter,()->config,claims,maker,menus,renderer,(what,cause)->failures.add(what));
   menu.open(player,()->fail("owed rows must open")); delegate.globalScheduler().stepTicks(3);
   holdNext.set(true); menus.click(player,0).join(); delegate.globalScheduler().stepTicks(3);
   assertEquals(1,pending.size(),"the async refresh is queued on the owner");
   menus.click(player,53).join(); delegate.globalScheduler().stepTicks(3);
   List.copyOf(pending).forEach(Runnable::run); delegate.globalScheduler().stepTicks(3);
   var latest=delegate.menuUpdates().get(delegate.menuUpdates().size()-1).contents();
   assertTrue(latest.get(0).getItemMeta().getDisplayName().contains("loot9"),
    "the older queued page-1 update overwrote the newer page-2 turn: "+latest.get(0).getItemMeta().getDisplayName());
   assertTrue(failures.isEmpty(),failures.toString());
  } finally {store.close(); MockBukkit.unmock();}
 }
 static ConfigSnapshot snapshot(String nextName) throws Exception { return snapshot(nextName,46); }
 static ConfigSnapshot snapshot(String nextName,int count) throws Exception {
  var language=new String(Objects.requireNonNull(Phase9ClaimLanguageSnapshotProofTest.class.getResourceAsStream("/languages/en.yml")).readAllBytes(),StandardCharsets.UTF_8);
  language=language.replace("menu_button_next_page_name: \"&a[Next page >]\"","menu_button_next_page_name: \""+nextName+"\"");
  var sources=ConfigSources.builder().globals("language: en\n").worlds("{}\n").language("en",language);
  for(int i=0;i<count;i++) sources.loot("loot"+i,"open_mode: drop\nblock: barrel\nsummon_item: {id: nether_star}\nroll:\n  entries:\n    a:\n      item: {id: diamond}\n");
  var result=ConfigLoader.load(sources.build(),new NameCatalog(){public Optional<String> currentId(String id){return Optional.of(id.contains(":")?id:"minecraft:"+id);} public boolean soundExists(String key){return true;}});
  assertEquals(count,result.loots().size()); return result;
 }
}