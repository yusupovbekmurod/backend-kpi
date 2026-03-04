const express = require('express');
const { queryAll, queryOne } = require('../db/schema');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.get('/stats', authMiddleware, (req, res) => {
    try {
        const total = queryOne('SELECT COUNT(*) as cnt FROM tasks').cnt;
        const done = queryOne("SELECT COUNT(*) as cnt FROM tasks WHERE status = 'bajarildi'").cnt;
        const active = queryOne("SELECT COUNT(*) as cnt FROM tasks WHERE status NOT IN ('bajarildi','muddati_otgan')").cnt;
        const overdue = queryOne("SELECT COUNT(*) as cnt FROM tasks WHERE status = 'muddati_otgan'").cnt;
        const rejected = queryOne("SELECT COUNT(*) as cnt FROM tasks WHERE status = 'rad_etildi'").cnt;

        const avgResult = queryOne("SELECT AVG(CAST((julianday(updated_at) - julianday(created_at)) AS REAL)) as avg_days FROM tasks WHERE status = 'bajarildi'");
        const avgDays = avgResult && avgResult.avg_days ? parseFloat(avgResult.avg_days.toFixed(1)) : 0;

        const onTimeRate = total > 0 ? Math.round((done / total) * 100) : 0;
        const rejectRate = total > 0 ? Math.round((rejected / total) * 100) : 0;
        const activeRate = total > 0 ? Math.round((active / total) * 100) : 0;

        res.json({ total, done, active, overdue, rejected, avgDays, onTimeRate, rejectRate, activeRate });
    } catch (err) {
        console.error('Dashboard stats error:', err);
        res.status(500).json({ error: 'Server xatosi' });
    }
});

router.get('/deadlines', authMiddleware, (req, res) => {
    try {
        const tasks = queryAll(`
      SELECT t.*, o.name as org_name FROM tasks t
      LEFT JOIN organizations o ON o.id = t.org_id
      WHERE t.status NOT IN ('bajarildi','muddati_otgan')
        AND t.deadline IS NOT NULL
        AND julianday(t.deadline) - julianday('now') BETWEEN 0 AND 2
      ORDER BY t.deadline ASC
    `);
        res.json(tasks);
    } catch (err) {
        console.error('Deadlines error:', err);
        res.status(500).json({ error: 'Server xatosi' });
    }
});

router.get('/org-summary', authMiddleware, (req, res) => {
    try {
        const orgs = queryAll('SELECT * FROM organizations ORDER BY name');
        const result = orgs.map(org => {
            const open = queryOne("SELECT COUNT(*) as cnt FROM tasks WHERE org_id = ? AND status NOT IN ('bajarildi','muddati_otgan')", [org.id]).cnt;
            const completed = queryOne("SELECT COUNT(*) as cnt FROM tasks WHERE org_id = ? AND status = 'bajarildi'", [org.id]).cnt;
            const overdueCount = queryOne("SELECT COUNT(*) as cnt FROM tasks WHERE org_id = ? AND status = 'muddati_otgan'", [org.id]).cnt;
            return { ...org, open, completed, overdue: overdueCount, total: open + completed + overdueCount };
        }).filter(o => o.total > 0);
        res.json(result);
    } catch (err) {
        console.error('Org summary error:', err);
        res.status(500).json({ error: 'Server xatosi' });
    }
});

module.exports = router;
