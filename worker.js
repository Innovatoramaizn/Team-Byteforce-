// SignalLoop site worker: serves the static front end and proxies /api/* to the
// real Flask backend so the browser stays same-origin (no CORS configuration).
//
// Set API_ORIGIN (Sites environment variable or Worker secret) to the backend
// origin, e.g. "https://signalloop-api.example.com" — no trailing /api path.
// Local development does not use this worker: run the Flask API on port 5000.

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const PROXYABLE = ["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      const origin = (env.API_ORIGIN || "").trim().replace(/\/+$/, "");
      if (!origin) {
        return json(502, {
          error: "api_not_configured",
          message: "The API origin is not configured for this deployment.",
        });
      }
      if (!PROXYABLE.includes(request.method)) {
        return json(405, { error: "method_not_allowed", message: "Method not allowed." });
      }

      const headers = new Headers(request.headers);
      headers.delete("host");
      headers.set("x-forwarded-host", url.host);
      headers.set("x-forwarded-proto", url.protocol.replace(":", ""));

      const hasBody = !["GET", "HEAD"].includes(request.method);
      const upstream = await fetch(origin + url.pathname + url.search, {
        method: request.method,
        headers,
        body: hasBody ? request.body : null,
        // Required by the Fetch spec when a streaming body is forwarded.
        ...(hasBody ? { duplex: "half" } : {}),
        redirect: "manual",
      });

      // 204/205/304 responses must not carry a body.
      const body = [204, 205, 304].includes(upstream.status) ? null : upstream.body;
      return new Response(body, upstream);
    }

    return env.ASSETS.fetch(request);
  },
};
