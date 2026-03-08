const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

// ── Load .env ─────────────────────────────────────────────────────────────────

const envFile = path.join(__dirname, ".env");
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, "utf8")
    .split("\n")
    .forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const [key, ...rest] = trimmed.split("=");
      if (key && !(key in process.env))
        process.env[key.trim()] = rest.join("=").trim();
    });
}

const PORT = process.env.PORT || 8800;
const HOST = process.env.HOST || "localhost";
const NODE_ENV = process.env.NODE_ENV || "development";
const isDev = NODE_ENV === "development";
const USERS_FILE = path.join(__dirname, "users.json");
const SESSION_TTL_MS = 1000 * 60 * 60; // 1 hour

// ── Sessions ──────────────────────────────────────────────────────────────────

// { sessionId -> { username, expiresAt } }
const sessions = {};

function generateSessionId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function createSession(username) {
  const sid = generateSessionId();
  sessions[sid] = { username, expiresAt: Date.now() + SESSION_TTL_MS };
  return sid;
}

function getSession(req) {
  const cookie = req.headers.cookie || "";
  const match = cookie.match(/session=([^;]+)/);
  if (!match) return null;
  const s = sessions[match[1]];
  if (!s) return null;
  if (Date.now() > s.expiresAt) { delete sessions[match[1]]; return null; }
  s.expiresAt = Date.now() + SESSION_TTL_MS; // rolling expiry
  return { id: match[1], username: s.username };
}

function destroySession(req) {
  const session = getSession(req);
  if (session) delete sessions[session.id];
}

// Periodically purge expired sessions
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of Object.entries(sessions)) {
    if (now > s.expiresAt) delete sessions[id];
  }
}, 1000 * 60 * 15);

// ── Flash messages ────────────────────────────────────────────────────────────

function flashRedirect(res, location, msg, type = "ok") {
  const sep = location.includes("?") ? "&" : "?";
  redirect(res, `${location}${sep}flash=${encodeURIComponent(msg)}&flashType=${type}`);
}

// ── Users ─────────────────────────────────────────────────────────────────────

function getUsers() {
  return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
}

function getLoggedInUser(req) {
  const session = getSession(req);
  if (!session) return null;
  return getUsers().find((u) => u.username === session.username) || null;
}

// ── Logger ────────────────────────────────────────────────────────────────────

const RESET  = "\x1b[0m";
const DIM    = "\x1b[2m";
const GREEN  = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED    = "\x1b[31m";
const CYAN   = "\x1b[36m";

function colorStatus(code) {
  if (code >= 500) return `${RED}${code}${RESET}`;
  if (code >= 400) return `${YELLOW}${code}${RESET}`;
  if (code >= 300) return `${CYAN}${code}${RESET}`;
  return `${GREEN}${code}${RESET}`;
}

function logger(req, res, start) {
  const ms = Date.now() - start;
  const status = colorStatus(res.statusCode);
  const method = req.method.padEnd(4);
  const route  = (req.url || "/").split("?")[0].padEnd(12);
  console.log(`  ${DIM}${new Date().toISOString()}${RESET}  ${method}  ${route}  ${status}  ${DIM}${ms}ms${RESET}`);
}

// ── HTML helpers ──────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function flashBanner(query) {
  if (!query.flash) return "";
  const cls  = query.flashType === "error" ? "msg-error" : "msg-ok";
  const icon = query.flashType === "error" ? "✕" : "✓";
  return `<div class="${cls}">${icon} ${escHtml(query.flash)}</div>`;
}

