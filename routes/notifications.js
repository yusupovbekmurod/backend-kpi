const express = require('express');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { queryAll } = require('../db/schema');
const { generateTasksExcel } = require('../utils/excel');
const { sendTelegramDocument, sendTelegramMessage, notifyDeadline, notifyOverdue, isBotActive } = require('../utils/telegram');
const path = require('path');

const router = express.Router();

// Stored in-memory notifications for browser push
let notifications = [];
let notificationId = 1;

function addNotification(type, title, message, data = {}) {
    const n = { id: notificationId++, type, title, message, data, created_at: new Date().toISOString(), read: false };
    notifications.unshift(n);
    if (notifications.length > 100) notifications = notifications.slice(0, 100);
    return n;
}

// GET /api/notifications — get recent browser notifications
router.get('/', authMiddleware, (req, res) => {
    res.json(notifications.slice(0, 30));
});

// PATCH /api/notifications/:id/read
router.patch('/:id/read', authMiddleware, (req, res) => {
    const n = notifications.find(n => n.id == req.params.id);
    if (n) n.read = true;
    res.json({ ok: true });
});

// PATCH /api/notifications/read-all
router.patch('/read-all', authMiddleware, (req, res) => {
    notifications.forEach(n => n.read = true);
    res.json({ ok: true });
});

// GET /api/notifications/poll — long-poll for new notifications
router.get('/poll', authMiddleware, (req, res) => {
    const since = parseInt(req.query.since) || 0;
    const newer = notifications.filter(n => n.id > since);
    if (newer.length > 0) {
        return res.json(newer);
    }
    // Wait up to 20 seconds for new notification
    const check = setInterval(() => {
        const newer2 = notifications.filter(n => n.id > since);
        if (newer2.length > 0) {
            clearInterval(check);
            clearTimeout(timeout);
            return res.json(newer2);
        }
    }, 2000);
    const timeout = setTimeout(() => {
        clearInterval(check);
        res.json([]);
    }, 20000);
    req.on('close', () => { clearInterval(check); clearTimeout(timeout); });
});

// POST /api/notifications/send-report — generate Excel & send to Telegram
router.post('/send-report', authMiddleware, adminOnly, async (req, res) => {
    try {
        // Generate Excel
        const { filePath, fileName } = await generateTasksExcel(req.body);

        if (isBotActive()) {
            const today = new Date().toLocaleDateString('uz-UZ');
            await sendTelegramDocument(filePath, '📊 <b>KPI Hisobot</b> — ' + today);
            res.json({ message: 'Hisobot Telegramga yuborildi!', fileName });
        } else {
            res.json({ message: 'Excel yaratildi (Telegram sozlanmagan)', fileName, downloadUrl: '/uploads/' + fileName });
        }
    } catch (err) {
        console.error('Report error:', err);
        res.status(500).json({ error: 'Hisobot yaratishda xatolik: ' + err.message });
    }
});

// POST /api/notifications/send-deadlines — send deadline alerts to Telegram
router.post('/send-deadlines', authMiddleware, adminOnly, async (req, res) => {
    try {
        const approaching = queryAll(`SELECT t.*, o.name as org_name FROM tasks t 
      LEFT JOIN organizations o ON o.id = t.org_id 
      WHERE t.status NOT IN ('bajarildi','rad_etildi') 
      AND t.deadline BETWEEN datetime('now') AND datetime('now','+3 days') 
      ORDER BY t.deadline ASC`);

        const overdue = queryAll(`SELECT t.*, o.name as org_name FROM tasks t 
      LEFT JOIN organizations o ON o.id = t.org_id 
      WHERE t.status NOT IN ('bajarildi','rad_etildi') 
      AND t.deadline < datetime('now') 
      ORDER BY t.deadline ASC`);

        if (isBotActive()) {
            if (overdue.length > 0) await notifyOverdue(overdue);
            if (approaching.length > 0) await notifyDeadline(approaching);

            if (overdue.length === 0 && approaching.length === 0) {
                await sendTelegramMessage('✅ Hozircha muddati yaqinlashgan yoki o\'tgan topshiriqlar yo\'q.');
            }
        }

        // Also add as browser notification
        if (overdue.length > 0) {
            addNotification('warning', 'Muddati o\'tgan', overdue.length + ' ta topshiriq muddati o\'tdi!', { count: overdue.length });
        }
        if (approaching.length > 0) {
            addNotification('info', 'Muddat yaqin', approaching.length + ' ta topshiriq muddati yaqinlashmoqda', { count: approaching.length });
        }

        res.json({
            message: 'Eslatmalar yuborildi',
            overdue: overdue.length,
            approaching: approaching.length,
            telegram: isBotActive()
        });
    } catch (err) {
        console.error('Deadline notify error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/notifications/excel-download — download Excel report
router.get('/excel-download', authMiddleware, async (req, res) => {
    try {
        const { filePath, fileName } = await generateTasksExcel(req.query);
        res.download(filePath, fileName);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/notifications/telegram-status
router.get('/telegram-status', authMiddleware, (req, res) => {
    res.json({ active: isBotActive() });
});

module.exports = { router, addNotification };
