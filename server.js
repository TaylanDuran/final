const http = require('http');
const fs = require('fs');
const path = require('path');

/*
 * A simple backend for the personal training website.
 *
 * This server serves static files from the public directory and exposes
 * JSON endpoints for managing clients, training programs and support
 * tickets. Data is stored in a JSON file on disk (database.json) to
 * simplify deployment in environments without an external database. To
 * start the server locally, run `node server.js` from within the
 * personal_training directory.  The server listens on port 3000 by
 * default.
 */

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'database.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Directory to store uploaded files for ticket attachments. Exposed under /uploads via static serving.
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads');


// Ensure database file exists with default structure
function initDB() {
  if (!fs.existsSync(DB_PATH)) {
    const data = {
      admin: { username: 'admin', password: 'admin123' },
      // clients include optional duration (in months) and active flag
      clients: [],
      programs: [],
      tickets: [],
      // store a list of recipes; each recipe contains id, title, ingredients and instructions
      recipes: []
    };
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
  }
  // Ensure uploads directory exists for attachments
  try {
    if (!fs.existsSync(UPLOAD_DIR)) {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    }
  } catch (err) {
    console.error('Failed to create upload directory:', err);
  }
}

function loadDB() {
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function saveDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function serveStatic(req, res) {
  let reqPath = req.url;
  if (reqPath === '/' || reqPath === '') reqPath = '/index.html';
  const safePath = path.normalize(reqPath).replace(/^\/+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.gif': 'image/gif',
    '.pdf': 'application/pdf'
  };
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => (data += chunk));
    req.on('end', () => {
      if (data) {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          reject(new Error('Invalid JSON'));
        }
      } else {
        resolve({});
      }
    });
    req.on('error', err => reject(err));
  });
}

