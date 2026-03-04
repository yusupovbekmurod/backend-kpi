require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cron = require('node-cron');
const path = require('path');
const fs = require('fs');
const { initializeDatabase, seedDatabase } = require('./db/schema');
const { checkDeadlines } = require('./utils/deadlines');
const { initBot, notifyDeadline, notifyOverdue, isBotActive } = require('./utils/telegram');
const { generateTasksExcel } = require('./utils/excel');
const { sendTelegramDocument } = require('./utils/telegram');
const { queryAll } = require('./db/schema');

const authRoutes = require('./routes/auth');
const taskRoutes = require('./routes/tasks');
const dashboardRoutes = require('./routes/dashboard');
const auditRoutes = require('./routes/audit');
const { router: notifRoutes, addNotification } = require('./routes/notifications');
const organizationRoutes = require('./routes/organizations');
const exportRoutes = require('./routes/export');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 4000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Ensure directories exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

app.use(helmet({ crossOriginResourcePolicy: false, contentSecurityPolicy: false }));
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

// Serve uploaded files
app.use('/uploads', express.static(uploadsDir));

// In production, serve frontend build
if (IS_PRODUCTION) {
    const frontendDir = path.join(__dirname, '..', 'frontend', 'dist');
    app.use(express.static(frontendDir));
}

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/notifications', notifRoutes);
app.use('/api/organizations', organizationRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/admin', adminRoutes);

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '2.2.0', telegram: isBotActive() });
});

// In production, serve SPA for all non-API routes
if (IS_PRODUCTION) {
    app.get('*', (req, res) => {
        if (!req.path.startsWith('/api') && !req.path.startsWith('/uploads')) {
            res.sendFile(path.join(__dirname, '..', 'frontend', 'dist', 'index.html'));
        }
    });
}

app.use((req, res) => { res.status(404).json({ error: 'Endpoint topilmadi' }); });
app.use((err, req, res, next) => { console.error('Server error:', err); res.status(500).json({ error: 'Ichki server xatosi' }); });

// Cron: deadline check + Telegram alerts every hour
async function cronDeadlineCheck() {
    console.log('⏰ Running deadline & notification check...');
    checkDeadlines();

    if (isBotActive()) {
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

            if (overdue.length > 0) {
                await notifyOverdue(overdue);
                addNotification('warning', 'Muddati o\'tgan', overdue.length + ' ta topshiriq muddati o\'tdi!');
            }
            if (approaching.length > 0) {
                await notifyDeadline(approaching);
                addNotification('info', 'Muddat yaqin', approaching.length + ' ta topshiriq muddati yaqinlashmoqda');
            }
        } catch (err) { console.error('Cron notification error:', err); }
    }
}

// Daily report at 09:00
async function dailyReport() {
    if (!isBotActive()) return;
    console.log('📊 Sending daily report to Telegram...');
    try {
        const { filePath } = await generateTasksExcel();
        const today = new Date().toLocaleDateString('uz-UZ');
        await sendTelegramDocument(filePath, '📊 <b>Kunlik KPI Hisobot</b> — ' + today);
    } catch (err) { console.error('Daily report error:', err); }
}

async function start() {
    try {
        await initializeDatabase();
        await seedDatabase();

        // Init Telegram bot
        initBot();

        checkDeadlines();
        cron.schedule('0 * * * *', cronDeadlineCheck);     // Every hour
        cron.schedule('0 9 * * 1-6', dailyReport);          // Mon-Sat 09:00

        app.listen(PORT, '0.0.0.0', () => {
            console.log(`\n🚀 Sirdaryo KPI Backend v2.2: http://localhost:${PORT}`);
            console.log(`📋 API: http://localhost:${PORT}/api/health`);
            console.log(`📁 Uploads: http://localhost:${PORT}/uploads/`);
            console.log(`🤖 Telegram: ${isBotActive() ? 'Faol ✅' : 'O\'chirilgan (tokenni .env ga qo\'shing)'}`);
            if (IS_PRODUCTION) console.log(`🌐 Production mode: serving frontend from dist/`);
            else console.log(`🔧 Development mode: frontend runs separately`);
            console.log('');
        });
    } catch (err) { console.error('Failed to start:', err); process.exit(1); }
}

start();
