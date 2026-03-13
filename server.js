require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cron = require('node-cron');
const path = require('path');
const fs = require('fs');
const { initializeDatabase, seedDatabase, closeDb } = require('./db/schema');
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
const frontendDir = path.join(__dirname, '..', 'frontend', 'dist');
const hasFrontend = fs.existsSync(frontendDir);

// Ensure directories exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Security middleware
app.use(helmet({ crossOriginResourcePolicy: false, contentSecurityPolicy: false }));

// CORS — configurable for production
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
app.use(cors({
    origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN.split(',').map(s => s.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));

// Simple rate limiter for login endpoint
const loginAttempts = new Map();
function loginRateLimit(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const windowMs = 15 * 60 * 1000; // 15 minutes
    const maxAttempts = 10;

    if (!loginAttempts.has(ip)) {
        loginAttempts.set(ip, []);
    }

    const attempts = loginAttempts.get(ip).filter(t => now - t < windowMs);
    loginAttempts.set(ip, attempts);

    if (attempts.length >= maxAttempts) {
        return res.status(429).json({ error: 'Juda ko\'p urinish. 15 daqiqadan so\'ng qayta urinib ko\'ring.' });
    }

    attempts.push(now);
    next();
}

// Cleanup old rate limit data every 30 minutes
setInterval(() => {
    const now = Date.now();
    const windowMs = 15 * 60 * 1000;
    for (const [ip, attempts] of loginAttempts.entries()) {
        const valid = attempts.filter(t => now - t < windowMs);
        if (valid.length === 0) loginAttempts.delete(ip);
        else loginAttempts.set(ip, valid);
    }
}, 30 * 60 * 1000);

// Serve uploaded files
app.use('/uploads', express.static(uploadsDir));

// Serve frontend build if it exists
if (hasFrontend) {
    app.use(express.static(frontendDir));
}

// Rate limit on login
app.use('/api/auth/login', loginRateLimit);

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
    res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '3.1.0', telegram: isBotActive() });
});

// Serve SPA for all non-API routes if frontend exists
if (hasFrontend) {
    app.get('*', (req, res) => {
        if (!req.path.startsWith('/api') && !req.path.startsWith('/uploads')) {
            res.sendFile(path.join(frontendDir, 'index.html'));
        }
    });
}

app.use((req, res) => { res.status(404).json({ error: 'Endpoint topilmadi' }); });
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    if (IS_PRODUCTION) {
        res.status(500).json({ error: 'Ichki server xatosi' });
    } else {
        res.status(500).json({ error: 'Ichki server xatosi', details: err.message });
    }
});

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

// Graceful shutdown — close database before exit
function gracefulShutdown(signal) {
    console.log(`\n🛑 ${signal} signal received. Closing database...`);
    try {
        closeDb();
        console.log('✅ Database closed successfully.');
    } catch (err) {
        console.error('❌ Error closing database:', err);
    }
    process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));
process.on('uncaughtException', (err) => {
    console.error('💥 Uncaught Exception:', err);
    try { closeDb(); } catch (e) { /* silent */ }
    process.exit(1);
});
process.on('unhandledRejection', (reason) => {
    console.error('💥 Unhandled Rejection:', reason);
});

function start() {
    try {
        initializeDatabase();
        seedDatabase();

        // Init Telegram bot
        initBot();

        checkDeadlines();
        cron.schedule('0 * * * *', cronDeadlineCheck);     // Every hour
        cron.schedule('0 9 * * 1-6', dailyReport);          // Mon-Sat 09:00

        app.listen(PORT, '0.0.0.0', () => {
            console.log(`\n🚀 Sirdaryo KPI Backend v3.1: http://localhost:${PORT}`);
            console.log(`📋 API: http://localhost:${PORT}/api/health`);
            console.log(`📁 Uploads: http://localhost:${PORT}/uploads/`);
            console.log(`🤖 Telegram: ${isBotActive() ? 'Faol ✅' : 'O\'chirilgan (tokenni .env ga qo\'shing)'}`);
            if (hasFrontend) console.log(`🌐 Frontend UI is being served from: dist/`);
            else console.log(`🔧 Development mode: no local dist folder found, frontend runs separately`);
            console.log('');
        });
    } catch (err) { console.error('Failed to start:', err); process.exit(1); }
}

start();
