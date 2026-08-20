const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const PORT = process.env.PORT || 3001;

// ── Docker commands via CLI ─────────────────────────────────────
async function dockerRun(...args) {
  try {
    const { stdout } = await execAsync(`docker ${args.join(' ')}`, { timeout: 30000 });
    return { ok: true, data: stdout };
  } catch (err) {
    return { ok: false, error: err.stderr || err.message };
  }
}

// ── Parse docker ps output (no --format, use plain table) ─────
function parseContainerTable(text) {
  const lines = text.trim().split('\n').filter(Boolean);
  if (lines.length < 2) return [];
  const containers = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = lines[i].split(/\s{2,}/);
    if (fields.length >= 5) {
      const name = fields[0].replace(/^\//, '');
      const image = fields[1];
      const command = fields[2];
      const created = fields[3];
      const status = fields[4];
      const ports = fields.slice(5).join(' ').trim();
      containers.push({
        id: name.split('_')[0] || name.slice(0, 12),
        name,
        image,
        command,
        created,
        status,
        ports: ports || '',
        running: !status.includes('Exited'),
      });
    }
  }
  return containers;
}

// ── List containers ─────────────────────────────────────────────
async function listContainers(all = false) {
  const args = all ? ['ps', '-a'] : ['ps'];
  const { ok, data, error } = await dockerRun(...args);
  if (!ok) return { error };
  return parseContainerTable(data);
}

// ── Container actions ──────────────────────────────────────────
async function startContainer(id) { return dockerRun('start', id); }
async function stopContainer(id) { return dockerRun('stop', id); }
async function restartContainer(id) { return dockerRun('restart', id); }
async function removeContainer(id, force = false) { return dockerRun('rm', force ? ['-f', id] : [id]); }

// ── Container logs ─────────────────────────────────────────────
async function getLogs(id, tail = 100) {
  const { ok, data, error } = await dockerRun('logs', '--tail', String(tail), id);
  if (!ok) return { error };
  return data;
}

// ── Images ──────────────────────────────────────────────────────
function parseImageTable(text) {
  const lines = text.trim().split('\n').filter(Boolean);
  if (lines.length < 2) return [];
  const images = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = lines[i].split(/\s{2,}/);
    if (fields.length >= 4) {
      images.push({
        id: fields[2].slice(0, 12),
        repo: fields[0],
        tag: fields[1] || 'latest',
        size: fields[3],
      });
    }
  }
  return images;
}

async function listImages() {
  const { ok, data, error } = await dockerRun('images');
  if (!ok) return { error };
  return parseImageTable(data);
}

async function pullImage(image) {
  return dockerRun('pull', image);
}

// ── Script Community ────────────────────────────────────────────
const SCRIPTS_DIR = path.join(__dirname, 'scripts');

async function listScripts() {
  if (!fs.existsSync(SCRIPTS_DIR)) return [];
  const entries = fs.readdirSync(SCRIPTS_DIR, { withFileTypes: true });
  const scripts = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(SCRIPTS_DIR, entry.name);
    const metaPath = path.join(dir, 'meta.json');
    try {
      if (fs.existsSync(metaPath)) {
        scripts.push(JSON.parse(fs.readFileSync(metaPath, 'utf-8')));
      } else {
        scripts.push({ name: entry.name, description: 'Community script' });
      }
    } catch {}
  }
  return scripts;
}

async function deployScript(name) {
  const dir = path.join(SCRIPTS_DIR, name);
  const composePath = path.join(dir, 'docker-compose.yml');
  if (!fs.existsSync(composePath)) return { error: `No docker-compose.yml for ${name}` };
  try {
    const { stdout } = await execAsync(`cd "${dir.replace(/\\/g, '/')}" && /usr/local/bin/docker-compose up -d`, { timeout: 120000 });
    return { success: true, output: stdout };
  } catch (err) {
    return { error: err.stderr || err.message };
  }
}

async function undeployScript(name) {
  const dir = path.join(SCRIPTS_DIR, name);
  const composePath = path.join(dir, 'docker-compose.yml');
  if (!fs.existsSync(composePath)) return { error: `No docker-compose.yml for ${name}` };
  try {
    const { stdout } = await execAsync(`cd "${dir.replace(/\\/g, '/')}" && /usr/local/bin/docker-compose down`, { timeout: 60000 });
    return { success: true, output: stdout };
  } catch (err) {
    return { error: err.stderr || err.message };
  }
}

