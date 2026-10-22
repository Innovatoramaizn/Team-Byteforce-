// SignalLoop API client. All data now lives on the Flask backend (see backend/README.md).
// The JWT access token is kept in sessionStorage for this session only; never store
// passwords or tokens in source code or localStorage.
const API_BASE = "http://127.0.0.1:5000/api";
const TOKEN_KEY = "sl-token";
const USER_KEY = "sl-user";

const getToken = () => {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch (e) {
    return null;
  }
};

const clearSession = () => {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
  } catch (e) {}
};

const cacheUser = (user) => {
  try {
    sessionStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch (e) {}
};

let onUnauthorized = () => {}; // replaced by app.js so the API client can trigger sign-out


const request = async (path, options = {}) => {
  const isFormData =
    typeof FormData !== "undefined" && options.body instanceof FormData;

  const headers = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...(options.headers || {}),
  };

  const token = getToken();
  if (token) headers.Authorization = "Bearer " + token;

  let response;
  try {
    response = await fetch(API_BASE + path, {
      method: options.method || "GET",
      headers,
      body:
        options.body !== undefined
          ? isFormData
            ? options.body
            : JSON.stringify(options.body)
          : undefined,
    });
  } catch (e) {
    throw {
      status: 0,
      error: "network_error",
      message: "Can't reach the SignalLoop server. Start the backend and try again.",
    };
  }

  let data = null;
  try {
    data = await response.json();
  } catch (e) {}

  if (response.status === 401 && token) {
    clearSession();
    onUnauthorized();
  }

  if (!response.ok) {
    throw {
      status: response.status,
      error: (data && data.error) || "request_failed",
      message:
        (data && data.message) ||
        (response.status === 401
          ? "Sign in again."
          : response.status === 403
            ? "You don't have permission to do that."
            : "Something went wrong. Try again."),
    };
  }

  return data;
};


const api = {
  // --- session ---
  isSignedIn: () => !!getToken(),
  getUser: () => {
    try {
      return JSON.parse(sessionStorage.getItem(USER_KEY));
    } catch (e) {
      return null;
    }
  },
  resetSession: clearSession,
  setUnauthorizedHandler: (fn) => (onUnauthorized = fn),

  // --- auth ---
  register: (body) =>
    request("/auth/register", { method: "POST", body }).then((data) => {
      cacheUser(data.user);
      try {
        sessionStorage.setItem(TOKEN_KEY, data.access_token);
      } catch (e) {}
      return data;
    }),
  login: (email, password) =>
    request("/auth/login", { method: "POST", body: { email, password } }).then((data) => {
      cacheUser(data.user);
      try {
        sessionStorage.setItem(TOKEN_KEY, data.access_token);
      } catch (e) {}
      return data;
    }),
  me: () => request("/auth/me").then((data) => (cacheUser(data.user), data.user)),

  // --- incidents ---
  listIncidents: () => request("/incidents").then((d) => d.items || []),
  getIncident: (id) => request("/incidents/" + id),
  fetchIncidentPhoto: async (id) => {
    const token = getToken();

    if (!token) {
      throw {
        status: 401,
        error: "unauthorized",
        message: "Sign in to view this photo.",
      };
    }

    const response = await fetch(
      API_BASE + "/incidents/" + encodeURIComponent(id) + "/photo",
      {
        method: "GET",
        headers: {
          Authorization: "Bearer " + token,
        },
        cache: "no-store",
      },
    );

    if (response.status === 401) {
      clearSession();
      onUnauthorized();
      throw {
        status: 401,
        error: "unauthorized",
        message: "Sign in again to view this photo.",
      };
    }

    if (!response.ok) {
      throw {
        status: response.status,
        error: "photo_fetch_failed",
        message:
          response.status === 404
            ? "Photo not found or you do not have permission to view it."
            : "Unable to load the attached photo.",
      };
    }

    return response.blob();
  },
  createIncident: (body) => request("/incidents", { method: "POST", body }).then((d) => d.incident),
  uploadIncidentPhoto: (id, file) => {
    const formData = new FormData();
    formData.append("photo", file);
    return request("/incidents/" + id + "/photo", {
      method: "POST",
      body: formData,
    });
  },
  updateIncident: (id, body) =>
    request("/incidents/" + id, { method: "PATCH", body }).then((d) => d.incident),
  reviewDuplicate: (id, body) =>
    request("/incidents/" + id + "/duplicate-reviews", { method: "POST", body }),

  // --- admin ---
  adminOverview: () => request("/admin/overview"),
};
