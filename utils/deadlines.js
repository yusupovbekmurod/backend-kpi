const { queryAll, queryOne, runSql } = require('../db/schema');

function checkDeadlines() {
    try {
        const now = new Date().toISOString();

        const overdueTasks = queryAll(`
      SELECT * FROM tasks
      WHERE status NOT IN ('bajarildi','muddati_otgan')
        AND deadline IS NOT NULL
        AND datetime(deadline) < datetime('now')
    `);

        overdueTasks.forEach(task => {
            runSql("UPDATE tasks SET status = 'muddati_otgan', updated_at = ? WHERE id = ?", [now, task.id]);
            runSql('INSERT INTO audit_logs (user_id, action, entity, entity_id, comment) VALUES (?,?,?,?,?)',
                [0, 'eskalatsiya', 'task', task.id, `"${task.title}" muddati o'tdi — eskalatsiya`]);
            runSql('INSERT INTO notifications (user_id, task_id, type, message) VALUES (?,?,?,?)',
                [task.created_by, task.id, 'eskalatsiya', `⚠️ "${task.title}" muddati o'tdi!`]);
        });

        const approachingTasks = queryAll(`
      SELECT t.* FROM tasks t
      WHERE t.status NOT IN ('bajarildi','muddati_otgan')
        AND t.deadline IS NOT NULL
        AND julianday(t.deadline) - julianday('now') BETWEEN 0 AND 2
    `);

        approachingTasks.forEach(task => {
            const existing = queryOne("SELECT 1 as ok FROM notifications WHERE task_id = ? AND type = 'ogohlantirish'", [task.id]);
            if (!existing) {
                const assignees = queryAll('SELECT user_id FROM task_assignees WHERE task_id = ?', [task.id]);
                const daysLeft = Math.ceil((new Date(task.deadline) - Date.now()) / 86400000);
                assignees.forEach(a => {
                    runSql('INSERT INTO notifications (user_id, task_id, type, message) VALUES (?,?,?,?)',
                        [a.user_id, task.id, 'ogohlantirish', `⏰ "${task.title}" — ${daysLeft} kun qoldi!`]);
                });
                runSql('INSERT INTO audit_logs (user_id, action, entity, entity_id, comment) VALUES (?,?,?,?,?)',
                    [0, 'ogohlantirish', 'task', task.id, `"${task.title}" — muddatga ${daysLeft} kun qoldi`]);
            }
        });

        if (overdueTasks.length > 0 || approachingTasks.length > 0) {
            console.log(`⏰ Deadline check: ${overdueTasks.length} overdue, ${approachingTasks.length} approaching`);
        }
    } catch (err) {
        console.error('Deadline check error:', err);
    }
}

module.exports = { checkDeadlines };