// ── Serve Dashboard HTML ────────────────────────────────────────
function serveDashboard(res) {
  const dashboardPath = path.join(__dirname, '..', 'dashboard.html');
  fs.readFile(dashboardPath, 'utf-8', (err, html) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Dashboard not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
}

// ── Helpers ─────────────────────────────────────────────────────
function sendJSON(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

// ── Router ──────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const method = req.method;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  try {
    // ── Dashboard ────────────────────────────────────────────
    if (url.pathname === '/' || url.pathname === '/dashboard') {
      serveDashboard(res);
      return;
    }

    // ── Health ───────────────────────────────────────────────
    if (url.pathname === '/health') {
      sendJSON(res, { status: 'ok', timestamp: new Date().toISOString() });
      return;
    }

    // ── Containers ───────────────────────────────────────────
    if (url.pathname === '/api/containers' && method === 'GET') {
      const all = url.searchParams.get('all') === 'true';
      const result = await listContainers(all);
      sendJSON(res, result);
      return;
    }

    const containerMatch = url.pathname.match(/^\/api\/containers\/([a-f0-9]+)$/i);
    if (containerMatch) {
      const id = containerMatch[1];

      if (method === 'GET') {
        const [inspectResult, logsResult] = await Promise.all([
          dockerRun('inspect', id),
          dockerRun('logs', '--tail', '100', id),
        ]);
        const inspect = inspectResult.ok ? JSON.parse(inspectResult.data) : { error: inspectResult.error };
        const logs = logsResult.ok ? logsResult.data : { error: logsResult.error };
        sendJSON(res, { inspect, logs });
        return;
      }

      if (method === 'POST') {
        const action = url.searchParams.get('action');
        let result;
        switch (action) {
          case 'start': result = await startContainer(id); break;
          case 'stop': result = await stopContainer(id); break;
          case 'restart': result = await restartContainer(id); break;
          default: result = { error: 'Unknown action: ' + action };
        }
        sendJSON(res, result);
        return;
      }

      if (method === 'DELETE') {
        const force = url.searchParams.get('force') === 'true';
        const result = await removeContainer(id, force);
        sendJSON(res, result);
        return;
      }
    }

    // ── Container logs ───────────────────────────────────────
    const logsMatch = url.pathname.match(/^\/api\/containers\/([a-f0-9]+)\/logs$/i);
    if (logsMatch && method === 'GET') {
      const tail = parseInt(url.searchParams.get('tail') || '100');
      const result = await getLogs(logsMatch[1], tail);
      sendJSON(res, result);
      return;
    }

    // ── Images ───────────────────────────────────────────────
    if (url.pathname === '/api/images' && method === 'GET') {
      const result = await listImages();
      sendJSON(res, result);
      return;
    }

    if (url.pathname === '/api/images/pull' && method === 'POST') {
      const image = url.searchParams.get('image');
      if (!image) { sendJSON(res, { error: 'Missing image param' }, 400); return; }
      const result = await pullImage(image);
      sendJSON(res, result);
      return;
    }

    // ── Scripts ──────────────────────────────────────────────
    if (url.pathname === '/api/scripts' && method === 'GET') {
      const result = await listScripts();
      sendJSON(res, result);
      return;
    }

    if (url.pathname === '/api/scripts/deploy' && method === 'POST') {
      const body = await readBody(req);
      const name = body?.path || body?.name;
      if (!name) { sendJSON(res, { error: 'Missing path' }, 400); return; }
      const result = await deployScript(name);
      sendJSON(res, result);
      return;
    }

    if (url.pathname === '/api/scripts/undeploy' && method === 'POST') {
      const body = await readBody(req);
      const name = body?.path || body?.name;
      if (!name) { sendJSON(res, { error: 'Missing path' }, 400); return; }
      const result = await undeployScript(name);
      sendJSON(res, result);
      return;
    }

    // ── 404 ──────────────────────────────────────────────────
    sendJSON(res, { error: 'Not found' }, 404);
  } catch (err) {
    sendJSON(res, { error: err.message }, 500);
  }
});

server.listen(PORT, () => {
  console.log('Container Manager running on http://localhost:' + PORT);
  console.log('  Health:  /health');
  console.log('  API:     /api/containers');
  console.log('  API:     /api/images');
  console.log('  API:     /api/scripts');
  console.log('  Dashboard: /');
});
