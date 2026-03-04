const express = require('express');
const { queryAll } = require('../db/schema');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

const PRIORITIES = { past: 'Past', orta: "O'rta", yuqori: 'Yuqori', juda_muhim: 'Juda muhim' };
const STATUSES = { yangi: 'Yangi', qabul_qilindi: 'Qabul qilindi', rad_etildi: 'Rad etildi', bajarilmoqda: 'Bajarilmoqda', bajarildi: 'Bajarildi', muddati_otgan: "Muddati o'tgan" };

router.get('/tasks-csv', authMiddleware, (req, res) => {
    try {
        const tasks = queryAll('SELECT t.*, o.name as org_name FROM tasks t LEFT JOIN organizations o ON o.id = t.org_id ORDER BY t.created_at DESC');
        let csv = '\ufeffID,Sarlavha,Tashkilot,Muddat,Prioritet,Holat,Kategoriya,Yaratilgan\n';
        tasks.forEach(t => {
            csv += `${t.id},"${t.title}","${t.org_name || ''}","${t.deadline || ''}","${PRIORITIES[t.priority] || t.priority}","${STATUSES[t.status] || t.status}","${t.category || ''}","${t.created_at}"\n`;
        });
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="topshiriqlar.csv"');
        res.send(csv);
    } catch (err) {
        console.error('Export CSV error:', err);
        res.status(500).json({ error: 'Server xatosi' });
    }
});

router.get('/audit-csv', authMiddleware, (req, res) => {
    try {
        const logs = queryAll('SELECT al.*, u.full_name FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id ORDER BY al.timestamp DESC');
        let csv = '\ufeffVaqt,Foydalanuvchi,Harakat,Izoh\n';
        logs.forEach(l => {
            csv += `"${l.timestamp}","${l.full_name || 'Tizim'}","${l.action}","${(l.comment || '').replace(/"/g, '""')}"\n`;
        });
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="audit_log.csv"');
        res.send(csv);
    } catch (err) {
        console.error('Export audit CSV error:', err);
        res.status(500).json({ error: 'Server xatosi' });
    }
});

module.exports = router;
