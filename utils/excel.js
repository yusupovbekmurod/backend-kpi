const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');
const { queryAll } = require('../db/schema');

async function generateTasksExcel(filter = {}) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Sirdaryo KPI Tizimi';
    workbook.created = new Date();

    // Sheet 1: Barcha topshiriqlar
    const ws = workbook.addWorksheet('Topshiriqlar', {
        headerFooter: { firstHeader: 'Sirdaryo KPI — Topshiriqlar hisoboti' }
    });

    ws.columns = [
        { header: '#', key: 'id', width: 6 },
        { header: 'Sarlavha', key: 'title', width: 35 },
        { header: 'Kategoriya', key: 'category', width: 18 },
        { header: 'Tashkilot', key: 'org_name', width: 35 },
        { header: 'Muddat', key: 'deadline', width: 20 },
        { header: 'Prioritet', key: 'priority', width: 14 },
        { header: 'Holat', key: 'status', width: 20 },
        { header: 'Yaratilgan', key: 'created_at', width: 20 },
    ];

    // Style header
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A2236' } };
    ws.getRow(1).alignment = { horizontal: 'center' };

    let query = `SELECT t.*, o.name as org_name FROM tasks t LEFT JOIN organizations o ON o.id = t.org_id`;
    const params = [];
    if (filter.status) { query += ' WHERE t.status = ?'; params.push(filter.status); }
    query += ' ORDER BY t.deadline ASC';

    const tasks = queryAll(query, params);

    const statusMap = { yangi: 'Yangi', qabul_qilindi: 'Qabul qilindi', bajarilmoqda: 'Bajarilmoqda', bajarildi: 'Bajarildi', rad_etildi: 'Rad etildi', muddati_otgan: "Muddati o'tgan", javob_kutilmoqda: 'Javob kutilmoqda', qayta_ishlash: 'Qayta ishlash' };
    const priorityMap = { past: 'Past', orta: "O'rta", yuqori: 'Yuqori', juda_muhim: 'Juda muhim' };

    tasks.forEach(t => {
        const row = ws.addRow({
            id: t.id,
            title: t.title,
            category: t.category || '',
            org_name: t.org_name || '—',
            deadline: t.deadline,
            priority: priorityMap[t.priority] || t.priority,
            status: statusMap[t.status] || t.status,
            created_at: t.created_at,
        });

        // Color code by status
        if (t.status === 'muddati_otgan') row.getCell('status').font = { color: { argb: 'FFEF4444' }, bold: true };
        else if (t.status === 'bajarildi') row.getCell('status').font = { color: { argb: 'FF10B981' } };
        else if (t.status === 'javob_kutilmoqda') row.getCell('status').font = { color: { argb: 'FF8B5CF6' } };

        // Priority colors
        if (t.priority === 'juda_muhim') row.getCell('priority').font = { color: { argb: 'FFEF4444' }, bold: true };
        else if (t.priority === 'yuqori') row.getCell('priority').font = { color: { argb: 'FFF59E0B' } };
    });

    // Auto filter
    ws.autoFilter = { from: 'A1', to: 'H1' };

    // Borders
    ws.eachRow((row) => {
        row.eachCell((cell) => {
            cell.border = {
                top: { style: 'thin', color: { argb: 'FFD0D0D0' } },
                left: { style: 'thin', color: { argb: 'FFD0D0D0' } },
                bottom: { style: 'thin', color: { argb: 'FFD0D0D0' } },
                right: { style: 'thin', color: { argb: 'FFD0D0D0' } },
            };
        });
    });

    // Summary row
    ws.addRow([]);
    const summaryRow = ws.addRow(['', 'Jami topshiriqlar:', tasks.length, '', 'Sana:', new Date().toLocaleDateString('uz-UZ')]);
    summaryRow.font = { bold: true, italic: true };

    // Save to temp file
    const tmpDir = path.join(__dirname, '..', 'uploads');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const fileName = 'topshiriqlar_' + new Date().toISOString().slice(0, 10) + '.xlsx';
    const filePath = path.join(tmpDir, fileName);
    await workbook.xlsx.writeFile(filePath);

    return { filePath, fileName };
}

module.exports = { generateTasksExcel };
