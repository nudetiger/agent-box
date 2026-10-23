const mineflayer = require('C:/Workspace/Projects/MinecraftPlugins/RakunProbe/tools/bot/node_modules/mineflayer');
const bot = mineflayer.createBot({host:'127.0.0.1', port:25572, username:'Other1', auth:'offline', version:'26.1'});
let menuId;
let closed = false;
let finished = false;
const record = value => process.stdout.write(JSON.stringify(value) + '\n');
const timer = setTimeout(() => finish(false, 'server did not stop within 90 seconds'), 90000);
function finish(ok, reason) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  record({kind:'result', pass:ok, reason, menuId, closePacketBeforeDisconnect:closed});
  try { bot.quit(); } catch {}
  setTimeout(() => process.exit(ok ? 0 : 1), 150);
}
bot.once('spawn', () => setTimeout(() => bot.chat('/loots'), 700));
bot.on('windowOpen', window => {
  menuId = window.id;
  record({kind:'ready', menuId, title:window.title, size:window.inventoryStart});
});
bot._client.on('packet', (data, meta) => {
  if (meta.name === 'close_window') {
    record({kind:'server_close_window', data});
    if (menuId !== undefined && data.windowId === menuId) closed = true;
  }
});
bot.on('kicked', reason => record({kind:'kicked', reason}));
bot.on('error', error => record({kind:'error', message:error.message}));
bot.on('end', reason => finish(menuId !== undefined && closed, String(reason)));
