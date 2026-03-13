const initSqlJs = require('sql.js');
const fs = require('fs');
async function test() {
    const SQL = await initSqlJs();
    const db = new SQL.Database(fs.readFileSync('data/kpi.db'));
    console.log("TABLE INFO:");
    console.log(JSON.stringify(db.exec("PRAGMA table_info(tasks)"), null, 2));
    console.log("LATEST TASKS:");
    console.log(JSON.stringify(db.exec("SELECT id, title, doc_type FROM tasks ORDER BY id DESC LIMIT 5"), null, 2));
}
test();
