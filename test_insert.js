const { initializeDatabase, runSql, getDb } = require('./db/schema');
async function test() {
    await getDb();
    runSql("INSERT INTO tasks (title, description, status, priority, doc_type) VALUES ('Test Prezident', 'Test', 'yangi', 'orta', 'Prezident hujjatlari')");
    console.log("Inserted!");
}
test();
