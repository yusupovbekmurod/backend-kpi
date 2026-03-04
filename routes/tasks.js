const express = require('express');
const multer = require('multer');
const path = require('path');
const { queryAll, queryOne, runSql } = require('../db/schema');
const { authMiddleware, mudirOnly } = require('../middleware/auth');
const { notifyNewTask, notifyResponse, isBotActive } = require('../utils/telegram');
const { addNotification } = require('./notifications');

const router = express.Router();

// Multer config for PDF uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'uploads')),
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E6) + path.extname(file.originalname);
        cb(null, uniqueName);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        const allowed = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.jpg', '.jpeg', '.png'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowed.includes(ext)) cb(null, true);
        else cb(new Error('Faqat PDF, DOC, XLS, JPG formatdagi fayllar ruxsat etiladi'));
    }
});

// GET /api/tasks — list tasks (role-based filtering)
router.get('/', authMiddleware, (req, res) => {
    try {
        const { status, org_id } = req.query;
        const isMudir = ['admin', 'mudir'].includes(req.user.role);
        const isTashkilot = req.user.role === 'tashkilot';

        let query, params = [];
        if (isMudir) {
            query = 'SELECT t.* FROM tasks t WHERE 1=1';
        } else if (isTashkilot) {
            query = 'SELECT t.* FROM tasks t WHERE t.org_id = ?';
            params.push(req.user.org_id);
        } else {
            query = 'SELECT t.* FROM tasks t INNER JOIN task_assignees ta ON ta.task_id = t.id WHERE ta.user_id = ?';
            params.push(req.user.id);
        }
        if (status && status !== 'all') { query += ' AND t.status = ?'; params.push(status); }
        if (org_id && isMudir) { query += ' AND t.org_id = ?'; params.push(parseInt(org_id)); }
        query += ' ORDER BY t.created_at DESC';

        const tasks = queryAll(query, params);
        const enriched = tasks.map(t => ({
            ...t, files: JSON.parse(t.files || '[]'),
            assignees: queryAll('SELECT u.id, u.full_name, u.role FROM task_assignees ta JOIN users u ON u.id = ta.user_id WHERE ta.task_id = ?', [t.id]),
            organization: t.org_id ? queryOne('SELECT * FROM organizations WHERE id = ?', [t.org_id]) : null,
            responses: queryAll(`SELECT tr.*, u.full_name FROM task_responses tr JOIN users u ON u.id = tr.user_id WHERE tr.task_id = ? ORDER BY tr.responded_at DESC`, [t.id]),
        }));
        res.json(enriched);
    } catch (err) { console.error('Tasks list error:', err); res.status(500).json({ error: 'Server xatosi' }); }
});

// GET /api/tasks/:id — task detail
router.get('/:id', authMiddleware, (req, res) => {
    try {
        const task = queryOne('SELECT * FROM tasks WHERE id = ?', [parseInt(req.params.id)]);
        if (!task) return res.status(404).json({ error: 'Topshiriq topilmadi' });

        const assignees = queryAll('SELECT u.id, u.full_name, u.role FROM task_assignees ta JOIN users u ON u.id = ta.user_id WHERE ta.task_id = ?', [task.id]);
        const responses = queryAll('SELECT tr.*, u.full_name FROM task_responses tr JOIN users u ON u.id = tr.user_id WHERE tr.task_id = ? ORDER BY tr.responded_at DESC', [task.id]);
        const org = task.org_id ? queryOne('SELECT * FROM organizations WHERE id = ?', [task.org_id]) : null;
        const creator = queryOne('SELECT id, full_name, role FROM users WHERE id = ?', [task.created_by]);
        const auditLogs = queryAll('SELECT al.*, u.full_name FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id WHERE al.entity = ? AND al.entity_id = ? ORDER BY al.timestamp DESC', ['task', task.id]);
        res.json({ ...task, files: JSON.parse(task.files || '[]'), assignees, responses, organization: org, creator, auditLogs });
    } catch (err) { console.error('Task detail error:', err); res.status(500).json({ error: 'Server xatosi' }); }
});

