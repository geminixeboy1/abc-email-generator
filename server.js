const express = require('express');
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4000;
const DB_PATH = path.join(__dirname, 'emails.db');

// ── Middleware ──────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ── Database Setup ─────────────────────────────────────────
let db;

async function initDb() {
  const SQL = await initSqlJs();

  // Load existing DB file if present
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS emails (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name  TEXT NOT NULL,
      last_name   TEXT NOT NULL,
      email       TEXT NOT NULL UNIQUE,
      created_at  DATETIME NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_emails_email ON emails(email)`);
  saveDb();
}

function saveDb() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// ── Helpers ────────────────────────────────────────────────
function generateEmail(firstName, lastName) {
  const first = firstName.trim().toLowerCase().replace(/[^a-z]/g, '');
  const last = lastName.trim().toLowerCase().replace(/[^a-z]/g, '');
  return first + '.' + last + '@abc.com';
}

function validateName(name) {
  return name && typeof name === 'string' && /^[a-zA-Z\s'-]+$/.test(name.trim()) && name.trim().length > 0;
}

// ── API Routes ─────────────────────────────────────────────

// POST /api/emails — generate and save a new email
app.post('/api/emails', (req, res) => {
  const firstName = (req.body.firstName || '').trim();
  const lastName = (req.body.lastName || '').trim();

  if (!validateName(firstName)) {
    return res.status(400).json({ success: false, error: 'Please enter a valid first name (letters only).' });
  }
  if (!validateName(lastName)) {
    return res.status(400).json({ success: false, error: 'Please enter a valid last name (letters only).' });
  }

  const email = generateEmail(firstName, lastName);

  try {
    const existing = db.exec(`SELECT * FROM emails WHERE email = ?`, [email]);
    if (existing.length > 0 && existing[0].values.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'Email ' + email + ' already exists in the database.'
      });
    }

    db.run(`INSERT INTO emails (first_name, last_name, email) VALUES (?, ?, ?)`, [firstName, lastName, email]);
    saveDb();

    const lastId = db.exec(`SELECT last_insert_rowid() as id`);
    const id = lastId[0].values[0][0];

    const record = { id, first_name: firstName, last_name: lastName, email };

    return res.status(201).json({ success: true, message: 'Email generated and saved!', record });
  } catch (err) {
    console.error('Insert error:', err.message);
    return res.status(500).json({ success: false, error: 'Something went wrong. Please try again.' });
  }
});

// GET /api/emails — list all records (report)
app.get('/api/emails', (req, res) => {
  try {
    const result = db.exec(`SELECT * FROM emails ORDER BY created_at DESC`);
    const countResult = db.exec(`SELECT COUNT(*) as count FROM emails`);
    const count = countResult.length > 0 ? countResult[0].values[0][0] : 0;

    let records = [];
    if (result.length > 0) {
      const columns = result[0].columns;
      records = result[0].values.map(row => {
        const obj = {};
        columns.forEach((col, i) => { obj[col] = row[i]; });
        return obj;
      });
    }

    return res.json({
      success: true,
      count,
      uniqueDomains: 1,
      records
    });
  } catch (err) {
    console.error('List error:', err.message);
    return res.status(500).json({ success: false, error: 'Something went wrong.' });
  }
});

// DELETE /api/emails/:id — delete a record
app.delete('/api/emails/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({ success: false, error: 'Invalid ID.' });
  }

  try {
    const before = db.exec(`SELECT COUNT(*) FROM emails WHERE id = ?`, [id]);
    const exists = before.length > 0 && before[0].values[0][0] > 0;

    if (!exists) {
      return res.status(404).json({ success: false, error: 'Record not found.' });
    }

    db.run(`DELETE FROM emails WHERE id = ?`, [id]);
    saveDb();

    return res.json({ success: true, message: 'Record deleted.' });
  } catch (err) {
    console.error('Delete error:', err.message);
    return res.status(500).json({ success: false, error: 'Something went wrong.' });
  }
});

// ── Serve index for all other routes ───────────────────────
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── Graceful shutdown ──────────────────────────────────────
process.on('SIGINT', () => { if (db) db.close(); process.exit(0); });
process.on('SIGTERM', () => { if (db) db.close(); process.exit(0); });

// ── Start ──────────────────────────────────────────────────
initDb().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log('ABC Email Generator running at http://localhost:' + PORT);
    console.log('API:');
    console.log('  POST   /api/emails      — Generate & save email');
    console.log('  GET    /api/emails       — List all records');
    console.log('  DELETE /api/emails/:id   — Delete a record');
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
