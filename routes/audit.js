const express = require('express');
const { queryAll, queryOne } = require('../db/schema');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.get('/', authMiddleware, (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const offset = (page - 1) * limit;

        const total = queryOne('SELECT COUNT(*) as cnt FROM audit_logs').cnt;
        const logs = queryAll(`
      SELECT al.*, u.full_name FROM audit_logs al
      LEFT JOIN users u ON u.id = al.user_id
      ORDER BY al.timestamp DESC LIMIT ? OFFSET ?
    `, [limit, offset]);

        res.json({ logs, total, page, totalPages: Math.ceil(total / limit) });
    } catch (err) {
        console.error('Audit error:', err);
        res.status(500).json({ error: 'Server xatosi' });
    }
});

module.exports = router;
