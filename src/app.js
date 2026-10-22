// SignalLoop front end. Accounts and incidents are served by the Flask backend
// (see backend/README.md); there is no demo data or local account storage left.
const escapeHtml = (s) =>
  String(s ?? "").replace(
    /[&<>\"]/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
      })[c],
  );
const STATUS = {
  sub: ["Submitted", "bl"],
  rev: ["In review", "wn"],
  asg: ["Assigned", "tl"],
  prg: ["In progress", "bl"],
  res: ["Resolved", "ok"],
  rej: ["Rejected", "dg"],
};
const PRIORITY = {
  low: ["Low", "bl"],
  med: ["Medium", "wn"],
  high: ["High", "dg"],
  urg: ["Urgent", "dg"],
};
const badge = (m, k) => `<span class="b ${m[k][1]}">${m[k][0]}</span>`;
const refNumber = (id) => "SL-2026-" + String(id).padStart(4, "0");
const CATEGORIES = [
  "Power & lighting",
  "Water & plumbing",
  "Road / walkway",
  "Waste / sanitation",
  "Facilities",
  "Safety & security",
];
const LOCATIONS = [
  "Library Road",
  "Hostel Block C",
  "Science Complex",
  "Student Centre",
  "North Gate",
  "Main Hall",
];
const DEPARTMENTS = [
  ["Facilities & Maintenance", "Facilities, repairs, campus infrastructure", "4 hrs", 14, 6],
  ["Electrical Services", "Lighting, power faults, electrical safety", "2 hrs", 8, 4],
  ["Water & Plumbing", "Leaks, water supply, drainage", "4 hrs", 5, 3],
  ["Sanitation", "Waste collection and cleanliness", "6 hrs", 9, 5],
  ["Campus Security", "Safety reports and security equipment", "Immediate", 4, 7],
];
let incidents = [];
let lastSync = Date.now();
const incidentPhotoUrls = new Map();
const incidentPhotoLoads = new Map();

function releaseIncidentPhoto(id) {
  const url = incidentPhotoUrls.get(String(id));
  if (url) {
    URL.revokeObjectURL(url);
    incidentPhotoUrls.delete(String(id));
  }
  incidentPhotoLoads.delete(String(id));
}

