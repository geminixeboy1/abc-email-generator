const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4000;

// ── Middleware ──────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ── Database Setup ─────────────────────────────────────────
const db = new Database(path.join(__dirname, 'emails.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS emails (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name  TEXT NOT NULL,
    last_name   TEXT NOT NULL,
    email       TEXT NOT NULL UNIQUE,
    created_at  DATETIME NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_emails_email ON emails(email);
`);

// Prepared statements
const stmts = {
  insert: db.prepare(`
    INSERT INTO emails (first_name, last_name, email) VALUES (@first_name, @last_name, @email)
  `),
  findByEmail: db.prepare(`SELECT * FROM emails WHERE email = @email`),
  listAll: db.prepare(`SELECT * FROM emails ORDER BY created_at DESC`),
  count: db.prepare(`SELECT COUNT(*) as count FROM emails`),
  deleteById: db.prepare(`DELETE FROM emails WHERE id = @id`),
};

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
    const existing = stmts.findByEmail.get({ email });
    if (existing) {
      return res.status(409).json({
        success: false,
        error: 'Email ' + email + ' already exists in the database.'
      });
    }

    const result = stmts.insert.run({
      first_name: firstName,
      last_name: lastName,
      email: email
    });

    const record = {
      id: result.lastInsertRowid,
      first_name: firstName,
      last_name: lastName,
      email: email
    };

    return res.status(201).json({ success: true, message: 'Email generated and saved!', record });
  } catch (err) {
    console.error('Insert error:', err.message);
    return res.status(500).json({ success: false, error: 'Something went wrong. Please try again.' });
  }
});

// GET /api/emails — list all records (report)
app.get('/api/emails', (req, res) => {
  try {
    const records = stmts.listAll.all();
    const { count } = stmts.count.get();
    return res.json({
      success: true,
      count,
      uniqueDomains: 1, // always abc.com
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
    const result = stmts.deleteById.run({ id });
    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: 'Record not found.' });
    }
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
process.on('SIGINT', () => { db.close(); process.exit(0); });
process.on('SIGTERM', () => { db.close(); process.exit(0); });

// ── Start ──────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('ABC Email Generator running at http://localhost:' + PORT);
  console.log('API:');
  console.log('  POST   /api/emails      — Generate & save email');
  console.log('  GET    /api/emails       — List all records');
  console.log('  DELETE /api/emails/:id   — Delete a record');
});