// POST /api/tasks — create task (mudir/admin) with file upload
router.post('/', authMiddleware, mudirOnly, upload.array('files', 5), (req, res) => {
    try {
        const { title, description, org_id, org_type, priority, category, deadline } = req.body;
        let assignees = req.body.assignees;

        // Parse assignees (may come as JSON string from FormData)
        if (typeof assignees === 'string') {
            try { assignees = JSON.parse(assignees); } catch (e) { assignees = [assignees]; }
        }
        if (!Array.isArray(assignees)) assignees = assignees ? [assignees] : [];
        assignees = assignees.map(a => parseInt(a)).filter(a => !isNaN(a));

        if (!title || !description || !deadline) return res.status(400).json({ error: 'Sarlavha, tavsif va muddat kiritilishi shart' });
        if (!assignees.length) return res.status(400).json({ error: 'Kamida 1 ijrochi tanlang' });

        // Process uploaded files
        const uploadedFiles = (req.files || []).map(f => ({
            url: '/uploads/' + f.filename,
            name: f.originalname,
            size: f.size,
            type: path.extname(f.originalname).toLowerCase()
        }));

        const now = new Date().toISOString();
        const info = runSql(
            'INSERT INTO tasks (title, description, org_id, org_type, priority, category, status, deadline, created_by, created_at, updated_at, files) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
            [title, description, org_id || null, org_type || null, priority || 'orta', category || null, 'yangi', deadline, req.user.id, now, now, JSON.stringify(uploadedFiles)]
        );
        const taskId = info.lastInsertRowid;

        assignees.forEach(uid => {
            runSql('INSERT INTO task_assignees (task_id, user_id) VALUES (?,?)', [taskId, uid]);
            runSql('INSERT INTO notifications (user_id, task_id, type, message) VALUES (?,?,?,?)', [uid, taskId, 'yangi_topshiriq', `Sizga yangi topshiriq: "${title}"`]);
        });
        runSql('INSERT INTO audit_logs (user_id, action, entity, entity_id, comment) VALUES (?,?,?,?,?)', [req.user.id, 'yaratish', 'task', taskId, `"${title}" topshiriq yaratildi`]);

        // Notify tashkilot user if org_id
        const parsedOrgId = parseInt(org_id);
        if (parsedOrgId) {
            const orgUser = queryOne('SELECT id FROM users WHERE org_id = ? AND role = ?', [parsedOrgId, 'tashkilot']);
            if (orgUser) {
                runSql('INSERT INTO notifications (user_id, task_id, type, message) VALUES (?,?,?,?)',
                    [orgUser.id, taskId, 'yangi_topshiriq', `Tashkilotingizga yangi topshiriq: "${title}"`]);
            }
        }

        // Send Telegram notification
        const orgObj = parsedOrgId ? queryOne('SELECT name FROM organizations WHERE id = ?', [parsedOrgId]) : null;
        notifyNewTask({ title, category, org_name: orgObj ? orgObj.name : '', deadline, priority: priority || 'orta' }).catch(() => { });
        addNotification('task', 'Yangi topshiriq', '"' + title + '" topshiriq yaratildi');

        res.status(201).json({ id: taskId, message: 'Topshiriq yaratildi', files: uploadedFiles });
    } catch (err) { console.error('Create task error:', err); res.status(500).json({ error: 'Server xatosi' }); }
});

// PATCH /api/tasks/:id/accept — ijrochi or tashkilot accepts task
router.patch('/:id/accept', authMiddleware, (req, res) => {
    try {
        const task = queryOne('SELECT * FROM tasks WHERE id = ?', [parseInt(req.params.id)]);
        if (!task) return res.status(404).json({ error: 'Topshiriq topilmadi' });

        // Check if user is assignee or tashkilot for this org
        const isAssignee = queryOne('SELECT 1 as ok FROM task_assignees WHERE task_id = ? AND user_id = ?', [task.id, req.user.id]);
        const isTashkilot = req.user.role === 'tashkilot' && task.org_id == req.user.org_id;
        if (!isAssignee && !isTashkilot) return res.status(403).json({ error: 'Ruxsat yo\'q' });

        runSql('INSERT INTO task_responses (task_id, user_id, status) VALUES (?,?,?)', [task.id, req.user.id, 'qabul']);
        runSql('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?', ['qabul_qilindi', new Date().toISOString(), task.id]);

        const user = queryOne('SELECT full_name FROM users WHERE id = ?', [req.user.id]);
        runSql('INSERT INTO audit_logs (user_id, action, entity, entity_id, comment) VALUES (?,?,?,?,?)',
            [req.user.id, 'qabul', 'task', task.id, `${user.full_name} topshiriqni qabul qildi`]);
        runSql('INSERT INTO notifications (user_id, task_id, type, message) VALUES (?,?,?,?)',
            [task.created_by, task.id, 'qabul', `${user.full_name} "${task.title}" topshiriqni qabul qildi`]);
        res.json({ message: 'Topshiriq qabul qilindi' });
    } catch (err) { console.error('Accept error:', err); res.status(500).json({ error: 'Server xatosi' }); }
});

