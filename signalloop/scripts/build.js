// Builds the deployable site into dist/ and writes dist/src/config.js with the API address.
// Usage: API_BASE_URL=https://your-api.onrender.com npm run build
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");

function fail(message) {
  console.error("\nBuild stopped: " + message + "\n");
  process.exit(1);
}

function normalizeApiBase(raw) {
  let value = String(raw || "").trim();
  if (!value) {
    fail(
      "API_BASE_URL is not set.\n" +
        "Set it to your deployed API address, for example https://signalloop-api.onrender.com\n" +
        "(Netlify: Site configuration > Environment variables).",
    );
  }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = "https://" + value;
  let url;
  try {
    url = new URL(value);
  } catch (e) {
    fail("API_BASE_URL is not a valid address: " + raw);
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    fail("API_BASE_URL must start with https:// (browsers block an https site from calling an http API).");
  }
  if (url.search || url.hash) fail("API_BASE_URL must not contain a query string or #fragment.");
  let pathname = url.pathname.replace(/\/+$/, "");
  if (!pathname.endsWith("/api")) pathname += "/api";
  return url.origin + pathname;
}

const apiBase = normalizeApiBase(process.env.API_BASE_URL);

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, "src"), { recursive: true });
fs.copyFileSync(path.join(root, "index.html"), path.join(dist, "index.html"));
fs.cpSync(path.join(root, "assets"), path.join(dist, "assets"), { recursive: true });
for (const file of fs.readdirSync(path.join(root, "src"))) {
  if (file !== "config.js") fs.copyFileSync(path.join(root, "src", file), path.join(dist, "src", file));
}
fs.writeFileSync(
  path.join(dist, "src", "config.js"),
  "window.SIGNALLOOP_API_BASE = " + JSON.stringify(apiBase) + ";\n",
);

console.log("Built dist/ for API " + apiBase);
