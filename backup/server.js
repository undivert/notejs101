const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

// Load .env file if present
const envFile = path.join(__dirname, ".env");
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, "utf8")
    .split("\n")
    .forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const [key, ...rest] = trimmed.split("=");
      if (key && !(key in process.env)) {
        process.env[key.trim()] = rest.join("=").trim();
      }
    });
}

const PORT = process.env.PORT || 8800;
const HOST = process.env.HOST || "localhost";
const USERS_FILE = path.join(__dirname, "users.json");

// Simple in-memory session store: { sessionId -> username }
const sessions = {};

function generateSessionId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function getUsers() {
  return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
}

function getSession(req) {
  const cookie = req.headers.cookie || "";
  const match = cookie.match(/session=([^;]+)/);
  if (match && sessions[match[1]]) {
    return { id: match[1], username: sessions[match[1]] };
  }
  return null;
}

function getLoggedInUser(req) {
  const session = getSession(req);
  if (!session) return null;
  return getUsers().find((u) => u.username === session.username) || null;
}

// ── HTML helpers ─────────────────────────────────────────────────────────────

function layout(title, content, activeUser) {
  const isLoggedIn = !!activeUser;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: monospace; background: #fff; color: #000; padding: 2rem; max-width: 720px; margin: 0 auto; }
    nav { border-bottom: 2px solid #000; padding-bottom: 0.75rem; margin-bottom: 2rem; display: flex; gap: 1.5rem; align-items: center; }
    nav a { text-decoration: none; color: #000; font-size: 0.95rem; }
    nav a:hover { font-weight: bold; }
    nav a.active { font-weight: bold; text-decoration: underline; }
    h1 { font-size: 1.4rem; margin-bottom: 1.5rem; }
    table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
    th, td { border: 1px solid #000; padding: 0.5rem 0.75rem; text-align: left; font-family: monospace; }
    th { font-weight: bold; }
    label { display: block; margin-bottom: 0.25rem; font-size: 0.9rem; }
    input { display: block; width: 100%; padding: 0.4rem 0.5rem; font-family: monospace; font-size: 0.95rem; border: 1px solid #000; margin-bottom: 1rem; outline: none; }
    input:focus { outline: 2px solid #000; }
    button, .btn { font-family: monospace; font-size: 0.95rem; padding: 0.4rem 1.2rem; border: 1px solid #000; background: #fff; color: #000; cursor: pointer; }
    button:hover, .btn:hover { font-weight: bold; }
    .msg-error { border: 1px solid #000; padding: 0.5rem 0.75rem; margin-bottom: 1rem; background: #f0f0f0; }
    .msg-ok    { border: 1px solid #000; padding: 0.5rem 0.75rem; margin-bottom: 1rem; }
    .field { margin-bottom: 0.75rem; }
    .field span { font-weight: bold; }
    .section { margin-bottom: 1.5rem; }
  </style>
</head>
<body>
  <nav>
    <a href="/" ${title === "Home" ? 'class="active"' : ""}>home</a>
    ${isLoggedIn ? `<a href="/me" ${title === "My Info" ? 'class="active"' : ""}>my info</a>` : ""}
    <a href="/users" ${title === "Users" ? 'class="active"' : ""}>users</a>
    ${!isLoggedIn ? `<a href="/login" ${title === "Login" ? 'class="active"' : ""}>login</a>` : ""}
    ${isLoggedIn ? `<a href="/logout">logout</a>` : ""}
    ${isLoggedIn ? `<span style="margin-left:auto;font-size:0.85rem;">[ ${activeUser.username} ]</span>` : ""}
  </nav>
  ${content}
</body>
</html>`;
}

// ── Route handlers ────────────────────────────────────────────────────────────

function handleHome(req, res, user) {
  const content = `
    <h1>welcome.</h1>
    <div class="section">
      ${user
        ? `<p>logged in as <strong>${user.username}</strong>.<br>
           go to <a href="/me">my info</a> or <a href="/users">users</a>.</p>`
        : `<p>you are not logged in.<br>go to <a href="/login">login</a> or view <a href="/users">users</a>.</p>`}
    </div>`;
  send(res, 200, layout("Home", content, user));
}

function handleLogin(req, res, user, query, error) {
  if (user) { redirect(res, "/me"); return; }
  const content = `
    <h1>login</h1>
    ${error ? `<div class="msg-error">${error}</div>` : ""}
    <form method="POST" action="/login">
      <label for="username">username</label>
      <input id="username" name="username" type="text" autocomplete="username" value="${query.username || ""}" />
      <label for="password">password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" />
      <button type="submit">login</button>
    </form>`;
  send(res, error ? 401 : 200, layout("Login", content, null));
}

function handleLoginPost(req, res, body) {
  const params = new URLSearchParams(body);
  const username = params.get("username") || "";
  const password = params.get("password") || "";
  const users = getUsers();
  const found = users.find((u) => u.username === username && u.password === password);
  if (!found) {
    handleLogin(req, res, null, { username }, "invalid username or password.");
    return;
  }
  const sid = generateSessionId();
  sessions[sid] = found.username;
  res.setHeader("Set-Cookie", `session=${sid}; HttpOnly; Path=/`);
  redirect(res, "/me");
}

function handleLogout(req, res) {
  const session = getSession(req);
  if (session) delete sessions[session.id];
  res.setHeader("Set-Cookie", "session=; HttpOnly; Path=/; Max-Age=0");
  redirect(res, "/login");
}

function handleMe(req, res, user) {
  if (!user) { redirect(res, "/login"); return; }
  const content = `
    <h1>my info</h1>
    <div class="section">
      <div class="field">id &nbsp;&nbsp;&nbsp;&nbsp;: <span>${user.id}</span></div>
      <div class="field">name &nbsp;&nbsp;: <span>${user.name}</span></div>
      <div class="field">username: <span>${user.username}</span></div>
      <div class="field">email &nbsp;&nbsp;: <span>${user.email}</span></div>
      <div class="field">role &nbsp;&nbsp;&nbsp;: <span>${user.role}</span></div>
    </div>`;
  send(res, 200, layout("My Info", content, user));
}

function handleUsers(req, res, user) {
  const users = getUsers();
  const rows = users.map((u) => `
    <tr>
      <td>${u.id}</td>
      <td>${u.name}</td>
      <td>${u.username}</td>
      <td>${u.email}</td>
      <td>${u.role}</td>
    </tr>`).join("");
  const content = `
    <h1>users</h1>
    <table>
      <thead>
        <tr><th>id</th><th>name</th><th>username</th><th>email</th><th>role</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
  send(res, 200, layout("Users", content, user));
}

function handle404(req, res, user) {
  const content = `<h1>404 — not found</h1><p><a href="/">go home</a></p>`;
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
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const method = req.method.toUpperCase();
  const user = getLoggedInUser(req);

  if (method === "GET") {
    if (pathname === "/")        return handleHome(req, res, user);
    if (pathname === "/login")   return handleLogin(req, res, user, parsed.query, null);
    if (pathname === "/logout")  return handleLogout(req, res);
    if (pathname === "/me")      return handleMe(req, res, user);
    if (pathname === "/users")   return handleUsers(req, res, user);
    return handle404(req, res, user);
  }

  if (method === "POST") {
    if (pathname === "/login") {
      const body = await readBody(req);
      return handleLoginPost(req, res, body);
    }
  }

  handle404(req, res, user);
});

server.listen(PORT, HOST, () => {
  console.log(`server running at http://${HOST}:${PORT}`);
});