// PATCH /api/tasks/:id/reject — reject task
router.patch('/:id/reject', authMiddleware, (req, res) => {
    try {
        const { reason } = req.body;
        if (!reason) return res.status(400).json({ error: 'Sabab kiritilishi shart' });
        const task = queryOne('SELECT * FROM tasks WHERE id = ?', [parseInt(req.params.id)]);
        if (!task) return res.status(404).json({ error: 'Topshiriq topilmadi' });

        const isAssignee = queryOne('SELECT 1 as ok FROM task_assignees WHERE task_id = ? AND user_id = ?', [task.id, req.user.id]);
        const isTashkilot = req.user.role === 'tashkilot' && task.org_id == req.user.org_id;
        if (!isAssignee && !isTashkilot) return res.status(403).json({ error: 'Ruxsat yo\'q' });

        runSql('INSERT INTO task_responses (task_id, user_id, status, reason) VALUES (?,?,?,?)', [task.id, req.user.id, 'rad', reason]);
        runSql('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?', ['rad_etildi', new Date().toISOString(), task.id]);

        const user = queryOne('SELECT full_name FROM users WHERE id = ?', [req.user.id]);
        runSql('INSERT INTO audit_logs (user_id, action, entity, entity_id, comment) VALUES (?,?,?,?,?)',
            [req.user.id, 'rad_etish', 'task', task.id, `${user.full_name} rad etdi: ${reason}`]);
        runSql('INSERT INTO notifications (user_id, task_id, type, message) VALUES (?,?,?,?)',
            [task.created_by, task.id, 'rad', `${user.full_name} "${task.title}" topshiriqni rad etdi: ${reason}`]);
        res.json({ message: 'Topshiriq rad etildi' });
    } catch (err) { console.error('Reject error:', err); res.status(500).json({ error: 'Server xatosi' }); }
});

// POST /api/tasks/:id/respond — submit response with file upload
router.post('/:id/respond', authMiddleware, upload.single('file'), (req, res) => {
    try {
        const task = queryOne('SELECT * FROM tasks WHERE id = ?', [parseInt(req.params.id)]);
        if (!task) return res.status(404).json({ error: 'Topshiriq topilmadi' });

        const isAssignee = queryOne('SELECT 1 as ok FROM task_assignees WHERE task_id = ? AND user_id = ?', [task.id, req.user.id]);
        const isTashkilot = req.user.role === 'tashkilot' && task.org_id == req.user.org_id;
        if (!isAssignee && !isTashkilot) return res.status(403).json({ error: 'Ruxsat yo\'q' });

        const report = req.body.report || '';
        const fileUrl = req.file ? '/uploads/' + req.file.filename : null;
        const fileName = req.file ? req.file.originalname : null;

        runSql('INSERT INTO task_responses (task_id, user_id, status, report, reason) VALUES (?,?,?,?,?)',
            [task.id, req.user.id, 'javob_yuborildi', report, fileUrl ? JSON.stringify({ url: fileUrl, name: fileName }) : null]);

        runSql('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?', ['javob_kutilmoqda', new Date().toISOString(), task.id]);

        const user = queryOne('SELECT full_name FROM users WHERE id = ?', [req.user.id]);
        runSql('INSERT INTO audit_logs (user_id, action, entity, entity_id, comment) VALUES (?,?,?,?,?)',
            [req.user.id, 'javob_yuborish', 'task', task.id, `${user.full_name} javob yubordi${fileName ? ': ' + fileName : ''}`]);

        // Notify admin/mudir
        const admins = queryAll("SELECT id FROM users WHERE role IN ('admin','mudir')");
        admins.forEach(a => {
            runSql('INSERT INTO notifications (user_id, task_id, type, message) VALUES (?,?,?,?)',
                [a.id, task.id, 'javob', `${user.full_name} "${task.title}" topshiriqga javob yubordi`]);
        });

        // Telegram notification
        notifyResponse(task, user.full_name).catch(() => { });
        addNotification('response', 'Javob keldi', user.full_name + ' "' + task.title + '" ga javob yubordi');

        res.json({ message: 'Javob muvaffaqiyatli yuborildi', file: fileUrl });
    } catch (err) { console.error('Respond error:', err); res.status(500).json({ error: 'Server xatosi' }); }
});

