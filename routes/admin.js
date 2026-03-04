const express = require('express');
const bcrypt = require('bcryptjs');
const { queryAll, queryOne, runSql } = require('../db/schema');
const { authMiddleware, adminOnly } = require('../middleware/auth');

const router = express.Router();

// GET /api/admin/users — list all users
router.get('/users', authMiddleware, adminOnly, (req, res) => {
    try {
        const users = queryAll(`SELECT u.id, u.username, u.full_name, u.role, u.org_id, u.email, u.telegram, u.is_active, u.created_at, o.name as org_name
      FROM users u LEFT JOIN organizations o ON o.id = u.org_id ORDER BY u.id`);
        res.json(users);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server xatosi' }); }
});

// POST /api/admin/users — create user
router.post('/users', authMiddleware, adminOnly, (req, res) => {
    try {
        const { username, password, full_name, role, org_id, email, telegram } = req.body;
        if (!username || !password || !full_name || !role) return res.status(400).json({ error: 'Barcha majburiy maydonlarni to\'ldiring' });

        const existing = queryOne('SELECT 1 FROM users WHERE username = ?', [username]);
        if (existing) return res.status(409).json({ error: 'Bu username allaqachon mavjud' });

        const hash = bcrypt.hashSync(password, 10);
        const info = runSql('INSERT INTO users (username, password_hash, full_name, role, org_id, email, telegram) VALUES (?,?,?,?,?,?,?)',
            [username, hash, full_name, role, org_id || null, email || null, telegram || null]);

        runSql('INSERT INTO audit_logs (user_id, action, entity, entity_id, comment) VALUES (?,?,?,?,?)',
            [req.user.id, 'yaratish', 'user', info.lastInsertRowid, `"${full_name}" foydalanuvchi yaratildi`]);

        res.status(201).json({ id: info.lastInsertRowid, message: 'Foydalanuvchi yaratildi' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server xatosi' }); }
});

// PATCH /api/admin/users/:id — update user (including username)
router.patch('/users/:id', authMiddleware, adminOnly, (req, res) => {
    try {
        const { username, full_name, role, org_id, email, telegram, is_active } = req.body;
        const user = queryOne('SELECT * FROM users WHERE id = ?', [parseInt(req.params.id)]);
        if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });

        // Check unique username if changing
        if (username && username !== user.username) {
            const dup = queryOne('SELECT 1 FROM users WHERE username = ? AND id != ?', [username, user.id]);
            if (dup) return res.status(409).json({ error: 'Bu username allaqachon mavjud' });
        }

        runSql('UPDATE users SET username=?, full_name=?, role=?, org_id=?, email=?, telegram=?, is_active=? WHERE id=?',
            [username || user.username, full_name || user.full_name, role || user.role,
            org_id !== undefined ? org_id : user.org_id,
            email !== undefined ? email : user.email, telegram !== undefined ? telegram : user.telegram,
            is_active !== undefined ? is_active : user.is_active, user.id]);

        runSql('INSERT INTO audit_logs (user_id, action, entity, entity_id, comment) VALUES (?,?,?,?,?)',
            [req.user.id, 'tahrirlash', 'user', user.id, `"${full_name || user.full_name}" foydalanuvchi tahrirlandi`]);

        res.json({ message: 'Foydalanuvchi yangilandi' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server xatosi' }); }
});

// PATCH /api/admin/users/:id/password — change password
router.patch('/users/:id/password', authMiddleware, adminOnly, (req, res) => {
    try {
        const { password } = req.body;
        if (!password || password.length < 4) return res.status(400).json({ error: 'Parol kamida 4 belgidan iborat bo\'lishi kerak' });

        const user = queryOne('SELECT * FROM users WHERE id = ?', [parseInt(req.params.id)]);
        if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });

        const hash = bcrypt.hashSync(password, 10);
        runSql('UPDATE users SET password_hash = ? WHERE id = ?', [hash, user.id]);

        runSql('INSERT INTO audit_logs (user_id, action, entity, entity_id, comment) VALUES (?,?,?,?,?)',
            [req.user.id, 'parol_ozgartirish', 'user', user.id, `"${user.full_name}" paroli o'zgartirildi`]);

        res.json({ message: 'Parol o\'zgartirildi' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server xatosi' }); }
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', authMiddleware, adminOnly, (req, res) => {
    try {
        const user = queryOne('SELECT * FROM users WHERE id = ?', [parseInt(req.params.id)]);
        if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
        if (user.role === 'admin') return res.status(400).json({ error: 'Admin foydalanuvchini o\'chirish mumkin emas' });

        runSql('UPDATE users SET is_active = 0 WHERE id = ?', [user.id]);
        runSql('INSERT INTO audit_logs (user_id, action, entity, entity_id, comment) VALUES (?,?,?,?,?)',
            [req.user.id, 'o\'chirish', 'user', user.id, `"${user.full_name}" foydalanuvchi o'chirildi`]);

        res.json({ message: 'Foydalanuvchi o\'chirildi' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server xatosi' }); }
});

// --- ORGANIZATION MANAGEMENT ---

// GET /api/admin/organizations
router.get('/organizations', authMiddleware, adminOnly, (req, res) => {
    try {
        const orgs = queryAll('SELECT * FROM organizations ORDER BY name');
        res.json(orgs);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server xatosi' }); }
});

// POST /api/admin/organizations
router.post('/organizations', authMiddleware, adminOnly, (req, res) => {
    try {
        const { name, type, district, leader_name, phone } = req.body;
        if (!name || !type) return res.status(400).json({ error: 'Nom va tur majburiy' });

        const info = runSql('INSERT INTO organizations (name, type, district, leader_name, phone) VALUES (?,?,?,?,?)',
            [name, type, district || null, leader_name || null, phone || null]);

        runSql('INSERT INTO audit_logs (user_id, action, entity, entity_id, comment) VALUES (?,?,?,?,?)',
            [req.user.id, 'yaratish', 'org', info.lastInsertRowid, `"${name}" tashkilot yaratildi`]);

        res.status(201).json({ id: info.lastInsertRowid, message: 'Tashkilot yaratildi' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server xatosi' }); }
});

// PATCH /api/admin/organizations/:id
router.patch('/organizations/:id', authMiddleware, adminOnly, (req, res) => {
    try {
        const { name, type, district, leader_name, phone, is_active } = req.body;
        const org = queryOne('SELECT * FROM organizations WHERE id = ?', [parseInt(req.params.id)]);
        if (!org) return res.status(404).json({ error: 'Tashkilot topilmadi' });

        runSql('UPDATE organizations SET name=?, type=?, district=?, leader_name=?, phone=?, is_active=? WHERE id=?',
            [name || org.name, type || org.type, district !== undefined ? district : org.district,
            leader_name !== undefined ? leader_name : org.leader_name,
            phone !== undefined ? phone : org.phone,
            is_active !== undefined ? is_active : org.is_active, org.id]);

        runSql('INSERT INTO audit_logs (user_id, action, entity, entity_id, comment) VALUES (?,?,?,?,?)',
            [req.user.id, 'tahrirlash', 'org', org.id, `"${name || org.name}" tashkilot tahrirlandi`]);

        res.json({ message: 'Tashkilot yangilandi' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server xatosi' }); }
});

// DELETE /api/admin/organizations/:id
router.delete('/organizations/:id', authMiddleware, adminOnly, (req, res) => {
    try {
        const org = queryOne('SELECT * FROM organizations WHERE id = ?', [parseInt(req.params.id)]);
        if (!org) return res.status(404).json({ error: 'Tashkilot topilmadi' });

        // Check if has users assigned
        const usersCount = queryOne('SELECT COUNT(*) as cnt FROM users WHERE org_id = ? AND is_active = 1', [org.id]);
        if (usersCount && usersCount.cnt > 0) {
            return res.status(400).json({ error: 'Tashkilotda faol foydalanuvchilar bor. Avval ularni boshqa tashkilotga o\'tkazing.' });
        }

        runSql('UPDATE organizations SET is_active = 0 WHERE id = ?', [org.id]);
        runSql('INSERT INTO audit_logs (user_id, action, entity, entity_id, comment) VALUES (?,?,?,?,?)',
            [req.user.id, 'o\'chirish', 'org', org.id, `"${org.name}" tashkilot o'chirildi`]);

        res.json({ message: 'Tashkilot o\'chirildi' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server xatosi' }); }
});

module.exports = router;