function layout(title, content, activeUser) {
  const isLoggedIn = !!activeUser;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escHtml(title)} — app</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: monospace; background: #fff; color: #000; padding: 2rem; max-width: 720px; margin: 0 auto; }
    nav { border-bottom: 2px solid #000; padding-bottom: 0.75rem; margin-bottom: 2rem; display: flex; gap: 1.5rem; align-items: center; flex-wrap: wrap; }
    nav a { text-decoration: none; color: #000; font-size: 0.95rem; }
    nav a:hover { font-weight: bold; }
    nav a.active { font-weight: bold; text-decoration: underline; }
    nav .spacer { flex: 1; }
    nav .whoami { font-size: 0.85rem; }
    h1 { font-size: 1.4rem; margin-bottom: 1.5rem; }
    table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
    th, td { border: 1px solid #000; padding: 0.5rem 0.75rem; text-align: left; font-family: monospace; }
    th { font-weight: bold; }
    label { display: block; margin-bottom: 0.25rem; font-size: 0.9rem; }
    input { display: block; width: 100%; padding: 0.4rem 0.5rem; font-family: monospace; font-size: 0.95rem; border: 1px solid #000; margin-bottom: 1rem; outline: none; }
    input:focus { outline: 2px solid #000; }
    button { font-family: monospace; font-size: 0.95rem; padding: 0.4rem 1.2rem; border: 1px solid #000; background: #fff; color: #000; cursor: pointer; }
    button:hover { font-weight: bold; }
    .msg-error { border: 1px solid #000; padding: 0.5rem 0.75rem; margin-bottom: 1rem; background: #f0f0f0; }
    .msg-ok    { border: 1px solid #000; padding: 0.5rem 0.75rem; margin-bottom: 1rem; }
    .field { margin-bottom: 0.75rem; font-size: 0.95rem; }
    .field .key { display: inline-block; width: 8rem; }
    .field .val { font-weight: bold; }
    .section { margin-bottom: 1.5rem; }
    .hint { font-size: 0.8rem; margin-top: 2rem; border-top: 1px solid #ccc; padding-top: 1rem; color: #555; }
    a { color: #000; }
    a:hover { font-weight: bold; }
    pre { font-family: monospace; font-size: 0.85rem; white-space: pre-wrap; margin-top: 1rem; }
  </style>
</head>
<body>
  <nav>
    <a href="/"${title === "Home" ? ' class="active"' : ""}>home</a>
    ${isLoggedIn ? `<a href="/me"${title === "My Info" ? ' class="active"' : ""}>my info</a>` : ""}
    <a href="/users"${title === "Users" ? ' class="active"' : ""}>users</a>
    ${!isLoggedIn ? `<a href="/login"${title === "Login" ? ' class="active"' : ""}>login</a>` : ""}
    ${isLoggedIn  ? `<a href="/logout">logout</a>` : ""}
    ${isLoggedIn  ? `<span class="spacer"></span><span class="whoami">[ ${escHtml(activeUser.username)} ]</span>` : ""}
  </nav>
  ${content}
</body>
</html>`;
}

// ── Route handlers ────────────────────────────────────────────────────────────

function handleHome(req, res, user, query) {
  const content = `
    ${flashBanner(query)}
    <h1>welcome.</h1>
    <div class="section">
      ${user
        ? `<p>logged in as <strong>${escHtml(user.username)}</strong>.<br><br>
           go to <a href="/me">my info</a> or <a href="/users">users</a>.</p>`
        : `<p>you are not logged in.<br><br>
           go to <a href="/login">login</a> or view <a href="/users">users</a>.</p>`}
    </div>`;
  send(res, 200, layout("Home", content, user));
}

function handleLogin(req, res, user, query, error) {
  if (user) { redirect(res, "/me"); return; }
  const content = `
    ${flashBanner(query)}
    <h1>login</h1>
    ${error ? `<div class="msg-error">✕ ${escHtml(error)}</div>` : ""}
    <form method="POST" action="/login${query.redirect ? `?redirect=${encodeURIComponent(query.redirect)}` : ""}">
      <label for="username">username</label>
      <input id="username" name="username" type="text" autocomplete="username"
             value="${escHtml(query.username || "")}" autofocus />
      <label for="password">password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" />
      <button type="submit">login</button>
    </form>
    ${isDev ? `<div class="hint">dev — credentials: alice/alice123 · bob/bob123 · carol/carol123</div>` : ""}`;
  send(res, error ? 401 : 200, layout("Login", content, null));
}

function handleLoginPost(req, res, body, query) {
  const params   = new URLSearchParams(body);
  const username = params.get("username") || "";
  const password = params.get("password") || "";
  const users    = getUsers();
  const found    = users.find((u) => u.username === username && u.password === password);
  if (!found) {
    handleLogin(req, res, null, { username, redirect: query.redirect }, "invalid username or password.");
    return;
  }
  const sid = createSession(found.username);
  res.setHeader("Set-Cookie", `session=${sid}; HttpOnly; Path=/`);
  const dest = query.redirect && query.redirect.startsWith("/") ? query.redirect : "/me";
  redirect(res, dest);
}

function handleLogout(req, res) {
  destroySession(req);
  res.setHeader("Set-Cookie", "session=; HttpOnly; Path=/; Max-Age=0");
  flashRedirect(res, "/login", "you have been logged out.");
}

function handleMe(req, res, user, query) {
  if (!user) { redirect(res, "/login?redirect=/me"); return; }
  const content = `
    ${flashBanner(query)}
    <h1>my info</h1>
    <div class="section">
      <div class="field"><span class="key">id</span><span class="val">${escHtml(String(user.id))}</span></div>
      <div class="field"><span class="key">name</span><span class="val">${escHtml(user.name)}</span></div>
      <div class="field"><span class="key">username</span><span class="val">${escHtml(user.username)}</span></div>
      <div class="field"><span class="key">email</span><span class="val">${escHtml(user.email)}</span></div>
      <div class="field"><span class="key">role</span><span class="val">${escHtml(user.role)}</span></div>
    </div>`;
  send(res, 200, layout("My Info", content, user));
}

function handleUsers(req, res, user, query) {
  const users = getUsers();
  const rows  = users.map((u) => `
    <tr>
      <td>${escHtml(String(u.id))}</td>
      <td>${escHtml(u.name)}</td>
      <td>${escHtml(u.username)}</td>
      <td>${escHtml(u.email)}</td>
      <td>${escHtml(u.role)}</td>
    </tr>`).join("");
  const content = `
    ${flashBanner(query)}
    <h1>users <span style="font-size:0.9rem;font-weight:normal;">(${users.length})</span></h1>
    <table>
      <thead><tr><th>id</th><th>name</th><th>username</th><th>email</th><th>role</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  send(res, 200, layout("Users", content, user));
}

function handle404(req, res, user) {
  const content = `
    <h1>404 — not found</h1>
    <p>the page <code>${escHtml(req.url)}</code> does not exist.</p>
    <p style="margin-top:1rem;"><a href="/">go home</a></p>`;
  send(res, 404, layout("Not Found", content, user));
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function send(res, code, html) {
  res.writeHead(code, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
  });
}

// ── Server ────────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const start    = Date.now();
  const parsed   = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const method   = req.method.toUpperCase();
  const query    = parsed.query;
  const user     = getLoggedInUser(req);

  // Capture status code for logger
  const _writeHead = res.writeHead.bind(res);
  res.writeHead = (code, headers) => { res.statusCode = code; return _writeHead(code, headers); };
  res.on("finish", () => logger(req, res, start));

  try {
    if (method === "GET") {
      if (pathname === "/")       return handleHome(req, res, user, query);
      if (pathname === "/login")  return handleLogin(req, res, user, query, null);
      if (pathname === "/logout") return handleLogout(req, res);
      if (pathname === "/me")     return handleMe(req, res, user, query);
      if (pathname === "/users")  return handleUsers(req, res, user, query);
    }
    if (method === "POST" && pathname === "/login") {
      const body = await readBody(req);
      return handleLoginPost(req, res, body, query);
    }
    handle404(req, res, user);
  } catch (err) {
    console.error(`${RED}unhandled error${RESET}`, err);
    send(res, 500, layout("Error",
      `<h1>500 — server error</h1><pre>${isDev ? escHtml(err.stack) : "something went wrong."}</pre>`,
      user));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  ${GREEN}▶ server ready${RESET}  http://${HOST}:${PORT}`);
  console.log(`  ${DIM}env: ${NODE_ENV}  |  session ttl: 1h${RESET}\n`);
});

// Graceful shutdown
process.on("SIGTERM", () => server.close(() => { console.log("server closed."); process.exit(0); }));
process.on("SIGINT",  () => server.close(() => { console.log("\nserver closed."); process.exit(0); }));