// PATCH /api/tasks/:id/review — admin reviews response (accept/reject)
router.patch('/:id/review', authMiddleware, mudirOnly, (req, res) => {
    try {
        const { action, comment } = req.body; // action: 'tasdiqlash' or 'qaytarish'
        if (!['tasdiqlash', 'qaytarish'].includes(action)) return res.status(400).json({ error: 'Noto\'g\'ri amal' });

        const task = queryOne('SELECT * FROM tasks WHERE id = ?', [parseInt(req.params.id)]);
        if (!task) return res.status(404).json({ error: 'Topshiriq topilmadi' });

        const newStatus = action === 'tasdiqlash' ? 'bajarildi' : 'qayta_ishlash';
        runSql('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?', [newStatus, new Date().toISOString(), task.id]);

        const user = queryOne('SELECT full_name FROM users WHERE id = ?', [req.user.id]);
        const actionText = action === 'tasdiqlash' ? 'tasdiqladi' : 'qayta ishlashga qaytardi';
        runSql('INSERT INTO audit_logs (user_id, action, entity, entity_id, comment) VALUES (?,?,?,?,?)',
            [req.user.id, action, 'task', task.id, `${user.full_name} javobni ${actionText}${comment ? ': ' + comment : ''}`]);

        // Notify the org user and assignees
        if (task.org_id) {
            const orgUser = queryOne('SELECT id FROM users WHERE org_id = ? AND role = ?', [task.org_id, 'tashkilot']);
            if (orgUser) {
                runSql('INSERT INTO notifications (user_id, task_id, type, message) VALUES (?,?,?,?)',
                    [orgUser.id, task.id, action, `"${task.title}" topshiriq javobi ${actionText}${comment ? ': ' + comment : ''}`]);
            }
        }
        const assignees = queryAll('SELECT user_id FROM task_assignees WHERE task_id = ?', [task.id]);
        assignees.forEach(a => {
            runSql('INSERT INTO notifications (user_id, task_id, type, message) VALUES (?,?,?,?)',
                [a.user_id, task.id, action, `"${task.title}" topshiriq javobi ${actionText}`]);
        });

        const statusEmoji = action === 'tasdiqlash' ? '✅' : '🔄';
        addNotification(action === 'tasdiqlash' ? 'success' : 'warning', statusEmoji + ' Topshiriq ' + actionText, '"' + task.title + '" ' + actionText);

        res.json({ message: action === 'tasdiqlash' ? 'Javob tasdiqlandi' : 'Qayta ishlashga qaytarildi' });
    } catch (err) { console.error('Review error:', err); res.status(500).json({ error: 'Server xatosi' }); }
});

// PATCH /api/tasks/:id/complete — mark task as complete (legacy)
router.patch('/:id/complete', authMiddleware, (req, res) => {
    try {
        const { report } = req.body;
        const task = queryOne('SELECT * FROM tasks WHERE id = ?', [parseInt(req.params.id)]);
        if (!task) return res.status(404).json({ error: 'Topshiriq topilmadi' });
        const isAssignee = queryOne('SELECT 1 as ok FROM task_assignees WHERE task_id = ? AND user_id = ?', [task.id, req.user.id]);
        if (!isAssignee) return res.status(403).json({ error: 'Ruxsat yo\'q' });

        runSql('INSERT INTO task_responses (task_id, user_id, status, report) VALUES (?,?,?,?)', [task.id, req.user.id, 'bajarildi', report || '']);
        runSql('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?', ['bajarildi', new Date().toISOString(), task.id]);
        const user = queryOne('SELECT full_name FROM users WHERE id = ?', [req.user.id]);
        runSql('INSERT INTO audit_logs (user_id, action, entity, entity_id, comment) VALUES (?,?,?,?,?)',
            [req.user.id, 'bajarish', 'task', task.id, `${user.full_name} topshiriqni bajardi`]);
        runSql('INSERT INTO notifications (user_id, task_id, type, message) VALUES (?,?,?,?)',
            [task.created_by, task.id, 'bajarildi', `${user.full_name} "${task.title}" topshiriqni bajardi`]);
        res.json({ message: 'Topshiriq bajarildi' });
    } catch (err) { console.error('Complete error:', err); res.status(500).json({ error: 'Server xatosi' }); }
});

module.exports = router;
