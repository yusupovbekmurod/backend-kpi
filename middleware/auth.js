const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'sirdaryo-kpi-secret-2026';
const JWT_EXPIRES = '24h';

function generateToken(user) {
    return jwt.sign(
        { id: user.id, username: user.username, role: user.role, org_id: user.org_id },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES }
    );
}

function authMiddleware(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token topilmadi' });
    }
    try {
        req.user = jwt.verify(header.split(' ')[1], JWT_SECRET);
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Token yaroqsiz yoki muddati tugagan' });
    }
}

function adminOnly(req, res, next) {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Faqat admin uchun ruxsat' });
    next();
}

function mudirOnly(req, res, next) {
    if (!['admin', 'mudir'].includes(req.user.role)) return res.status(403).json({ error: 'Faqat mudir uchun ruxsat' });
    next();
}

module.exports = { generateToken, authMiddleware, adminOnly, mudirOnly, JWT_SECRET };
