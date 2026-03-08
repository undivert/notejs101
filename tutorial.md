# Building a Node.js Web App Without Frameworks

A practical tutorial for JavaScript developers stepping into Node.js for the first time. We'll build a multi-page web app with login, sessions, user listing, and good developer tooling — using **nothing but Node's standard library**.

---

## Table of Contents

1. [What We're Building](#1-what-were-building)
2. [Project Setup & Structure](#2-project-setup--structure)
3. [Routing & Request Handling](#3-routing--request-handling)
4. [Sessions & Auth Flow](#4-sessions--auth-flow)
5. [UX & Dev Improvements](#5-ux--dev-improvements)
6. [Running the App](#6-running-the-app)
7. [What to Try Next](#7-what-to-try-next)

---

## 1. What We're Building

A small but complete web app that covers the core patterns you'll use in any Node.js project:

| Route | Method | Description |
|---|---|---|
| `/` | GET | Home page |
| `/login` | GET / POST | Login form and submission |
| `/logout` | GET | Destroys session, redirects |
| `/me` | GET | Logged-in user's profile (protected) |
| `/users` | GET | List of all users |

Users are stored in a flat `users.json` file. No npm packages, no framework — just Node.

---

## 2. Project Setup & Structure

### File layout

```
project/
├── server.js       ← the entire app
├── users.json      ← user data
├── package.json    ← scripts and metadata
├── .env            ← environment config
└── .gitignore      ← keep secrets out of git
```

### The `.env` file

Rather than hardcoding config or relying on shell exports, we store settings in a `.env` file:

```env
PORT=8800
HOST=localhost
NODE_ENV=development
```

Node doesn't read `.env` automatically — we parse it ourselves at startup. This avoids needing the `dotenv` package:

```js
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
```

Key detail: `!(key in process.env)` means environment variables already set in the shell (e.g. `PORT=9000 node server.js`) take priority over `.env`. This is the standard expected behaviour.

### `package.json` scripts

```json
{
  "scripts": {
    "start": "node server.js",
    "dev":   "node --watch server.js"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

`--watch` is a built-in Node.js flag (available since v18) that restarts the process whenever a `.js` or `.json` file changes. No `nodemon` needed.

### `users.json`

A plain array of user objects. This is our "database":

```json
[
  { "id": 1, "username": "alice", "password": "alice123", "name": "Alice Johnson", "email": "alice@example.com", "role": "Admin" },
  { "id": 2, "username": "bob",   "password": "bob123",   "name": "Bob Smith",     "email": "bob@example.com",   "role": "Editor" },
  { "id": 3, "username": "carol", "password": "carol123", "name": "Carol White",   "email": "carol@example.com", "role": "Viewer" }
]
```

> **Note:** Passwords are plain text here for simplicity. In a real app, always hash passwords with `bcrypt` or Node's built-in `crypto.pbkdf2`.

---

## 3. Routing & Request Handling

### How Node's HTTP server works

In frameworks like Express, routing is handled for you. In raw Node, every single HTTP request hits one callback — and you decide what to do with it:

```js
const server = http.createServer(async (req, res) => {
  // req = the incoming request (method, url, headers, body stream)
  // res = your response object (write headers, send body)
});

server.listen(PORT, HOST, () => {
  console.log(`server running at http://${HOST}:${PORT}`);
});
```

### Parsing the URL

`req.url` is a raw string like `/login?redirect=/me`. We use `url.parse` to split it into parts:

```js
const parsed   = url.parse(req.url, true); // true = parse query string
const pathname = parsed.pathname;           // "/login"
const query    = parsed.query;             // { redirect: "/me" }
const method   = req.method.toUpperCase(); // "GET", "POST"
```

### The router

Instead of one giant `if/else` chain, we map `"METHOD /path"` strings to handler functions:

```js
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
```

Each handler receives `req`, `res`, the resolved `user` object, and the parsed `query`.

### Reading a POST body

Unlike `GET` requests, a `POST` body arrives as a **stream** of chunks. We collect them manually:

```js
function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
  });
}
```

Once resolved, `data` is a URL-encoded string like `username=alice&password=alice123`. We parse it with the built-in `URLSearchParams`:

```js
const params   = new URLSearchParams(body);
const username = params.get("username") || "";
const password = params.get("password") || "";
```

### Sending responses

Two helpers cover almost every case:

```js
// Send an HTML page with a status code
function send(res, code, html) {
  res.writeHead(code, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

// Redirect to another URL
function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}
```

### Generating HTML

There's no template engine — HTML is just a JavaScript string. A `layout()` function wraps every page with the shared `<head>`, nav, and styles:

```js
function layout(title, content, activeUser) {
  const isLoggedIn = !!activeUser;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <title>${escHtml(title)} — app</title>
  ...styles...
</head>
<body>
  <nav>
    <a href="/">home</a>
    ${isLoggedIn ? `<a href="/me">my info</a>` : ""}
    <a href="/users">users</a>
    ${!isLoggedIn ? `<a href="/login">login</a>` : `<a href="/logout">logout</a>`}
  </nav>
  ${content}
</body>
</html>`;
}
```

Each route handler builds its own `content` string, then calls `send(res, 200, layout("Title", content, user))`.

> **Why `escHtml()`?** Any user-controlled value (username, URL, etc.) rendered into HTML must be escaped. Without it, a username like `<script>alert(1)</script>` would run as JavaScript in the browser. The `escHtml()` function replaces `<`, `>`, `&`, and `"` with their safe HTML entities.

---

## 4. Sessions & Auth Flow

### Why sessions?

HTTP is stateless — every request is independent. Sessions let us remember that a user logged in. The pattern:

1. On login, generate a random ID and store `{ sessionId → username }` in memory
2. Send the ID to the browser as a **cookie**
3. On every future request, read the cookie back and look up who it belongs to

### Session storage

```js
// In-memory store: { sessionId -> { username, expiresAt } }
const sessions = {};

function createSession(username) {
  const sid = generateSessionId();
  sessions[sid] = { username, expiresAt: Date.now() + SESSION_TTL_MS };
  return sid;
}
```

`SESSION_TTL_MS` is set to 1 hour. Sessions are not permanent — they expire.

### Generating a session ID

```js
function generateSessionId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
```

This combines a random base-36 string with the current timestamp for uniqueness. For production, use `crypto.randomBytes(32).toString('hex')` instead.

### Reading the session cookie

Browsers send cookies back on every request in the `Cookie` header as a semicolon-separated string, e.g. `session=abc123; theme=dark`. We extract ours with a regex:

```js
function getSession(req) {
  const cookie = req.headers.cookie || "";
  const match  = cookie.match(/session=([^;]+)/);
  if (!match) return null;

  const s = sessions[match[1]];
  if (!s) return null;

  // Check expiry
  if (Date.now() > s.expiresAt) {
    delete sessions[match[1]];
    return null;
  }

  // Rolling expiry — extend on each visit
  s.expiresAt = Date.now() + SESSION_TTL_MS;
  return { id: match[1], username: s.username };
}
```

**Rolling expiry** means the session stays alive as long as the user keeps visiting. It only expires after 1 hour of inactivity.

### The full login flow

```
Browser                          Server
  │                                │
  │  GET /login                    │
  │ ─────────────────────────────► │  Render login form
  │ ◄───────────────────────────── │
  │                                │
  │  POST /login (username+pass)   │
  │ ─────────────────────────────► │  Check credentials
  │                                │  Create session → set cookie
  │ ◄─ 302 /me  Set-Cookie: sid ── │
  │                                │
  │  GET /me  Cookie: sid          │
  │ ─────────────────────────────► │  Read cookie → find user → render page
  │ ◄───────────────────────────── │
```

In code, setting the cookie looks like this:

```js
const sid = createSession(found.username);
res.setHeader("Set-Cookie", `session=${sid}; HttpOnly; Path=/`);
redirect(res, "/me");
```

`HttpOnly` means the cookie cannot be accessed by JavaScript in the browser — it only goes in HTTP headers. This protects against XSS stealing the session.

### Logout

```js
function handleLogout(req, res) {
  destroySession(req);                                       // remove from memory
  res.setHeader("Set-Cookie", "session=; HttpOnly; Path=/; Max-Age=0"); // expire cookie
  flashRedirect(res, "/login", "you have been logged out.");
}
```

`Max-Age=0` tells the browser to delete the cookie immediately.

### Protecting routes

Any route that requires login checks for a valid user first:

```js
function handleMe(req, res, user, query) {
  if (!user) {
    redirect(res, "/login?redirect=/me");
    return;
  }
  // ... render page
}
```

We pass `?redirect=/me` so that after logging in, the user lands back where they were trying to go, not always on `/me` by default.

On the login handler's POST:

```js
const dest = query.redirect && query.redirect.startsWith("/") ? query.redirect : "/me";
redirect(res, dest);
```

The `startsWith("/")` check prevents an attacker from passing `?redirect=https://evil.com` (an **open redirect** vulnerability).

### Periodic session cleanup

Since sessions are in memory, we run a cleanup every 15 minutes to remove expired ones:

```js
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of Object.entries(sessions)) {
    if (now > s.expiresAt) delete sessions[id];
  }
}, 1000 * 60 * 15);
```

---

## 5. UX & Dev Improvements

### Flash messages

After an action like logout, we want to show a one-time message on the next page. Without a proper session store, we encode the message in the redirect URL:

```js
function flashRedirect(res, location, msg, type = "ok") {
  const sep = location.includes("?") ? "&" : "?";
  redirect(res, `${location}${sep}flash=${encodeURIComponent(msg)}&flashType=${type}`);
}
```

So logout redirects to `/login?flash=you+have+been+logged+out&flashType=ok`. The login page reads the query and renders a banner:

```js
function flashBanner(query) {
  if (!query.flash) return "";
  const cls  = query.flashType === "error" ? "msg-error" : "msg-ok";
  const icon = query.flashType === "error" ? "✕" : "✓";
  return `<div class="${cls}">${icon} ${escHtml(query.flash)}</div>`;
}
```

### Dev credential hint

In development mode only, the login page shows a hint with test credentials so you don't have to remember them:

```js
${isDev ? `<div class="hint">dev — credentials: alice/alice123 · bob/bob123 · carol/carol123</div>` : ""}
```

`isDev` is `true` when `NODE_ENV=development` (the default). Set `NODE_ENV=production` in `.env` to hide the hint.

### Colored request logger

Every request prints a line to the terminal so you can see exactly what's happening:

```
  2025-03-08T10:00:01.000Z  POST  /login      302  4ms
  2025-03-08T10:00:01.004Z  GET   /me         200  1ms
```

Status codes are colored: green for 2xx, cyan for 3xx, yellow for 4xx, red for 5xx. This uses ANSI escape codes built into the terminal:

```js
const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";

function colorStatus(code) {
  if (code >= 500) return `${RED}${code}${RESET}`;
  if (code >= 400) return `${YELLOW}${code}${RESET}`;
  if (code >= 300) return `${CYAN}${code}${RESET}`;
  return `${GREEN}${code}${RESET}`;
}
```

The tricky part is capturing the status code. By the time `res.on("finish")` fires, `res.statusCode` isn't always set from our own `writeHead` calls. We patch `res.writeHead` to capture it:

```js
const _writeHead = res.writeHead.bind(res);
res.writeHead = (code, headers) => {
  res.statusCode = code;
  return _writeHead(code, headers);
};
res.on("finish", () => logger(req, res, start));
```

### Error handling & stack traces

Unhandled errors are caught at the top level:

```js
try {
  // ... route dispatch
} catch (err) {
  console.error("unhandled error", err);
  send(res, 500, layout("Error",
    `<h1>500 — server error</h1>
     <pre>${isDev ? escHtml(err.stack) : "something went wrong."}</pre>`,
    user));
}
```

In development, the full stack trace is shown in the browser. In production, only a generic message is shown — never leak internal details to users.

### Graceful shutdown

When you press `Ctrl+C` or the process gets a `SIGTERM` signal (e.g. from a deployment system), we close the server cleanly instead of just killing it:

```js
process.on("SIGINT",  () => server.close(() => { console.log("\nserver closed."); process.exit(0); }));
process.on("SIGTERM", () => server.close(() => { console.log("server closed.");   process.exit(0); }));
```

`server.close()` stops accepting new connections but waits for in-flight requests to finish before exiting.

---

## 6. Running the App

```bash
# Development (auto-restarts on file change)
npm run dev

# Production
NODE_ENV=production npm start

# Override port without editing .env
PORT=3000 npm start
```

On startup you'll see:

```
  ▶ server ready  http://localhost:8800
  env: development  |  session ttl: 1h
```

Then visit `http://localhost:8800` and log in with `alice` / `alice123`.

---

## 7. What to Try Next

Now that you understand the foundations, here are natural next steps:

**Security**
- Hash passwords using `crypto.pbkdf2Sync` (built-in) or install `bcrypt`
- Add a login rate limiter — track failed attempts per IP and block after 5 tries
- Set `Secure` on the session cookie when running over HTTPS

**Structure**
- Split `server.js` into modules: `router.js`, `session.js`, `views.js`
- Add a proper router map: `const routes = { "GET /": handleHome }` to replace the `if` chain

**Data**
- Replace `users.json` with SQLite using the `better-sqlite3` package — it's fast, file-based, and needs no server
- Add a `POST /users` route to create new users

**Features**
- Add a `role`-based access check so only Admins can see the full user list
- Serve static files (CSS, images) from a `/public` folder
- Add a `PATCH /me` route to let users update their own profile
---

*Built with Node.js standard library only — no Express, no frameworks.*
