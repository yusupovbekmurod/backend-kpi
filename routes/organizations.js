const express = require('express');
const { queryAll } = require('../db/schema');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.get('/', authMiddleware, (req, res) => {
    try {
        const { type } = req.query;
        let query = 'SELECT * FROM organizations';
        const params = [];
        if (type) { query += ' WHERE type = ?'; params.push(type); }
        query += ' ORDER BY name';
        res.json(queryAll(query, params));
    } catch (err) {
        console.error('Organizations error:', err);
        res.status(500).json({ error: 'Server xatosi' });
    }
});

router.get('/types', authMiddleware, (req, res) => {
    try {
        const types = queryAll('SELECT DISTINCT type FROM organizations ORDER BY type');
        res.json(types.map(t => t.type));
    } catch (err) {
        res.status(500).json({ error: 'Server xatosi' });
    }
});

router.get('/executors', authMiddleware, (req, res) => {
    try {
        res.json(queryAll("SELECT id, full_name, role FROM users WHERE role = 'ijrochi'"));
    } catch (err) {
        res.status(500).json({ error: 'Server xatosi' });
    }
});

module.exports = router;