async function loadIncidentPhoto(id) {
  const key = String(id);

  if (incidentPhotoUrls.has(key)) return incidentPhotoUrls.get(key);
  if (incidentPhotoLoads.has(key)) return incidentPhotoLoads.get(key);

  const load = api.fetchIncidentPhoto(id)
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      incidentPhotoUrls.set(key, url);
      return url;
    })
    .finally(() => incidentPhotoLoads.delete(key));

  incidentPhotoLoads.set(key, load);
  return load;
}
let state = {
  user: null,
  booting: true,
  bootError: "",
  authMode: "signin",
  last: null,
  role: null,
  d: {
    c: "",
    d: "",
    l: "",
    ph: "",
    diff: 0,
  },
  busy: 0,
  f: {
    s: "",
    c: "",
    p: "",
    q: "",
  },
  err: {},
  iaud: null,
  overview: null,
  decided: [],
  tab: "Departments",
};
const findIncident = (id) => incidents.find((i) => i.id == id);
const saveDraft = () => {
  try {
    sessionStorage.setItem("sl-draft", JSON.stringify(state.d));
  } catch (e) {}
};
try {
  const d = sessionStorage.getItem("sl-draft");
  if (d) Object.assign(state.d, JSON.parse(d));
} catch (e) {}
const signedIn = () => !!state.user;
const clearLoadedData = () => {
  incidents = [];
  state.overview = null;
  state.iaud = null;
  state.decided = [];
  decisionChecked.clear();
};
const isAdmin = () => state.user && state.user.role == "admin";
// Relative-time labels are formatted from the server's ISO created_at.
const relTime = (iso) => {
  if (!iso) return "—";
  const t = new Date(iso).getTime(),
    diff = Date.now() - t,
    m = Math.floor(diff / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ${h == 1 ? "hr" : "hrs"} ago`;
  const day = new Date(),
    then = new Date(t);
  day.setHours(0, 0, 0, 0);
  then.setHours(0, 0, 0, 0);
  const days = Math.round((day - then) / 86400000);
  if (days == 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(t).toLocaleDateString([], { dateStyle: "medium" });
};
const sameDay = (a, b) =>
  a.getFullYear() == b.getFullYear() && a.getMonth() == b.getMonth() && a.getDate() == b.getDate();
const formatDue = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso),
    now = new Date();
  if (sameDay(d, now)) return "Today";
  const tm = new Date(now);
  tm.setDate(tm.getDate() + 1);
  if (sameDay(d, tm)) return "Tomorrow";
  return d.toLocaleDateString([], { dateStyle: "medium" });
};
const dueIso = (label) => {
  const end = new Date();
  if (label == "Tomorrow") end.setDate(end.getDate() + 1);
  else if (label == "This week") end.setDate(end.getDate() + 7);
  end.setHours(18, 0, 0, 0);
  return end.toISOString();
};
const isResolvedThisMonth = (i) =>
  i.s == "res" &&
  i.resolved_at &&
  new Date(i.resolved_at).getMonth() == new Date().getMonth() &&
  new Date(i.resolved_at).getFullYear() == new Date().getFullYear();
const errorBox = (id) => (id ? `<div id="${id}" class="err" role="alert"></div>` : "");
const showFormError = (id, message) => {
  const target = document.getElementById(id);
  if (target) target.textContent = message;
};
function toast(m) {
  const t = document.getElementById("toast");
  t.textContent = m;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2800);
}
const goTo = (h) => {
  location.hash = h;
};
const THEME_LABELS = {
  auto: "Auto",
  light: "Light",
  dark: "Dark",
};
const currentTheme = () => {
  try {
    return localStorage.getItem("sl-theme") || "auto";
  } catch (e) {
    return "auto";
  }
};
const applyTheme = () => {
  const theme = currentTheme();
  if (theme == "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset.theme = theme;
};
const themeButton = () =>
  `<button class="btn" data-act="theme">Theme: ${THEME_LABELS[currentTheme()]}</button>`;
const LOGO = `<svg viewBox="0 0 72 72" width="38" height="38" aria-hidden="true"><path d="M42 12A20 20 0 1 0 46 52" fill="none" style="stroke:var(--h)" stroke-width="9" stroke-linecap="round"/><path d="M26 60A20 20 0 1 0 30 20" fill="none" stroke="#6D9DFF" stroke-width="9" stroke-linecap="round" transform="translate(6 -2)"/></svg>`;
const photoBlock = (src) => (src ? `<img class="thumb" src="${src}" alt="Attached photo">` : "");
function shrinkImage(file, done) {
  const reader = new FileReader();
  reader.onload = () => {
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, 480 / Math.max(image.width, image.height)),
        canvas = document.createElement("canvas");
      canvas.width = image.width * scale;
      canvas.height = image.height * scale;
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      done(canvas.toDataURL("image/jpeg", 0.7));
    };
    image.onerror = () => toast("That file couldn’t be read as an image.");
    image.src = reader.result;
  };
  reader.readAsDataURL(file);
}
// Rule-based keyword helper for the draft summary and default priority.
const suggestFromText = (t) => {
  const x = (t || "").toLowerCase();
  let c = /light|power|electric|bulb/.test(x)
    ? CATEGORIES[0]
    : /water|leak|pipe|tap/.test(x)
      ? CATEGORIES[1]
      : /road|walk|pothole|tile/.test(x)
        ? CATEGORIES[2]
        : /bin|waste|trash|refuse|dirty/.test(x)
          ? CATEGORIES[3]
          : CATEGORIES[4];
  return {
    c,
    p: /dark|fire|flood|spark|unsafe|burst|night/.test(x) ? "high" : "med",
    sum: (t || "")
      .split(/[.!?]/)[0]
      .slice(0, 100),
  };
};
const studentNav = (a) => `<nav class="bn" aria-label="Main"><div>${[
  ["home", "⌂", "Home"],
  ["mine", "☰", "My reports"],
  ["rep", "＋", "Report"],
]
  .map(
    ([k, i, l]) =>
      `<button data-go="#/s/${k}" ${a === k ? "aria-current=page" : ""}><i>${i}</i>${l}</button>`,
  )
  .join("")}</div>
</nav>
`;
const studentHeader = (
  t,
  sub,
) => `<header class="row" style="cursor:default"><div style="display:flex;gap:10px;align-items:center">${LOGO}<div><b style="font:700 19px Manrope;color:var(--h)">${t}</b>${
  sub
    ? `<div class="s x">${sub}</div>
`
    : ""
}</div>
</div>
<button class="ic bl" data-go="#/s/prof" aria-label="Profile and settings" style="border:0;cursor:pointer">${escapeHtml(
  (state.user.name || "?")[0] || "A",
)}</button></header>
`;
const backLink = (h, l) => `<button class="lnk" data-go="${h}">← ${l || "Back"}</button>`;
const STATUS_ICONS = {
  rev: ["wn", "↗"],
  res: ["ok", "✓"],
  prg: ["bl", "↗"],
  asg: ["tl", "↗"],
  sub: ["bl", "↗"],
  rej: ["dg", "✕"],
};
const reportCard = (
  i,
) => `<button class="card row" data-go="#/s/inc/${i.id}"><span class="ic ${STATUS_ICONS[i.s][0]}" aria-hidden="true">${STATUS_ICONS[i.s][1]}</span><div><b>${escapeHtml(i.t)}</b><div class="s x">${escapeHtml(i.l)} · ${relTime(i.created_at)}</div>
</div>
${badge(STATUS, i.s)}</button>`;
const studentScreens = {
  home: () => {
    const open = incidents.filter((i) => !["res", "rej"].includes(i.s)).length,
      resolved = incidents.filter(isResolvedThisMonth).length;
    return `<div class="m">${studentHeader("SignalLoop", "From report to resolution")}<div><h1>Hi, ${escapeHtml(
      (state.user.name || "").split(" ")[0],
    )} 👋</h1>
<p class="s">Help make your campus safer and better.</p>
</div>

<div class="hero"><h2>See a problem on campus?</h2>
<p>Tell us what happened. We’ll help route it to the right team.</p>
<button class="btn pri" data-go="#/s/rep">＋ Report an issue</button></div>

<div class="row" style="cursor:default"><h2>Your reports at a glance</h2>
</div>

<div class="g2"><div class="card"><span class="ic tl" aria-hidden="true">◷</span><h1 style="margin-top:8px">${open}</h1>
<span class="s">Open reports</span></div>
<div class="card"><span class="ic ok" aria-hidden="true">✓</span><h1 style="margin-top:8px">${resolved}</h1>
<span class="s">Resolved this month</span></div>
</div>

<div class="row" style="cursor:default"><h2>My recent reports</h2>
<button class="lnk" data-go="#/s/mine">See all</button></div>
${incidents
  .slice(0, 3)
  .map((i) => reportCard(i))
  .join("") || '<div class="card s">You haven’t reported anything yet.</div>'}${studentNav("home")}</div>
`;
  },
  mine: () => {
    const f = state.mf || "all",
      l = incidents.filter((i) =>
        f == "all" ? true : f == "prog" ? !["res", "rej"].includes(i.s) : ["res"].includes(i.s),
      );
    return `<div class="m">${studentHeader("SignalLoop")}<div><h1>My reports</h1>
<p class="s">Track the issues you’ve reported.</p>
</div>

<input id="mq" placeholder="Search your reports" aria-label="Search your reports" value="${escapeHtml(state.mq || "")}"><div class="fl">${[
      ["all", "All"],
      ["prog", "In progress"],
      ["res", "Resolved"],
    ]
      .map(
        ([k, t]) =>
          `<button class="pill" data-act="mf" data-v="${k}" aria-pressed="${f == k}">${t}</button>`,
      )
      .join("")}</div>

<div id="ml" style="display:grid;gap:12px">${myReportsList()}</div>
<button class="btn pri" data-go="#/s/rep">＋ Report a new issue</button>${studentNav("mine")}</div>
`;
  },
  rep: () => {
    const d = state.d,
      e = state.err;
    return `<div class="m">${backLink("#/s/home")}<div><h1>Report an issue</h1>
<p class="s">Share what you noticed. You can use your voice.</p>
</div>
<div class="g2" style="grid-template-columns:repeat(3,1fr);gap:8px" aria-label="Step 1 of 3"><div class="bar"><i style="width:100%;background:var(--teal)"></i></div>
<div class="bar"></div>
<div class="bar"></div>
</div>

<h2>What kind of problem is it?</h2>
<div class="g2" role="group" aria-label="Category">${CATEGORIES.map((c) => `<button class="chip" data-act="cat" data-v="${c}" aria-pressed="${d.c == c}">${c}</button>`).join("")}</div>
${
  e.c
    ? `<p class="err" role="alert">${e.c}</p>
`
    : ""
}
<h2>Describe what happened</h2>
<div class="card"><textarea id="desc" aria-label="Describe what happened" placeholder="E.g. The streetlight near the library has been off for three nights…" ${e.d ? 'aria-invalid="true"' : ""}>${escapeHtml(d.d)}</textarea><button class="btn tl" style="margin-top:10px" data-act="voice">🎙 Describe with voice</button><p class="s x" style="margin-top:6px">Voice is optional; you can edit the text afterwards.</p>
</div>
${
  e.d
    ? `<p class="err" role="alert">${e.d}</p>
`
    : ""
}
<h2>Where is it?</h2>
<select id="loc" aria-label="Campus location" ${e.l ? 'aria-invalid="true"' : ""}><option value="">Choose campus location</option>${LOCATIONS.map((l) => `<option ${d.l == l ? "selected" : ""}>${l}</option>`).join("")}</select>${
      e.l
        ? `<p class="err" role="alert">${e.l}</p>
`
        : ""
    }
<h2>Add a photo (optional)</h2>
<label style="all:unset;display:block"><span class="card" style="display:block;cursor:pointer;color:var(--tlT);font-weight:600">${d.img ? photoBlock(d.img) : "＋ Add photo or take a picture"}</span><input type="file" id="ph" accept="image/*" hidden></label><p class="s x" style="margin-top:6px">Your photo will be attached to your report when you submit it.</p>
<button class="btn pri" data-act="next">Continue →</button><p class="s x" style="text-align:center">Your details are only shared with the campus team handling this report.</p>
${studentNav("rep")}</div>
`;
  },
  rev: () => {
    const d = state.d,
      a = suggestFromText(d.d),
      c = d.ac || d.c || a.c,
      dup = d.l ? incidents.filter((i) => i.l == d.l && !["res", "rej"].includes(i.s)).slice(0, 1) : [];
    return `<div class="m">${backLink("#/s/rep")}<div><h1>Review your report</h1>
<p class="s">We’ve organised the details. Please check them before sending.</p>
</div>

<div class="ai"><b>✦ Automatic summary</b><p style="margin-top:6px">${escapeHtml(a.sum) || "No summary available"}.</p>
<p class="s x" style="margin-top:6px">Keyword-based suggestion: ${escapeHtml(a.c)}, ${PRIORITY[a.p][0]} priority. You can change the category below.</p>
</div>

<h2>Possible matching reports</h2>
<p class="s">Check whether someone has already reported this issue.</p>
${
  dup
    .map(
      (
        i,
      ) => `<div class="card"><b>${escapeHtml(i.t)} — ${escapeHtml(i.l)}</b><div class="s x">Same location · reported ${relTime(i.created_at)}</div>
<div style="margin-top:8px">${badge(STATUS, i.s)}</div>
</div>
`,
    )
    .join("") || '<p class="s">No similar reports found at this location.</p>'
}
<button class="card row" data-act="diff" aria-pressed="${!!d.diff}"><span class="ic tl" aria-hidden="true">${d.diff ? "✓" : "＋"}</span><div>This is a different issue</div>
</button>
<h2>Category</h2>
<div class="card row" style="cursor:default"><select id="ac" aria-label="Category" style="border:0;padding:0">${CATEGORIES.map((x) => `<option ${x == c ? "selected" : ""}>${x}</option>`).join("")}</select></div>
<p class="s x">A campus team reviews your report.</p>

<button class="btn pri" data-act="submit" ${state.busy ? "disabled" : ""}>${state.busy ? "Submitting…" : "Submit report →"}</button><button class="lnk" style="width:100%" data-act="draft">Save as draft</button></div>
`;
  },
  conf: () => {
    const i = findIncident(state.last);
    return `<div class="m" style="text-align:center"><div class="ic tl" style="width:120px;height:120px;margin:40px auto 0;font-size:48px" aria-hidden="true">✓</div>
<h1>Report submitted!</h1>
<p class="s">Thanks for helping improve your campus.</p>

<div class="card" style="text-align:left"><span class="s x">YOUR REFERENCE NUMBER</span><h1 style="margin:6px 0">${i ? refNumber(i.id) : "—"}</h1>
<span class="s x">Keep this number to track progress.</span></div>

<div style="text-align:left"><h2>What happens next?</h2>
${[
  "Campus team reviews the details",
  "The report is assigned to a team",
  "You’ll get updates as it progresses",
]
  .map(
    (
      t,
      n,
    ) => `<p style="display:flex;gap:12px;align-items:center;margin-top:12px"><span class="ic bl" style="width:36px;height:36px">${n + 1}</span>${t}</p>
`,
  )
  .join("")}</div>

${
  i
    ? `<button class="btn pri" data-go="#/s/inc/${i.id}">Track my report</button>`
    : '<button class="btn pri" data-go="#/s/home">Back to home</button>'
}<button class="lnk" data-go="#/s/home">Back to home</button></div>
`;
  },
  inc: (a) => {
    const i = findIncident(a);
    if (!i) return studentScreens.mine();
    const steps = [
        ["Report received", "Your report was received by SignalLoop."],
        ["Under review", "Campus operations is checking the details."],
        [
          "Assigned to " + (i.dept || "maintenance"),
          i.dept ? "Work is being scheduled." : "We’ll notify you when a team is assigned.",
        ],
        ["Resolved", "The work is complete."],
      ],
      n = {
        sub: 1,
        rev: 2,
        asg: 3,
        prg: 3,
        res: 4,
        rej: 2,
      }[i.s];
    return `<div class="m">${backLink("#/s/mine", "My reports")}<h1>${escapeHtml(i.t)}</h1>
<div>${badge(STATUS, i.s)}</div>
<p class="s">${refNumber(i.id)} · Reported ${relTime(i.created_at)}</p>

<div class="card row" style="cursor:default"><span class="ic tl" aria-hidden="true">⌖</span><div><b>${escapeHtml(i.l)}</b><div class="s">${escapeHtml(i.d)}</div>
</div>
</div>
${i.ph ? `<div id="incident-photo-${i.id}" class="card"><p class="s">Loading attached photo…</p></div>` : ""}${
      i.due ? `<div class="card row" style="cursor:default"><span class="ic wn" aria-hidden="true">◷</span><div><b>Target date</b><div class="s x">${formatDue(i.due)}${i.dept ? " · " + escapeHtml(i.dept) : ""}</div>
</div>
</div>
` : ""
    }<h2>Progress</h2>
<ol class="tl2">${steps
      .map(
        (
          s,
          k,
        ) => `<li><span class="ic" ${k < n ? "" : 'style="background:var(--bd);color:var(--t2)"'}>${k < n ? "✓" : "○"}</span><div><b>${s[0]}</b><div class="s x">${k < n ? "Done" : "Pending"}</div>
<div class="s">${s[1]}</div>
</div>
</li>
`,
      )
      .join("")}</ol>
${studentNav("mine")}</div>
`;
  },
  prof: () => `<div class="m">${backLink("#/s/home")}<h1>Profile &amp; settings</h1>
<div class="card row" style="cursor:default"><span class="ic bl" style="width:64px;height:64px;font-size:24px">${escapeHtml((state.user.name || "?")[0] || "A")}</span><div><h2>${escapeHtml(state.user.name)}</h2>
<div class="s">${escapeHtml(state.user.email)}</div>
<span class="b tl">${state.user.role == "admin" ? "Campus admin" : "Student"}</span></div>
</div>
<p class="s x">Name and email are managed on the server; profile editing isn’t available yet.</p>
<p class="s x">PREFERENCES</p>
${[["Help & support", "FAQs and contact information"]]
  .map(
    (
      [a, b],
    ) => `<button class="card row" data-act="soon" data-v="${a}"><div><b>${a.replace("&", "&amp;")}</b><div class="s x">${b.replace("&", "&amp;")}</div>
</div>
›</button>`,
  )
  .join("")}${themeButton()}<button class="btn" style="color:var(--dgT);border:0;background:none" data-act="out">Sign out</button><p class="s x" style="text-align:center">SignalLoop · Version 1.1</p>
<p class="s x" style="text-align:center">Not an emergency service. In an emergency contact campus security directly.</p>
${studentNav("home")}</div>
`,
};
const myReportsList = () => {
  const f = state.mf || "all",
    q = (state.mq || "").toLowerCase(),
    l = incidents.filter(
      (i) =>
        (f == "all" ? true : f == "prog" ? !["res", "rej"].includes(i.s) : i.s == "res") &&
        (i.t + i.l).toLowerCase().includes(q),
    );
  return (
    l.map((i) => reportCard(i)).join("") ||
    '<div class="card s">No reports match. Try another filter or file a new report.</div>'
  );
};
const ADMIN_NAV = [
  ["ov", "Overview"],
  ["queue", "Incident queue"],
  ["dup", "Duplicate review"],
  ["dept", "Departments"],
  ["work", "Maintenance"],
  ["ana", "Analytics"],
  ["set", "Settings"],
];
const adminShell = (
  a,
  crumb,
  body,
) => `<div class="pg"><nav class="sb" aria-label="Main"><div class="lg">${LOGO.replace('style="stroke:var(--h)"', 'stroke="#fff"')}<div>SignalLoop<small>CAMPUS OPERATIONS</small></div>
</div>
${ADMIN_NAV.map(([k, t]) => `<button data-go="#/a/${k}" ${a == k ? "aria-current=page" : ""}>${t}</button>`).join("")}<button data-act="theme" style="margin-top:auto">Theme: ${THEME_LABELS[currentTheme()]}</button><button data-act="out">Sign out</button></nav>
<div class="mn"><div class="tb"><span class="s x">Campus operations / ${crumb}</span><div class="fl" style="flex-wrap:nowrap;align-items:center;justify-content:flex-end"><input id="gq" type="search" aria-label="Search incidents" placeholder="Search incidents…"><span class="ic bl" style="width:36px;height:36px">${escapeHtml(
  (state.user.name || "AO")
    .split(" ")
    .map((x) => x[0])
    .join("")
    .slice(0, 2)
    .toUpperCase(),
)}</span></div>
</div>
<main class="ct">${body}</main></div>
</div>
`;
const pageHeader = (t, s, btn) => `<div class="hd"><div><h1 tabindex="-1">${t}</h1>
<p class="s">${s}</p>
</div>
${btn || ""}</div>
`;
const statCard = (
  a,
  b,
  c,
  k,
) => `<div class="card"><span class="s">${a}</span><div class="row" style="cursor:default"><b>${b}</b><span class="x ${k || "s"}" style="font-weight:600">${c || ""}</span></div>
</div>
`;
const countByStatus = (s) => incidents.filter((i) => i.s == s).length;
const AWAITING = ["sub", "rev"];
const CLOSED = ["res", "rej"];
const countAwaiting = () => incidents.filter((i) => AWAITING.includes(i.s)).length;
const adminFirstName = () => (state.user.name || "").trim().split(/\s+/)[0] || "there";
const dayGreeting = () => {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
};
const localDateValue = (iso) => {
  const d = new Date(iso);
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
};
const endOfDayIso = (dateValue) => new Date(dateValue + "T23:59:00").toISOString();
const auditActor = (event) => (event.actor ? event.actor.display_name : "System");
const auditSummary = (event) => {
  const d = event.details || {};
  if (event.action == "incident.created") return "created the report";
  if (event.action == "incident.duplicate_reviewed")
    return `reviewed it against ${refNumber(d.possible_duplicate_id)}: ${d.decision}`;
  if (event.action == "incident.updated") {
    const after = d.after || {},
      parts = [];
    if (after.status) parts.push("status → " + (STATUS[after.status] || [after.status])[0]);
    if (after.priority) parts.push("priority → " + (PRIORITY[after.priority] || [after.priority])[0]);
    if (after.assigned_department) parts.push("assigned to " + after.assigned_department);
    if ("due_date" in after)
      parts.push(after.due_date ? "due " + new Date(after.due_date).toLocaleDateString([], { dateStyle: "medium" }) : "due date cleared");
    return parts.join("; ") || "updated the report";
  }
  return event.action;
};
const incidentTable = (
  l,
) => `<div class="tw"><table><thead><tr><th>Incident</th><th>Category</th><th>Location</th><th>Priority</th><th>Status</th><th>Reported</th></tr>
</thead><tbody>${
  l
    .map(
      (
        i,
      ) => `<tr data-go="#/a/triage/${i.id}" tabindex="0"><td><b>${escapeHtml(i.t)}</b></td><td class="s">${escapeHtml(i.c)}</td><td class="s">${escapeHtml(i.l)}</td><td>${badge(PRIORITY, i.p)}</td><td>${badge(STATUS, i.s)}</td><td class="s x">${relTime(i.created_at)}</td></tr>
`,
    )
    .join("") || '<tr><td colspan="6" class="s">No incidents match these filters.</td></tr>'
}</tbody></table></div>
`;
const filteredQueue = () => {
  const f = state.f,
    q = f.q.toLowerCase();
  return incidents.filter(
    (i) =>
      (!f.s || i.s == f.s) &&
      (!f.c || i.c == f.c) &&
      (!f.p || i.p == f.p) &&
      (i.t + i.l).toLowerCase().includes(q),
  );
};
const selectField = (id, opts, v, ph) =>
  `<select id="${id}" aria-label="${ph || id}">${ph ? `<option value="">${ph}</option>` : ""}${opts
    .map((o) => {
      const [val, label] = Array.isArray(o) ? o : [o, o];
      return `<option value="${escapeHtml(val)}" ${val == v ? "selected" : ""}>${escapeHtml(label)}</option>`;
    })
    .join("")}</select>`;
// Simple word-overlap similarity used to surface candidate duplicate reports.
const tokenSet = (s) => new Set((s || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
const similarity = (a, b) => {
  const A = tokenSet(a),
    B = tokenSet(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach((t) => {
    if (B.has(t)) inter++;
  });
  return Math.round((2 * inter) / (A.size + B.size) * 100);
};
const decisionChecked = new Set();
async function loadDecisions() {
  const open = incidents.filter((i) => !CLOSED.includes(i.s)),
    ids = new Set();
  open.forEach((a, n) =>
    open.slice(n + 1).forEach((b) => {
      if (a.l == b.l) {
        ids.add(a.id);
        ids.add(b.id);
      }
    }),
  );
  const todo = [...ids].filter((id) => !decisionChecked.has(id)).slice(0, 40);
  if (!todo.length) return;
  await Promise.all(
    todo.map(async (id) => {
      try {
        const d = await api.getIncident(id);
        (d.audit || [])
          .filter((x) => x.action == "incident.duplicate_reviewed" && x.details)
          .forEach((x) => {
            const key = pairKey(id, x.details.possible_duplicate_id);
            if (!state.decided.includes(key)) state.decided.push(key);
          });
      } catch (err) {
      } finally {
        decisionChecked.add(id);
      }
    }),
  );
  if (location.hash == "#/a/dup") {
    render.skipFocus = 1;
    render();
  }
}
const pairKey = (a, b) => [a, b].sort((x, y) => x - y).join("-");
const computePairs = () => {
  const open = incidents.filter((i) => !["res", "rej"].includes(i.s)),
    pairs = [];
  for (let x = 0; x < open.length; x++)
    for (let y = x + 1; y < open.length; y++) {
      const A = open[x],
        B = open[y];
      if (A.l == B.l) {
        const pct = similarity(A.t + " " + A.d, B.t + " " + B.d);
        if (pct >= 20) pairs.push([A.id, B.id, pct]);
      }
    }
  return pairs.sort((p, q) => q[2] - p[2]).filter((p) => !state.decided.includes(pairKey(p[0], p[1])));
};
const adminScreens = {
  ov: () => {
    const open = incidents.filter((i) => !["res", "rej"].includes(i.s)).length,
      prog = countByStatus("asg") + countByStatus("prg"),
      resMonth = incidents.filter(isResolvedThisMonth).length,
      days = (() => {
        const out = [];
        for (let k = 6; k >= 0; k--) {
          const day = new Date();
          day.setHours(0, 0, 0, 0);
          day.setDate(day.getDate() - k);
          out.push(incidents.filter((i) => i.created_at && sameDay(new Date(i.created_at), day)).length);
        }
        return out;
      })(),
      maxDay = Math.max(...days, 1),
      cats = CATEGORIES.map((c) => [c, incidents.filter((i) => i.c == c).length]).filter((x) => x[1]);
    return adminShell(
      "ov",
      "Overview",
      pageHeader(
        `${dayGreeting()}, ${escapeHtml(adminFirstName())}`,
        "Here’s what’s happening across your campus today.",
        `<button class="btn pri fit" data-go="#/a/add">＋ New incident</button>`,
      ) +
        `<div class="k">${statCard("Total reports", incidents.length, state.overview ? state.overview.total_students + (state.overview.total_students == 1 ? " student" : " students") : "", "tl") + statCard("Awaiting review", countAwaiting(), "Needs action", "wn") + statCard("In progress", prog, "Assigned and working", "tl") + statCard("Resolved this month", resMonth, "Done", "ok")}</div>

<div class="cols"><div class="card"><div class="row" style="cursor:default"><div><h2>Incident activity</h2>
<span class="s x">Reports submitted last 7 days</span></div>
</div>
<div class="ch" role="img" aria-label="Reports submitted in the last seven days" style="margin-top:14px">${days.map((h, n) => `<i class="${n == 6 ? "on" : ""}" style="height:${Math.max(8, Math.round((h / maxDay) * 100))}%" title="${h}"></i>`).join("")}</div>
<div class="row s x" style="cursor:default;margin-top:6px">${["-6d", "-5d", "-4d", "-3d", "-2d", "Yest.", "Today"].map((d) => `<span>${d}</span>`).join("")}</div>
</div>

<div class="card"><h2>Reports by category</h2>
<span class="s x">Most common campus issues</span>${
          cats
            .map(
              (
                c,
              ) => `<div style="margin-top:12px"><div class="row" style="cursor:default"><span>${escapeHtml(c[0])}</span><span class="s x">${c[1]}</span></div>
<div class="bar"><i style="width:${Math.round((c[1] / Math.max(1, incidents.length)) * 100)}%;background:var(--teal)"></i></div>
</div>
`,
            )
            .join("") || '<p class="s" style="margin-top:12px">No reports yet.</p>'
        }</div>
</div>

<div class="card"><div class="row" style="cursor:default"><h2>Needs your attention</h2>
<button class="lnk" data-go="#/a/queue">View all incidents →</button></div>
${incidentTable(incidents.filter((i) => AWAITING.includes(i.s)).slice(0, 4))}</div>

<div class="card"><h2>Recent activity</h2>
${
  ((state.overview && state.overview.recent_audit_events) || [])
    .map(
      (e) => `<p class="s" style="margin-top:8px">${relTime(e.created_at)} · ${escapeHtml(auditActor(e))} ${escapeHtml(auditSummary(e))} on ${refNumber(e.incident_id)}</p>
`,
    )
    .join("") || '<p class="s" style="margin-top:8px">No activity yet.</p>'
}</div>
`,
    );
  },
  add: () =>
    adminShell(
      "queue",
      "Incident queue / New incident",
      pageHeader("New incident", "Log a report for a student or from a phone call.") +
        `<div class="card" style="max-width:720px"><label for="ni-t">Title</label><input id="ni-t" placeholder="E.g. Broken window in Main Hall"><label for="ni-c">Category</label><select id="ni-c"><option value="">Choose category</option>${CATEGORIES.map((c) => `<option>${escapeHtml(c)}</option>`).join("")}</select><label for="ni-l">Location</label><select id="ni-l"><option value="">Choose location</option>${LOCATIONS.map((l) => `<option>${escapeHtml(l)}</option>`).join("")}</select><label for="ni-p">Priority</label><select id="ni-p">${Object.entries(
          PRIORITY,
        )
          .map(([k, x]) => `<option value="${k}" ${k == "med" ? "selected" : ""}>${x[0]}</option>`)
          .join(
            "",
          )}</select><label for="ni-d">Description</label><textarea id="ni-d"></textarea><div id="ni-e" class="err" role="alert"></div>
<div class="fl" style="margin-top:16px"><button class="btn pri fit" data-act="create">Create incident</button><button class="btn fit" data-go="#/a/queue">Cancel</button></div>
</div>
`,
    ),
  queue: () =>
    adminShell(
      "queue",
      "Incident queue",
      pageHeader(
        "Incident queue",
        "Review, triage and route reports to the right campus team.",
        `<button class="btn pri fit" data-go="#/a/add">＋ Add incident</button>`,
      ) +
        `<div class="k">${
          statCard("All reports", incidents.length, "Across campus", "tl") +
          statCard("Awaiting review", countAwaiting(), "Needs action", "wn") +
          statCard(
            "High priority",
            incidents.filter((i) => ["high", "urg"].includes(i.p) && i.s != "res").length,
            "Urgent",
            "dg",
          ) +
          statCard(
            "Unassigned",
            incidents.filter((i) => !i.dept && !["res", "rej"].includes(i.s)).length,
            "Needs routing",
            "bl",
          )
        }</div>

<div class="card"><div class="fl">${
          selectField(
            "fs",
            Object.entries(STATUS).map(([k, v]) => [k, v[0]]),
            state.f.s,
            "All statuses",
          ) +
          selectField("fc", CATEGORIES, state.f.c, "All categories") +
          selectField(
            "fp",
            Object.entries(PRIORITY).map(([k, v]) => [k, v[0]]),
            state.f.p,
            "Any priority",
          )
        }<input id="fq" placeholder="Search by title or location" aria-label="Search by title or location" value="${escapeHtml(state.f.q)}"></div>
<p class="s x" style="margin:12px 0" id="fn"></p>
<div id="qt">${incidentTable(filteredQueue())}</div>
</div>
`,
    ),
  triage: (a) => {
    const i = findIncident(a);
    if (!i) return adminScreens.queue();
    if (!state.iaud || state.iaud.incident_id != i.id) loadIncidentDetail(i.id);
    const best = incidents
        .filter((x) => x.id != i.id && x.l == i.l && !CLOSED.includes(x.s))
        .map((x) => [x, similarity(i.t + " " + i.d, x.t + " " + x.d)])
        .sort((p, q) => q[1] - p[1])[0],
      events = state.iaud && state.iaud.incident_id == i.id ? state.iaud.items : null,
      reporter = i.reporter ? `${i.reporter.display_name} (${i.reporter.email})` : "Reporter";
    return adminShell(
      "queue",
      "Incident queue / Incident detail",
      pageHeader(
        "Incident triage",
        "Review the report, set its status and priority, and assign the right response team.",
      ) +
        `<div class="row" style="cursor:default;justify-content:flex-start;flex-wrap:wrap">${badge(STATUS, i.s)}<span class="s">${refNumber(i.id)} · Submitted ${relTime(i.created_at)}</span></div>

<div class="cols"><div style="display:grid;gap:18px"><div class="card"><h2>${escapeHtml(i.t)}</h2>
<p class="s x" style="margin:4px 0 14px">Reported by ${escapeHtml(reporter)} · Location: ${escapeHtml(i.l)} · Category: ${escapeHtml(i.c)}</p>
<span class="s x">REPORT DESCRIPTION</span><p style="margin:6px 0 0;white-space:pre-wrap">${escapeHtml(i.d)}</p></div>

${
  best
    ? `<div class="card"><h2>Possible duplicate</h2>
<p class="s">Another open report at ${escapeHtml(i.l)} with similar wording.</p>
<div class="row" style="cursor:default;margin-top:10px"><b>${refNumber(best[0].id)} · ${escapeHtml(best[0].t)}</b></div>
<div class="row" style="cursor:default;margin-top:8px"><span class="b wn">${best[1]}% text overlap</span><button class="lnk" data-go="#/a/dup">Review duplicates →</button></div>
</div>
`
    : ""
}
<div class="card"><h2>History</h2>
${
  events
    ? events
        .map(
          (x) => `<p class="s" style="margin-top:8px">${new Date(x.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })} · ${escapeHtml(auditActor(x))} ${escapeHtml(auditSummary(x))}</p>
`,
        )
        .join("") || '<p class="s x" style="margin-top:8px">No history yet.</p>'
    : '<p class="s x" style="margin-top:8px">Loading history…</p>'
}</div>
</div>

<div style="display:grid;gap:18px;align-content:start"><div class="card"><h2>Triage</h2>
<label for="ts">Status</label>${selectField(
          "ts",
          Object.entries(STATUS).map(([k, v]) => [k, v[0]]),
          i.s,
        )}<label for="tp">Priority</label>${selectField(
          "tp",
          Object.entries(PRIORITY).map(([k, v]) => [k, v[0]]),
          i.p,
        )}</div>

<div class="card"><h2>Assignment</h2>
<label for="td">Department</label>${selectField(
          "td",
          DEPARTMENTS.map((d) => d[0]),
          i.dept || "",
          "Choose department",
        )}<label for="tdue">Due date (optional)</label><input id="tdue" type="date" value="${i.due ? localDateValue(i.due) : ""}"><div id="te" class="err" role="alert"></div>
<p class="s x" style="margin-top:10px">Choosing a department for a new report marks it as assigned.</p>
<button class="btn pri" style="margin-top:14px" data-act="assign" data-v="${i.id}">Save changes</button></div>
</div>
</div>
`,
    );
  },
  dup: () => {
    const p = computePairs()[0];
    const body = p
      ? (() => {
          const A = findIncident(p[0]),
            B = findIncident(p[1]);
          return `<span class="b wn fit" style="width:fit-content">${computePairs().length} pair${computePairs().length > 1 ? "s" : ""} awaiting review</span><div class="two">${[
            [A, "NEW REPORT", badge(PRIORITY, A.p)],
            [B, "POTENTIAL MATCH", `<span class="b wn">${p[2]}% text overlap</span>`],
          ]
            .map(
              ([
                r,
                l,
                b,
              ]) => `<div class="card"><span class="s x">${l}</span><h2 style="margin:6px 0">${escapeHtml(r.t)}</h2>
<p class="s x">${escapeHtml(r.l)} · Reported ${relTime(r.created_at)}</p>
<p style="margin:12px 0">${escapeHtml(r.d)}</p>
${b}</div>
`,
            )
            .join("")}</div>
<div class="ai"><b>✦ Why this was suggested</b><p style="margin-top:6px">Same location with overlapping wording. Your decision is saved to the audit trail; it doesn’t merge or close either report.</p>
</div>
<div class="fl"><button class="btn pri" data-act="link" data-v="${A.id}-${B.id}">Mark as duplicate</button><button class="btn" data-act="sep" data-v="${A.id}-${B.id}">Keep separate</button></div>
`;
        })()
      : `<div class="card s">All caught up. No duplicate pairs are waiting for review.</div>
`;
    return adminShell(
      "dup",
      "Duplicate review",
      pageHeader(
        "Duplicate review",
        "Compare similar reports and record whether they describe the same problem.",
      ) + body,
    );
  },
  dept: () => {
    const unassigned = incidents.filter((i) => !i.dept && !CLOSED.includes(i.s)),
      t = unassigned.find((i) => i.id == state.dsel) || unassigned[0];
    return adminShell(
      "dept",
      "Departments",
      pageHeader(
        "Department assignment",
        "Route incidents to the team best placed to resolve them.",
      ) +
        `<div class="cols"><div class="card"><h2>Campus departments</h2>
<span class="s x">Open reports currently assigned to each team</span>${DEPARTMENTS.map(
          (
            d,
          ) => `<div class="row" style="cursor:default;border-top:1px solid var(--bd);padding:14px 0;margin-top:10px"><div><b>${d[0]}</b><div class="s x">${d[1]} · ${incidents.filter((i) => i.dept == d[0] && !CLOSED.includes(i.s)).length} active</div>
</div>
<button class="b bl" style="border:0;cursor:pointer" data-act="pick" data-v="${d[0]}">Assign</button></div>
`,
        ).join("")}</div>

<div style="display:grid;gap:18px;align-content:start">${
          t
            ? `<div class="card"><h2>Assign an incident</h2>
<label for="da">Incident</label>${selectField(
                "da",
                unassigned.map((i) => [i.id, refNumber(i.id) + " · " + i.t]),
                t.id,
              )}<label for="td">Department</label>${selectField(
                "td",
                DEPARTMENTS.map((d) => d[0]),
                state.dp || "",
                "Choose department",
              )}<label for="tdue">Due date (optional)</label><input id="tdue" type="date"><div id="te" class="err" role="alert"></div>
</div>
<button class="btn pri" data-act="assign" data-v="${t.id}">Save assignment</button>`
            : '<div class="card s">Every open incident is assigned.</div>'
        }</div>
</div>
`,
    );
  },
  work: () => {
    const l = incidents.filter((i) => i.dept && !["res", "rej"].includes(i.s)),
      dueToday = l.filter((i) => i.due && sameDay(new Date(i.due), new Date())),
      completedWeek = incidents.filter(
        (i) => i.s == "res" && i.resolved_at && Date.now() - new Date(i.resolved_at) < 7 * 86400000,
      ).length;
    return adminShell(
      "work",
      "Maintenance queue",
      pageHeader(
        "Maintenance work queue",
        "Work assigned to your teams, with priority and due-date visibility.",
        `<button class="btn pri fit" ${l[0] ? `data-go="#/a/res/${l[0].id}"` : "disabled"}>＋ Add work update</button>`,
      ) +
        `<div class="k">${statCard("Assigned work", l.length) + statCard("High priority", l.filter((i) => ["high", "urg"].includes(i.p)).length) + statCard("Due today", dueToday.length) + statCard("Completed this week", completedWeek)}</div>
<div class="card"><h2>Assigned work</h2>
<span class="s x">Click a task to record progress or resolve it</span><div class="tw"><table><thead><tr><th>Task</th><th>Incident</th><th>Priority</th><th>Due</th><th>Status</th></tr>
</thead><tbody>${
          l
            .map(
              (
                i,
              ) => `<tr data-go="#/a/res/${i.id}" tabindex="0"><td><b>${escapeHtml(i.t)}</b></td><td class="s">${escapeHtml(i.l)}</td><td>${badge(PRIORITY, i.p)}</td><td class="s">${formatDue(i.due)}</td><td>${badge(STATUS, i.s)}</td></tr>
`,
            )
            .join("") || '<tr><td colspan="5" class="s">No open work assigned.</td></tr>'
        }</tbody></table></div>
</div>
`,
    );
  },
  res: (a) => {
    const i = findIncident(a);
    if (!i) return adminScreens.work();
    return adminShell(
      "work",
      "Maintenance / Resolution",
      pageHeader(
        "Update resolution",
        "Record progress or mark the report resolved. The reporter sees status changes.",
      ) +
        `<div class="cols"><div style="display:grid;gap:18px"><div class="card"><h2>${escapeHtml(i.t)}</h2>
<p class="s">${escapeHtml(i.l)} · Assigned to ${escapeHtml(i.dept || "—")}</p>
<div style="margin-top:8px">${badge(STATUS, i.s)}</div>
</div>
</div>

<div style="display:grid;gap:14px;align-content:start"><div class="ai"><h2>✓ Ready to resolve?</h2>
<p style="margin:10px 0">Once confirmed, the report is marked resolved and the reporter can see the new status.</p>
<span class="s x">FINAL STATUS</span><div><span class="b ok">Resolved</span></div>
<p class="s x" style="margin-top:10px">Only the status change is recorded. The server doesn’t store work notes yet.</p>
</div>
<button class="btn pri" data-act="resolve" data-v="${i.id}">Mark as resolved</button><button class="btn" data-act="note" data-v="${i.id}" ${i.s == "prg" ? "disabled" : ""}>Mark as in progress</button></div>
</div>
`,
    );
  },
  ana: () => {
    const open = incidents.filter((i) => !["res", "rej"].includes(i.s)).length,
      rates = ["sub", "rev", "asg", "prg", "res", "rej"];
    return adminShell(
      "ana",
      "Analytics",
      pageHeader(
        "Campus incident analytics",
        "Live counts from the incident database.",
        `<span class="b bl">All time</span>`,
      ) +
        `<div class="k">${statCard("Reports received", incidents.length) + statCard("Awaiting review", countAwaiting()) + statCard("In progress", countByStatus("asg") + countByStatus("prg")) + statCard("Resolved", countByStatus("res"), "Done", "ok")}</div>
<div class="cols"><div class="card"><h2>Incidents by status</h2>
${rates
  .map(
    (
      c,
    ) => `<div style="margin-top:12px"><div class="row" style="cursor:default"><span>${STATUS[c][0]}</span><span class="s x">${countByStatus(c)}</span></div>
<div class="bar"><i style="width:${Math.round((countByStatus(c) / Math.max(1, incidents.length)) * 100)}%;background:var(--teal)"></i></div>
</div>
`,
  )
  .join("")}</div>
<div class="card"><h2>Reports by category</h2>
<span class="s x">Most common campus issues</span>${CATEGORIES.map(
          (c) =>
            `<div style="margin-top:12px"><div class="row" style="cursor:default"><span>${escapeHtml(c)}</span><span class="s x">${incidents.filter((i) => i.c == c).length}</span></div>
<div class="bar"><i style="width:${Math.round((incidents.filter((i) => i.c == c).length / Math.max(1, incidents.length)) * 100)}%;background:#6D9DFF"></i></div>
</div>
`,
        ).join("")}</div>
</div>
<div class="cols"><div class="card"><h2>Current open reports</h2>
<span class="s x">${open} report${open == 1 ? "" : "s"} open right now</span><div class="tw" style="margin-top:10px"><table><thead><tr><th>Incident</th><th>Status</th><th>Due</th></tr>
</thead><tbody>${
          incidents
            .filter((i) => !["res", "rej"].includes(i.s))
            .slice(0, 8)
            .map(
              (
                i,
              ) => `<tr data-go="#/a/triage/${i.id}" tabindex="0"><td><b>${escapeHtml(i.t)}</b></td><td>${badge(STATUS, i.s)}</td><td class="s">${formatDue(i.due)}</td></tr>
`,
            )
            .join("") || '<tr><td colspan="3" class="s">Nothing open.</td></tr>'
        }</tbody></table></div>
</div>
</div>
`,
    );
  },
  set: () =>
    adminShell(
      "set",
      "Settings",
      pageHeader(
        "Departments & system settings",
        "See the departments, categories and priority levels the system uses.",
      ) +
        `<div class="fl" role="tablist">${["Departments", "Categories", "Priority rules"].map((t) => `<button class="pill" role="tab" data-act="tab" data-v="${t}" aria-pressed="${state.tab == t}">${t}</button>`).join("")}</div>
<div class="card">${
          state.tab == "Departments"
            ? `<div class="row" style="cursor:default"><div><h2>Department directory</h2>
<span class="s x">The server accepts only these departments.</span></div>
</div>
${DEPARTMENTS.map(
  (
    d,
  ) => `<div class="card row" style="cursor:default;margin-top:12px;border-radius:12px"><div><b>${d[0]}</b><div class="s x">${d[1]}</div>
</div>
<span class="b ok">Active</span></div>
`,
).join("")}`
            : state.tab == "Categories"
              ? `<h2>Report categories</h2>
<span class="s x">The API accepts exactly these categories; new ones aren’t configurable yet.</span>${CATEGORIES.map(
                (
                  c,
                ) => `<div class="row" style="cursor:default;border-top:1px solid var(--bd);padding:12px 0;margin-top:8px"><span>${escapeHtml(c)}</span><span class="b bl">Built in</span></div>
`,
              ).join("")}`
              : `<h2>Priority rules</h2>
<span class="s x">The API supports these four levels. They aren’t configurable.</span><p style="margin-top:12px">${Object.keys(PRIORITY).map((k) => `<span class="b ${PRIORITY[k][1]}" style="margin-right:8px">${PRIORITY[k][0]}</span>`).join("")}</p>
`
        }</div>
`,
    ),
};
const deniedScreen = () =>
  `<div class="m"><h1>Access denied</h1><div class="card row" style="cursor:default"><div><b>Your account doesn’t have permission to open that area.</b><div class="s x">Campus admin area is for admin accounts only. The server checks this too.</div></div></div><button class="btn pri" data-act="out">Sign out</button></div>`;
async function refreshIncidents() {
  const items = await api.listIncidents();
  incidents = items;
  if (isAdmin()) {
    try {
      state.overview = await api.adminOverview();
    } catch (e) {
      if (e.status === 401) throw e;
    }
  }
  lastSync = Date.now();
  render.skipFocus = 1;
  render();
}
const loadIncidentDetail = (id) => {
  state.iaud = null;
  api
    .getIncident(id)
    .then((d) => {
      state.iaud = {
        incident_id: d.incident.id,
        items: d.audit || [],
      };
      if (location.hash.includes("/triage/" + id)) {
        render.skipFocus = 1;
        render();
      }
    })
    .catch(() => {
      state.iaud = {
        incident_id: id,
        items: [],
      };
    });
};
function render() {
  const [, r, p, a] = location.hash.replace("#", "").split("/");
  const app = document.getElementById("app");
  if (state.booting) {
    app.innerHTML = '<div class="m"><h1>SignalLoop</h1><p class="s" id="boot">Signing in…</p></div>';
    return;
  }
  if (!state.user) {
    app.innerHTML = signInScreen();
    return;
  }
  if (r == "a") {
    if (!isAdmin()) {
      app.innerHTML = deniedScreen();
    } else app.innerHTML = (adminScreens[p] || adminScreens.ov)(a);
  } else if (r == "s") app.innerHTML = (studentScreens[p] || studentScreens.home)(a);
  else {
    const target = state.user.role == "admin" ? "#/a/ov" : "#/s/home";
    if (location.hash.replace("#", "") !== target.replace("#", "")) {
      goTo(target);
      return;
    }
    app.innerHTML = state.user.role == "admin" ? adminScreens.ov() : studentScreens.home();
  }
  const h = app.querySelector("h1");
  if (h && !render.skipFocus) {
    h.setAttribute("tabindex", "-1");
    h.focus({
      preventScroll: true,
    });
  }
  render.skipFocus = 0;
  scrollTo(0, 0);
  if (r == "a" && p == "dup" && isAdmin()) loadDecisions();
  const fn = document.getElementById("fn");
  if (fn) fn.textContent = `Showing ${filteredQueue().length} of ${incidents.length} reports`;
  if (r === "s" && p === "inc" && a) {
    const incident = findIncident(a);

    if (incident && incident.ph) {
      const container = document.getElementById(`incident-photo-${incident.id}`);

      if (container && !container.dataset.loading) {
        container.dataset.loading = "true";

        loadIncidentPhoto(incident.id)
          .then((url) => {
            const current = document.getElementById(`incident-photo-${incident.id}`);
            if (!current) return;

            const img = document.createElement("img");
            img.className = "thumb";
            img.alt = "Attached photo";
            img.src = url;

            current.replaceChildren(img);
          })
          .catch(() => {
            const current = document.getElementById(`incident-photo-${incident.id}`);
            if (current) current.textContent = "The attached photo could not be loaded.";
          });
      }
    }
  }
}


addEventListener("hashchange", render);
const maybeSync = () => {
  const active = document.activeElement;
  if (!state.user || state.booting || Date.now() - lastSync < 8000) return;
  if (active && active.matches("input,textarea,select")) return;
  if (/^#\/(a\/(add|triage)|s\/(rep|rev))/.test(location.hash)) return;
  refreshIncidents().catch(() => {});
};
addEventListener("hashchange", maybeSync);
setInterval(() => {
  if (!document.hidden) maybeSync();
}, 30000);
const fieldValue = (id) => (document.getElementById(id) || {}).value;
const rememberTypedFields = () => {
  state.d.d = fieldValue("desc");
  state.d.l = fieldValue("loc");
};
const passwordProblem = (password) => {
  if (password.length < 12) return "Use at least 12 characters.";
  if (password.length > 128) return "Use 128 characters or fewer.";
  return "";
};
const startSession = (user) => {
  state.user = {
    name: user.display_name,
    email: user.email,
    role: user.role,
  };
  refreshIncidents();
  goTo(user.role == "admin" ? "#/a/ov" : "#/s/home");
};
const showPasswordToggle = `<label style="display:flex;gap:10px;align-items:center;text-transform:none;font-size:14px;color:var(--tx)"><input id="showpw" type="checkbox" style="width:20px">Show password</label>`;
async function signIn() {
  const email = fieldValue("em").trim().toLowerCase();
  const password = fieldValue("pw");
  state.em = email;
  const emailInvalid = !/^\S+@\S+\.\S+$/.test(email);
  showFormError("e1", emailInvalid ? "Enter a valid email address." : "");
  showFormError("e2", password ? "" : "Enter your password.");
  if (emailInvalid || !password) return;
  try {
    const data = await api.login(email, password);
    startSession(data.user);
  } catch (err) {
    showFormError(err.error == "invalid_credentials" ? "e2" : "e1", err.message);
  }
}
async function createAccount() {
  const name = fieldValue("sn").trim();
  const email = fieldValue("se").trim().toLowerCase();
  const password = fieldValue("sp");
  const problems = {
    "sn-e": name ? "" : "Enter your full name.",
    "se-e": /^\S+@\S+\.\S+$/.test(email) ? "" : "Enter a valid email address.",
    "sp-e": passwordProblem(password),
    "sc-e": fieldValue("sc") == password ? "" : "Passwords don’t match.",
  };
  Object.entries(problems).forEach(([id, message]) => showFormError(id, message));
  if (Object.values(problems).some(Boolean)) return;
  try {
    const data = await api.register({
      email,
      display_name: name,
      password,
    });
    toast("Account created. Welcome to SignalLoop!");
    startSession(data.user);
  } catch (err) {
    showFormError(err.error == "email_exists" ? "se-e" : "se-e", err.message);
  }
}
const signInForm = () => {
  const draft = state.signup || {};
  return `<form class="m" id="si" novalidate style="padding-bottom:30px"><div><h1>Welcome back</h1>
<p class="s">Sign in to report and track campus issues.</p></div>
<div><label for="em">Email address</label><input id="em" type="email" autocomplete="username" placeholder="name@university.edu" value="${escapeHtml(state.em || "")}"><div id="e1" class="err" role="alert"></div>
<label for="pw">Password</label><input id="pw" data-pw type="password" autocomplete="current-password"><div id="e2" class="err" role="alert"></div>${showPasswordToggle}</div>
${state.bootError ? `<div class="wn" style="border-radius:12px;padding:12px">${escapeHtml(state.bootError)}</div>` : ""}
<button class="btn pri" type="submit">Sign in →</button>
<p class="s x" style="text-align:center">New here? <button type="button" class="lnk" data-act="authmode" data-v="signup">Create an account</button></p></form>`;
};
const signUpForm = () => {
  const draft = state.signup || {};
  return `<form class="m" id="su" novalidate style="padding-bottom:30px"><div><h1>Create your account</h1>
<p class="s">Report campus issues and follow them to resolution.</p></div>
<div><label for="sn">Full name</label><input id="sn" autocomplete="name" value="${escapeHtml(draft.name || "")}"><div id="sn-e" class="err" role="alert"></div>
<label for="se">Email address</label><input id="se" type="email" autocomplete="username" placeholder="name@university.edu" value="${escapeHtml(draft.email || "")}"><div id="se-e" class="err" role="alert"></div>
<label for="sp">Password</label><input id="sp" data-pw type="password" autocomplete="new-password"><div id="sp-e" class="err" role="alert"></div><p class="s x">At least 12 characters.</p>
<label for="sc">Confirm password</label><input id="sc" data-pw type="password" autocomplete="new-password"><div id="sc-e" class="err" role="alert"></div>${showPasswordToggle}</div>
<button class="btn pri" type="submit">Create student account →</button>
<p class="s x" style="text-align:center">Registration creates student accounts only; campus admins are created by campus operations.</p>
<p class="s x" style="text-align:center">Already have an account? <button type="button" class="lnk" data-act="authmode" data-v="signin">Sign in</button></p></form>`;
};
const authForm = () => (state.authMode == "signup" ? signUpForm() : signInForm());
const signInScreen = () =>
  `<div class="au"><div style="background:var(--navy);color:#fff;text-align:center;padding:48px 20px"><div style="display:inline-block;background:#fff;border-radius:50%;padding:4px">${LOGO.replace('style="stroke:var(--h)"', 'stroke="#101D33"')}</div>
<div style="font:700 34px Manrope;margin-top:10px">SignalLoop</div>
<div style="color:#CBD5E1">From report to resolution</div>
</div>
${authForm()}
</div>
`;
const actions = {
  create: () => {
    const fields = {
      t: fieldValue("ni-t").trim(),
      c: fieldValue("ni-c"),
      l: fieldValue("ni-l"),
      p: fieldValue("ni-p") || "med",
      d: fieldValue("ni-d").trim(),
    };
    if (!fields.t || !fields.c || !fields.l || fields.d.length < 10) {
      document.getElementById("ni-e").textContent =
        "Fill in every field (description at least 10 characters).";
      return;
    }
    state.busy = 1;
    api
      .createIncident(fields)
      .then((i) => {
        state.iaud = null;
        toast("Incident " + refNumber(i.id) + " created.");
        return refreshIncidents().then(() => goTo("#/a/triage/" + i.id));
      })
      .catch((err) => {
        document.getElementById("ni-e").textContent = err.message;
        toast(err.message);
      })
      .finally(() => (state.busy = 0));
  },
  theme: () => {
    const names = Object.keys(THEME_LABELS),
      next = names[(names.indexOf(currentTheme()) + 1) % names.length];
    try {
      localStorage.setItem("sl-theme", next);
    } catch (e) {}
    applyTheme();
    render.skipFocus = 1;
    render();
  },
  mf: (e) => {
    state.mf = e.dataset.v;
    render.skipFocus = 1;
    render();
  },
  cat: (e) => {
    state.d.c = e.dataset.v;
    state.err.c = "";
    saveDraft();
    render.skipFocus = 1;
    render();
  },
  voice: () => {
    const R = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!R) return toast("Voice input isn’t available in this browser. Please type instead.");
    const r = new R();
    r.onresult = (x) => {
      state.d.d = (fieldValue("desc") + " " + x.results[0][0].transcript).trim();
      saveDraft();
      render.skipFocus = 1;
      render();
    };
    r.onerror = () => toast("Couldn’t hear that. Please try again or type.");
    r.start();
    toast("Listening… you can edit the text afterwards.");
  },
  next: () => {
    rememberTypedFields();
    const e = {};
    if (!state.d.c) e.c = "Please choose a category.";
    if (state.d.d.trim().length < 10) e.d = "Please describe the issue in at least 10 characters.";
    if (!state.d.l) e.l = "Please choose a campus location.";
    state.err = e;
    saveDraft();
    if (Object.keys(e).length) {
      render.skipFocus = 1;
      render();
      const x = document.querySelector(".err");
      x &&
        x.scrollIntoView({
          block: "center",
        });
      return;
    }
    state.d.ac = "";
    goTo("#/s/rev");
  },
  diff: () => {
    state.d.diff = !state.d.diff;
    render.skipFocus = 1;
    render();
  },
  draft: () => {
    state.d.ac = fieldValue("ac");
    saveDraft();
    toast("Draft saved on this device. It is not submitted yet.");
  },
  submit: async () => {
    state.d.ac = fieldValue("ac");

    if (state.busy) return;

    state.busy = 1;
    render.skipFocus = 1;
    render();

    try {
      let incidentId = state.d.pendingIncidentId;

      // Reuse an existing incident when retrying a failed photo upload.
      if (!incidentId) {
        const a = suggestFromText(state.d.d);
        const incident = await api.createIncident({
          t: a.sum.slice(0, 40) || "New report",
          c: state.d.ac || state.d.c,
          l: state.d.l,
          p: a.p,
          d: state.d.d,
        });

        incidentId = incident.id;
        state.last = incidentId;
        state.d.pendingIncidentId = incidentId;
        saveDraft();
      }

      if (state.d.img) {
        const response = await fetch(state.d.img);
        const blob = await response.blob();
        const file = new File([blob], "incident-photo.jpg", {
          type: "image/jpeg",
        });

        await api.uploadIncidentPhoto(incidentId, file);
      }

      state.last = incidentId;
      state.d = {
        c: "",
        d: "",
        l: "",
        ph: "",
        img: "",
        diff: 0,
      };
      saveDraft();

      await refreshIncidents();
      goTo("#/s/conf");
    } catch (err) {
      toast(err.message || "Submission failed. Please try again.");
      render.skipFocus = 1;
      render();
    } finally {
      state.busy = 0;
      render.skipFocus = 1;
      render();
    }
  },
  soon: (e) => toast(e.dataset.v + " isn’t available yet."),
  authmode: () => {
    state.authMode = state.authMode == "signup" ? "signin" : "signup";
    state.signup = {};
    render.skipFocus = 1;
    render();
  },
  out: () => {
    api.resetSession();
    clearLoadedData();
    state.user = null;
    state.authMode = "signin";
    state.bootError = "";
    goTo("#/");
    render();
  },
  pick: (e) => {
    state.dp = e.dataset.v;
    render.skipFocus = 1;
    render();
  },
  assign: (e) => {
    const id = e.dataset.v,
      i = findIncident(id),
      err = document.getElementById("te"),
      dept = fieldValue("td"),
      due = fieldValue("tdue"),
      status = fieldValue("ts"),
      priority = fieldValue("tp"),
      changes = {};
    if (priority && priority !== i.p) changes.p = priority;
    if (dept && dept !== i.dept) changes.dept = dept;
    if (due && (!i.due || localDateValue(i.due) !== due)) changes.due = endOfDayIso(due);
    else if (!due && i.due && document.getElementById("tdue")) changes.due = "";
    let next = status || i.s;
    if (changes.dept && next === i.s && AWAITING.includes(i.s)) next = "asg";
    if (next !== i.s) changes.s = next;
    if (!Object.keys(changes).length) {
      err.textContent = "No changes to save.";
      return;
    }
    if (changes.s === "asg" && !(changes.dept || i.dept)) {
      err.textContent = "Choose a department to assign this report.";
      return;
    }
    e.disabled = true;
    api
      .updateIncident(id, changes)
      .then(() => {
        state.dsel = null;
        state.dp = "";
        state.iaud = null;
        toast("Changes saved.");
        return refreshIncidents().then(() => goTo("#/a/queue"));
      })
      .catch((x) => {
        e.disabled = false;
        err.textContent = x.message;
      });
  },
  link: (e) => {
    const [a2, b2] = e.dataset.v.split("-").map(Number);
    api
      .reviewDuplicate(a2, {
        possible_duplicate_id: b2,
        decision: "duplicate",
      })
      .then(() => {
        state.decided.push(pairKey(a2, b2));
        toast("Marked as duplicate. Saved to the audit trail.");
        render.skipFocus = 1;
        render();
      })
      .catch((err) => toast(err.message));
  },
  sep: (e) => {
    const [a2, b2] = e.dataset.v.split("-").map(Number);
    api
      .reviewDuplicate(a2, {
        possible_duplicate_id: b2,
        decision: "different",
      })
      .then(() => {
        state.decided.push(pairKey(a2, b2));
        toast("Kept as separate incidents.");
        render.skipFocus = 1;
        render();
      })
      .catch((err) => toast(err.message));
  },
  tab: (e) => {
    state.tab = e.dataset.v;
    render.skipFocus = 1;
    render();
  },
  resolve: (e) => {
    const id = e.dataset.v;
    e.disabled = true;
    api
      .updateIncident(id, {
        s: "res",
      })
      .then(() => {
        toast("Resolved. Reporter updated in-app.");
        refreshIncidents().then(() => goTo("#/a/work")).catch(render);
      })
      .catch((err) => {
        e.disabled = false;
        toast(err.message);
      });
  },
  note: (e) => {
    const id = e.dataset.v;
    e.disabled = true;
    api
      .updateIncident(id, {
        s: "prg",
      })
      .then(() => {
        toast("Marked as in progress.");
        refreshIncidents().then(() => goTo("#/a/work")).catch(render);
      })
      .catch((err) => {
        e.disabled = false;
        toast(err.message);
      });
  },
};
document.addEventListener("click", (e) => {
  const a = e.target.closest("[data-act]");
  if (a && actions[a.dataset.act]) {
    e.preventDefault();
    return actions[a.dataset.act](a);
  }
  const g = e.target.closest("[data-go]");
  if (g) goTo(g.dataset.go);
});
document.addEventListener("keydown", (e) => {
  if (e.key == "Enter" && e.target.matches("tr[data-go]")) goTo(e.target.dataset.go);
  if (e.key == "Enter" && e.target.id == "gq") {
    state.f.q = e.target.value;
    goTo("#/a/queue");
    render();
  }
});
document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.id == "mq") {
    state.mq = t.value;
    document.getElementById("ml").innerHTML = myReportsList();
  } else if (t.id == "fq") {
    state.f.q = t.value;
    document.getElementById("qt").innerHTML = incidentTable(filteredQueue());
    document.getElementById("fn").textContent = `Showing ${filteredQueue().length} of ${incidents.length} reports`;
  }
});
document.addEventListener("change", (e) => {
  const t = e.target,
    m = {
      fs: "s",
      fc: "c",
      fp: "p",
    }[t.id];
  if (m) {
    state.f[m] = t.value;
    document.getElementById("qt").innerHTML = incidentTable(filteredQueue());
    document.getElementById("fn").textContent = `Showing ${filteredQueue().length} of ${incidents.length} reports`;
  } else if (t.id == "ph" && t.files[0]) {
    const file = t.files[0];
    rememberTypedFields();
    shrinkImage(file, (img) => {
      state.d.ph = file.name;
      state.d.img = img;
      saveDraft();
      render.skipFocus = 1;
      render();
    });
  } else if (t.id == "da") {
    state.dsel = t.value;
    render.skipFocus = 1;
    render();
  } else if (t.id == "td" && document.getElementById("da")) {
    state.dp = t.value;
  } else if (t.id == "showpw") {
    document.querySelectorAll("input[data-pw]").forEach((input) => {
      input.type = t.checked ? "text" : "password";
    });
  }
});
document.addEventListener("submit", (e) => {
  if (e.target.id == "si") {
    e.preventDefault();
    signIn();
  } else if (e.target.id == "su") {
    e.preventDefault();
    createAccount();
  }
});
api.setUnauthorizedHandler(() => {
  state.user = null;
  clearLoadedData();
  api.resetSession();
  state.authMode = "signin";
  history.replaceState(null, "", "#/");
  render();
  toast("Your session expired. Please sign in again.");
});
// Boot: validate any saved token against /auth/me, then load incidents.
const boot = () => {
  if (!api.isSignedIn()) {
    state.booting = false;
    render();
    return;
  }
  state.user = api.getUser() || null;
  api
    .me()
    .then((user) => {
      state.user = {
        name: user.display_name,
        email: user.email,
        role: user.role,
      };
      const items = api.listIncidents();
      return items;
    })
    .then((items) =>
      (isAdmin() ? api.adminOverview().catch(() => null) : Promise.resolve(null)).then((overview) => {
        incidents = items || [];
        state.overview = overview;
        state.booting = false;
        render();
      }),
    )
    .catch((err) => {
      state.user = null;
      state.booting = false;
      if (err && err.status === 0) state.bootError = err.message;
      else if (err && err.status !== 401) state.bootError = err.message;
      render();
    });
};
boot();
