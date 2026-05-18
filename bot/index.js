const { Telegraf, Markup } = require('telegraf');
const db = require('../database/db');
const logger = require('../utils/logger');
require('dotenv').config();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

async function ensureUser(ctx) {
  const from = ctx.from;
  try {
    let user = await db.get('SELECT * FROM users WHERE telegram_id = ?', [from.id]);
    if (!user) {
      await db.run(
        `INSERT INTO users (telegram_id, username, balance, level, streak, created_at) 
         VALUES (?, ?, 0.0, 1, 0, strftime('%s', 'now'))`,
        [from.id, from.username || from.first_name || 'Player']
      );
      user = await db.get('SELECT * FROM users WHERE telegram_id = ?', [from.id]);
    }
    return user;
  } catch (err) {
    logger.error('Error ensuring user context:', err);
    return null;
  }
}

bot.start(async (ctx) => {
  const user = await ensureUser(ctx);
  const secureUrl = process.env.PUBLIC_URL || `https://onrender.com`;
  
  const text = `🔴 ☄️ **WELCOME TO MARS BINGO LIVE** ☄️ 🔴\n\n` +
               `💰 **Balance:** ${user ? user.balance.toFixed(2) : '0.00'} ETB\n` +
               `🎮 **Level:** ${user ? user.level : '1'}\n\n` +
               `Tap the button below to load the live multiplayer casino lobby directly inside Telegram:`;

  return ctx.replyWithMarkdownV2(
    text.replace(/\./g, '\\.').replace(/-/g, '\\-').replace(/!/g, '\\!'),
    Markup.inlineKeyboard([
      [Markup.button.webApp('🚀 Open Mars Bingo App', secureUrl)],
      [Markup.button.callback('💳 Deposit Telebirr', 'menu_deposit'), Markup.button.callback('🏧 Withdraw', 'menu_withdraw')],
      [Markup.button.callback('ℹ️ Help Guide', 'menu_help')]
    ])
  );
});

bot.action('menu_deposit', async (ctx) => {
  await ctx.answerCbQuery();
  return ctx.reply(`💳 TELEBIRR DEPOSIT CHANNEL:\n━━━━━━━━━━━━━━━━━━━━\n1. Send transfer to our official number:\n👉 0949950293\n\n2. Open the Mini App, head to the Cashier page, and submit the 10-digit Transaction Reference ID for verification.`);
});

bot.action('menu_withdraw', async (ctx) => {
  await ctx.answerCbQuery();
  return ctx.reply(`🏧 PAYOUT WITHDRAWALS:\n━━━━━━━━━━━━━━━━━━━━\nTo claim a payout, open the Mars Bingo Mini App interface, click on the Cashier portal, and enter your target payout amount.`);
});

bot.action('menu_help', async (ctx) => {
  await ctx.answerCbQuery();
  return ctx.reply(`ℹ️ GAME LAWS:\n━━━━━━━━━━━━━━━━━━━━\n• Entry tickets cost 50 ETB per round.\n• Real-time automated ball drawing draws numbers from 1 to 75.\n• Prizes are credited instantly into your account balance on clear horizontal or vertical lines.`);
});

bot.command('admin', async (ctx) => {
  if (Number(ctx.from.id) !== Number(process.env.ADMIN_TELEGRAM_ID)) {
    return ctx.reply('❌ Authorization error: Admin access restricted.');
  }
  return ctx.reply(`🛠️ ADMIN HUB:\n━━━━━━━━━━━━━━━━━━━━\n• /approve_tx [ID]\n• /reject_tx [ID]\n• /stats`);
});

bot.command('approve_tx', async (ctx) => {
  if (Number(ctx.from.id) !== Number(process.env.ADMIN_TELEGRAM_ID)) return;
  const args = ctx.message.text.split(' ');
  if (args.length < 2) return ctx.reply('Usage: /approve_tx [TX_ID]');
  const txId = args[1];

  try {
    const tx = await db.get("SELECT * FROM transactions WHERE id = ? AND status = 'pending'", [txId]);
    if (!tx) return ctx.reply('❌ Transaction not found or already processed.');

    await db.run("UPDATE transactions SET status = 'approved', updated_at = strftime('%s', 'now') WHERE id = ?", [txId]);
    if (tx.type === 'deposit') {
      await db.run("UPDATE users SET balance = balance + ? WHERE telegram_id = ?", [tx.amount, tx.user_id]);
      try {
        await bot.telegram.sendMessage(tx.user_id, `✅ Your deposit of ${tx.amount} ETB has been APPROVED!`);
      } catch (f) { logger.error(f); }
    }
    return ctx.reply(`✅ Transaction ID ${txId} approved cleanly.`);
  } catch (err) {
    return ctx.reply('Database execution error.');
  }
});

bot.command('reject_tx', async (ctx) => {
  if (Number(ctx.from.id) !== Number(process.env.ADMIN_TELEGRAM_ID)) return;
  const args = ctx.message.text.split(' ');
  if (args.length < 2) return ctx.reply('Usage: /reject_tx [TX_ID]');
  const txId = args[1];

  try {
    const tx = await db.get("SELECT * FROM transactions WHERE id = ? AND status = 'pending'", [txId]);
    if (!tx) return ctx.reply('❌ Transaction not found or locked.');

    await db.run("UPDATE transactions SET status = 'rejected', updated_at = strftime('%s', 'now') WHERE id = ?", [txId]);
    if (tx.type === 'withdrawal') {
      await db.run("UPDATE users SET balance = balance + ? WHERE telegram_id = ?", [tx.amount, tx.user_id]);
    }
    try {
      await bot.telegram.sendMessage(tx.user_id, `❌ Your transaction request has been rejected by admin.`);
    } catch (f) { logger.error(f); }
    return ctx.reply(`❌ Transaction ID ${txId} marked as rejected.`);
  } catch (err) {
    return ctx.reply('Database error.');
  }
});

bot.command('stats', async (ctx) => {
  if (Number(ctx.from.id) !== Number(process.env.ADMIN_TELEGRAM_ID)) return;
  try {
    const totalUsers = await db.get("SELECT COUNT(*) as cnt FROM users");
    const pendingAlerts = await db.get("SELECT COUNT(*) as cnt FROM transactions WHERE status='pending'");
    return ctx.reply(`📊 PLATFORM STATS:\n━━━━━━━━━━━━━━━━━━━━\n• Registered Players: ${totalUsers.cnt}\n• Pending Approvals Queue: ${pendingAlerts.cnt}`);
  } catch (e) {
    return ctx.reply('Failed calculating metrics.');
  }
});

module.exports = bot;
