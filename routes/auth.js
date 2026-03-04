const express = require('express');
const bcrypt = require('bcryptjs');
const { queryOne, queryAll, runSql } = require('../db/schema');
const { generateToken, authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.post('/login', (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'Username va parol kiritilishi shart' });

        const user = queryOne('SELECT * FROM users WHERE username = ? AND is_active = 1', [username]);
        if (!user || !bcrypt.compareSync(password, user.password_hash)) {
            return res.status(401).json({ error: "Login yoki parol noto'g'ri" });
        }

        const token = generateToken(user);
        const { password_hash, ...safeUser } = user;

        // If tashkilot user, include org info
        if (user.role === 'tashkilot' && user.org_id) {
            safeUser.organization = queryOne('SELECT * FROM organizations WHERE id = ?', [user.org_id]);
        }

        runSql('INSERT INTO audit_logs (user_id, action, entity, comment) VALUES (?,?,?,?)',
            [user.id, 'login', 'auth', `${user.full_name} tizimga kirdi`]);

        res.json({ token, user: safeUser });
    } catch (err) { console.error('Login error:', err); res.status(500).json({ error: 'Server xatosi' }); }
});

router.get('/me', authMiddleware, (req, res) => {
    try {
        const user = queryOne('SELECT id, username, full_name, role, org_id, email, telegram FROM users WHERE id = ?', [req.user.id]);
        if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
        if (user.role === 'tashkilot' && user.org_id) {
            user.organization = queryOne('SELECT * FROM organizations WHERE id = ?', [user.org_id]);
        }
        res.json(user);
    } catch (err) { res.status(500).json({ error: 'Server xatosi' }); }
});

module.exports = router;
