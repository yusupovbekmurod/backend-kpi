const TelegramBot = require('node-telegram-bot-api');

let bot = null;
let chatId = null;

function initBot() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    chatId = process.env.TELEGRAM_CHAT_ID;

    if (!token) {
        console.log('⚠️  TELEGRAM_BOT_TOKEN o\'rnatilmagan. Telegram xabarnomalar o\'chirilgan.');
        console.log('   .env faylga TELEGRAM_BOT_TOKEN va TELEGRAM_CHAT_ID qo\'shing.');
        return;
    }
    if (!chatId) {
        console.log('⚠️  TELEGRAM_CHAT_ID o\'rnatilmagan. Telegram xabarnomalar o\'chirilgan.');
        return;
    }

    try {
        bot = new TelegramBot(token, { polling: false });
        console.log('✅ Telegram bot ulandi');
    } catch (err) {
        console.error('❌ Telegram bot xatosi:', err.message);
    }
}

async function sendTelegramMessage(text, options = {}) {
    if (!bot || !chatId) return false;
    try {
        await bot.sendMessage(chatId, text, { parse_mode: 'HTML', ...options });
        return true;
    } catch (err) {
        console.error('Telegram yuborishda xatolik:', err.message);
        return false;
    }
}

async function sendTelegramDocument(filePath, caption) {
    if (!bot || !chatId) return false;
    try {
        await bot.sendDocument(chatId, filePath, { caption, parse_mode: 'HTML' });
        return true;
    } catch (err) {
        console.error('Telegram fayl yuborishda xatolik:', err.message);
        return false;
    }
}

// Topshiriq haqida xabar
async function notifyNewTask(task) {
    const msg = `📋 <b>Yangi topshiriq yaratildi</b>\n\n` +
        `<b>${task.title}</b>\n` +
        `📁 ${task.category || 'Umumiy'}\n` +
        `🏢 ${task.org_name || 'Noma\'lum'}\n` +
        `📅 Muddat: ${task.deadline}\n` +
        `⚡ Prioritet: ${task.priority}`;
    return sendTelegramMessage(msg);
}

// Javob kelganda xabar
async function notifyResponse(task, userName) {
    const msg = `✉️ <b>Javob keldi</b>\n\n` +
        `<b>${task.title}</b>\n` +
        `👤 ${userName} javob yubordi\n` +
        `📅 ${new Date().toLocaleString('uz-UZ')}`;
    return sendTelegramMessage(msg);
}

// Muddat yaqinlashganda xabar
async function notifyDeadline(tasks) {
    if (!tasks.length) return;
    let msg = `⏰ <b>Muddat yaqinlashmoqda!</b>\n\n`;
    tasks.forEach(t => {
        msg += `• <b>${t.title}</b> — ${t.deadline}\n  🏢 ${t.org_name || '—'}\n\n`;
    });
    return sendTelegramMessage(msg);
}

// Muddati o'tgan topshiriqlar
async function notifyOverdue(tasks) {
    if (!tasks.length) return;
    let msg = `🚨 <b>Muddati o'tgan topshiriqlar!</b>\n\n`;
    tasks.forEach(t => {
        msg += `• <b>${t.title}</b> — ${t.deadline}\n  🏢 ${t.org_name || '—'}\n\n`;
    });
    return sendTelegramMessage(msg);
}

function isBotActive() {
    return !!(bot && chatId);
}

module.exports = { initBot, sendTelegramMessage, sendTelegramDocument, notifyNewTask, notifyResponse, notifyDeadline, notifyOverdue, isBotActive };
