// SignalLoop deployment configuration.
//
// Leave `apiBase` empty to use the defaults built into src/api.js:
//   - local development (localhost / 127.0.0.1): http://127.0.0.1:5000/api
//   - deployed site: "/api", proxied by worker.js to the real Flask backend
//
// Set it only when the API is hosted somewhere the site cannot reach through
// "/api" — for example a cross-origin backend that is not proxied:
//   apiBase: "https://signalloop-api.example.com/api"
window.SIGNALLOOP_CONFIG = {
  apiBase: "",
};