function handleAPI(req, res) {
  const { method, url } = req;
  // Admin login
  if (url === '/api/login' && method === 'POST') {
    return parseBody(req)
      .then(body => {
        const db = loadDB();
        const success = body.username === db.admin.username && body.password === db.admin.password;
        res.writeHead(success ? 200 : 401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success }));
      })
      .catch(err => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
  }
  // Clients endpoints
  if (url === '/api/clients' && method === 'GET') {
    const db = loadDB();
    const now = new Date();
    let updated = false;
    db.clients.forEach(client => {
      // calculate days left based on startDate and duration
      if (client.startDate && client.duration) {
        const start = new Date(client.startDate);
        const end = new Date(start);
        end.setMonth(end.getMonth() + parseInt(client.duration));
        const diffMs = end.getTime() - now.getTime();
        const daysLeft = Math.ceil(diffMs / (1000 * 3600 * 24));
        client.daysLeft = daysLeft > 0 ? daysLeft : 0;
        // update active based on expiry
        if (client.active && daysLeft <= 0) {
          client.active = false;
          updated = true;
        }
      } else {
        client.daysLeft = null;
      }
    });
    if (updated) {
      saveDB(db);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(db.clients));
    return;
  }
  if (url === '/api/clients' && method === 'POST') {
    return parseBody(req)
      .then(body => {
        const { name, email, startDate, active, duration } = body;
        if (!name || !email) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'name and email required' }));
          return;
        }
        const db = loadDB();
        const id = Date.now().toString(36);
        db.clients.push({
          id,
          name,
          email,
          startDate: startDate || new Date().toISOString().split('T')[0],
          active: active !== false,
          duration: duration || null
        });
        saveDB(db);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id }));
      })
      .catch(err => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
  }
  // Programs endpoints
  if (url === '/api/programs' && method === 'GET') {
    const db = loadDB();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(db.programs));
    return;
  }
  if (url === '/api/programs' && method === 'POST') {
    return parseBody(req)
      .then(body => {
        const { title, description, image } = body;
        if (!title) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'title required' }));
          return;
        }
        const db = loadDB();
        const id = Date.now().toString(36);
        db.programs.push({
          id,
          title,
          description: description || '',
          image: image || null
        });
        saveDB(db);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id }));
      })
      .catch(err => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
  }
  // Tickets endpoints (reuse from previous version)
  if (url === '/api/tickets' && method === 'GET') {
    const db = loadDB();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(db.tickets));
    return;
  }
  if (url === '/api/support/create' && method === 'POST') {
    return parseBody(req)
      .then(body => {
        const { email, password, message, file, fileName } = body;
        if (!email || !password) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'email and password required' }));
          return;
        }
        const db = loadDB();
        const id = Date.now().toString(36);
        // initialise ticket with open status and optional first message/attachment
        const ticket = {
          id,
          email,
          password,
          created: new Date().toISOString(),
          status: 'open',
          messages: []
        };
        // if there is text or file, create initial message
        if (message || (file && fileName)) {
          const msg = { sender: 'client', time: new Date().toISOString() };
          if (message) msg.text = message;
          if (file && fileName) {
            try {
              let base64Data = file;
              const commaIndex = base64Data.indexOf(',');
              if (commaIndex !== -1) base64Data = base64Data.substring(commaIndex + 1);
              const buffer = Buffer.from(base64Data, 'base64');
              const safeName = Date.now().toString(36) + '_' + fileName.replace(/[^A-Za-z0-9_.-]/g, '');
              const uploadPath = path.join(UPLOAD_DIR, safeName);
              fs.writeFileSync(uploadPath, buffer);
              msg.attachment = '/uploads/' + safeName;
            } catch (err) {
              console.error('Failed to save attachment:', err);
            }
          }
          ticket.messages.push(msg);
        }
        db.tickets.push(ticket);
        saveDB(db);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(ticket));
      })
      .catch(err => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
  }
  // Single ticket
  if (method === 'GET' && url.startsWith('/api/tickets/')) {
    const parts = url.split('/');
    const id = parts[3];
    const db = loadDB();
    const ticket = db.tickets.find(t => t.id === id);
    if (!ticket) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(ticket));
    return;
  }
  // Add message to ticket
  if (method === 'POST' && url.startsWith('/api/tickets/')) {
    const parts = url.split('/');
    const id = parts[3];
    if (parts[4] === 'message') {
      return parseBody(req)
        .then(body => {
          const { sender, text, file, fileName } = body;
          if (!text && !file) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'text or file required' }));
            return;
          }
          const db = loadDB();
          const ticket = db.tickets.find(t => t.id === id);
          if (!ticket) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'not found' }));
            return;
          }
          const msg = { sender: sender || 'client', time: new Date().toISOString() };
          if (text) msg.text = text;
          // handle attachment if provided
          if (file && fileName) {
            try {
              // base64 string may include prefix like data:...;base64,
              let base64Data = file;
              const commaIndex = base64Data.indexOf(',');
              if (commaIndex !== -1) {
                base64Data = base64Data.substring(commaIndex + 1);
              }
              const buffer = Buffer.from(base64Data, 'base64');
              const safeName = Date.now().toString(36) + '_' + fileName.replace(/[^A-Za-z0-9_.-]/g, '');
              const uploadPath = path.join(UPLOAD_DIR, safeName);
              fs.writeFileSync(uploadPath, buffer);
              // store relative path for client to access
              msg.attachment = '/uploads/' + safeName;
            } catch (err) {
              console.error('Failed to save attachment:', err);
            }
          }
          ticket.messages.push(msg);
          saveDB(db);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        })
        .catch(err => {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        });
    }
  }

  // Update ticket (e.g., close or reopen)
  if (method === 'PUT' && url.startsWith('/api/tickets/')) {
    const parts = url.split('/');
    const id = parts[3];
    return parseBody(req)
      .then(body => {
        const { status } = body;
        const db = loadDB();
        const ticket = db.tickets.find(t => t.id === id);
        if (!ticket) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'not found' }));
          return;
        }
        if (status) {
          const oldStatus = ticket.status || 'open';
          ticket.status = status;
          // If closing the ticket and it wasn't already closed, append system message
          if (status === 'closed' && oldStatus !== 'closed') {
            // mark closure as admin message so it appears from admin
            ticket.messages.push({ sender: 'admin', text: 'Destek talebiniz kapatıldı.', time: new Date().toISOString() });
          }
          // If reopening the ticket and it was closed, append admin message
          if (status === 'open' && oldStatus === 'closed') {
            ticket.messages.push({ sender: 'admin', text: 'Destek talebiniz yeniden açıldı.', time: new Date().toISOString() });
          }
        }
        saveDB(db);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      })
      .catch(err => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
  }
  // Delete a ticket entirely
  if (method === 'DELETE' && url.startsWith('/api/tickets/')) {
    const parts = url.split('/');
    const id = parts[3];
    const db = loadDB();
    const index = db.tickets.findIndex(t => t.id === id);
    if (index === -1) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    db.tickets.splice(index, 1);
    saveDB(db);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // Recipes endpoints
  if (url === '/api/recipes' && method === 'GET') {
    const db = loadDB();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(db.recipes || []));
    return;
  }
  if (url === '/api/recipes' && method === 'POST') {
    return parseBody(req)
      .then(body => {
        const { title, ingredients, instructions, image } = body;
        if (!title) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'title required' }));
          return;
        }
        const db = loadDB();
        const id = Date.now().toString(36);
        db.recipes.push({
          id,
          title,
          ingredients: ingredients || '',
          instructions: instructions || '',
          image: image || null
        });
        saveDB(db);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id }));
      })
      .catch(err => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
  }

  // Update existing recipe
  if (method === 'PUT' && url.startsWith('/api/recipes/')) {
    const parts = url.split('/');
    const id = parts[3];
    return parseBody(req)
      .then(body => {
        const db = loadDB();
        const recipe = db.recipes.find(r => r.id === id);
        if (!recipe) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'not found' }));
          return;
        }
        const { title, ingredients, instructions, image } = body;
        if (title !== undefined) recipe.title = title;
        if (ingredients !== undefined) recipe.ingredients = ingredients;
        if (instructions !== undefined) recipe.instructions = instructions;
        if (image !== undefined) recipe.image = image;
        saveDB(db);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      })
      .catch(err => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
  }

  // Delete a recipe
  if (method === 'DELETE' && url.startsWith('/api/recipes/')) {
    const parts = url.split('/');
    const id = parts[3];
    const db = loadDB();
    const index = db.recipes.findIndex(r => r.id === id);
    if (index === -1) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    db.recipes.splice(index, 1);
    saveDB(db);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // User: fetch latest ticket by email/password (for clients to check status)
  if (method === 'GET' && url.startsWith('/api/user/ticket')) {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    const email = urlObj.searchParams.get('email');
    const password = urlObj.searchParams.get('password');
    if (!email || !password) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'email and password required' }));
      return;
    }
    const db = loadDB();
    // find most recent ticket matching email and password
    const tickets = db.tickets.filter(t => t.email === email && t.password === password);
    if (tickets.length === 0) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'no tickets found' }));
      return;
    }
    // sort by created date desc
    tickets.sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime());
    const ticket = tickets[0];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(ticket));
    return;
  }
  // Default 404 for API
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'unknown endpoint' }));
}

function requestHandler(req, res) {
  if (req.url.startsWith('/api/')) {
    return handleAPI(req, res);
  }
  return serveStatic(req, res);
}

initDB();
const server = http.createServer(requestHandler);
server.listen(PORT, () => {
  console.log(`Personal training server running at http://localhost:${PORT}`);
});