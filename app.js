const SUPABASE_URL = window.SPINX_SUPABASE_URL;
const SUPABASE_KEY = window.SPINX_SUPABASE_KEY;
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const app = document.querySelector("#app");

const state = {
  session: null,
  profile: null,
  tab: "dashboard",
  message: "",
  error: "",
  selectedDate: toDateKey(new Date()),
  calendarMonth: firstOfMonth(new Date()),
  memberFilter: "all",
  editingClassId: "",
  data: {
    classes: [],
    bookings: [],
    waitlist: [],
    members: [],
    attendance: [],
    payments: [],
  },
};

const roleTabs = {
  admin: ["dashboard", "calendar", "members", "classes", "bookings", "attendance", "reports", "profile"],
  instructor: ["dashboard", "calendar", "classes", "bookings", "attendance", "profile"],
  member: ["dashboard", "calendar", "bookings", "profile"],
};

const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const weekdayValues = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function canManage() {
  return state.profile?.role === "admin";
}

function canTeach() {
  return state.profile?.role === "admin" || state.profile?.role === "instructor";
}

function canBook() {
  if (!state.profile) return false;
  if (state.profile.role !== "member") return true;
  return state.profile.status === "active" && state.profile.payment_status === "paid";
}

function statusPill(value) {
  const clean = String(value || "").replaceAll("_", " ");
  const kind = value === "active" || value === "paid" || value === "present" || value === "admin"
    ? "ok"
    : value === "pending_approval" || value === "waiting" || value === "instructor"
      ? "warn"
      : value === "member"
        ? "neutral"
        : "bad";
  return `<span class="pill ${kind}">${esc(clean)}</span>`;
}

function fullName(profile) {
  const name = `${profile?.first_name || ""} ${profile?.last_name || ""}`.trim();
  return name || profile?.email || "Unknown";
}

function firstOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addDays(date, amount) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + amount);
  return copy;
}

function toDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fromDateKey(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toTimeInput(value) {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function dateTimeFromParts(dateKey, timeValue) {
  const [hours, minutes] = String(timeValue || "05:30").split(":").map(Number);
  const date = fromDateKey(dateKey);
  date.setHours(hours || 0, minutes || 0, 0, 0);
  return date;
}

function isoLocalInput(date = new Date()) {
  const copy = new Date(date);
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
  return copy.toISOString().slice(0, 16);
}

function niceDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-ZA", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function monthTitle(date) {
  return new Intl.DateTimeFormat("en-ZA", { month: "long", year: "numeric" }).format(date);
}

function longDate(key) {
  return new Intl.DateTimeFormat("en-ZA", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(fromDateKey(key));
}

function classDateKey(klass) {
  return toDateKey(klass.starts_at);
}

function classesForDate(dateKey) {
  return state.data.classes
    .filter((klass) => classDateKey(klass) === dateKey)
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
}

function classBookings(classId) {
  return state.data.bookings.filter((booking) => booking.class_id === classId && booking.status === "booked");
}

function classWaitlist(classId) {
  return state.data.waitlist.filter((entry) => entry.class_id === classId && entry.status === "waiting");
}

function memberById(id) {
  return state.data.members.find((member) => member.id === id);
}

function attendanceFor(classId, userId) {
  return state.data.attendance.find((item) => item.class_id === classId && item.user_id === userId);
}

function setMessage(message, error = "") {
  state.message = message;
  state.error = error;
  render();
}

async function init() {
  const { data } = await db.auth.getSession();
  state.session = data.session;
  db.auth.onAuthStateChange((_event, session) => {
    state.session = session;
    state.profile = null;
    loadApp();
  });
  await loadApp();
}

async function loadApp() {
  state.error = "";
  state.message = "";

  if (!state.session) {
    renderAuth();
    return;
  }

  await loadProfile();
  await loadData();
  render();
}

async function loadProfile() {
  const user = state.session.user;
  const { data, error } = await db.from("spinx_profiles").select("*").eq("id", user.id).maybeSingle();

  if (error) {
    state.error = error.message;
    return;
  }

  if (data) {
    state.profile = data;
    return;
  }

  const meta = user.user_metadata || {};
  const fallback = {
    id: user.id,
    email: user.email,
    first_name: meta.first_name || "",
    last_name: meta.last_name || "",
    mobile: meta.mobile || "",
    emergency_contact: meta.emergency_contact || "",
    agreement_signed_at: new Date().toISOString(),
    signature_text: meta.signature_text || "",
  };
  const result = await db.from("spinx_profiles").insert(fallback).select("*").single();
  state.profile = result.data;
}

async function loadData() {
  const from = addDays(new Date(), -90);
  from.setHours(0, 0, 0, 0);
  const to = addDays(new Date(), 365);
  to.setHours(23, 59, 59, 999);

  const [classes, bookings, waitlist, attendance] = await Promise.all([
    db.from("spinx_classes").select("*").gte("starts_at", from.toISOString()).lte("starts_at", to.toISOString()).order("starts_at"),
    db.from("spinx_bookings").select("*").order("created_at", { ascending: false }),
    db.from("spinx_waitlist").select("*").order("created_at", { ascending: true }),
    db.from("spinx_attendance").select("*").order("marked_at", { ascending: false }),
  ]);

  state.data.classes = classes.data || [];
  state.data.bookings = bookings.data || [];
  state.data.waitlist = waitlist.data || [];
  state.data.attendance = attendance.data || [];

  if (canTeach()) {
    const members = await db.from("spinx_profiles").select("*").order("created_at", { ascending: false });
    state.data.members = members.data || [];
  } else {
    state.data.members = [];
  }

  if (canManage()) {
    const payments = await db.from("spinx_payments").select("*").order("due_month", { ascending: false });
    state.data.payments = payments.data || [];
  } else {
    state.data.payments = [];
  }
}

function renderAuth() {
  app.innerHTML = `
    <main class="auth-shell">
      <section class="auth-card">
        <div class="brand-panel">
          <div class="brand-mark">SX</div>
          <h1>SpinX</h1>
          <p class="lead">Clean class bookings for a small spinning studio.</p>
          <div class="auth-stats">
            <span>9 bikes</span>
            <span>Manual EFT</span>
            <span>Admin approval</span>
          </div>
        </div>
        <div class="auth-form">
          <div id="authMessage"></div>
          <div class="auth-section">
            <h2>Log in</h2>
            <form onsubmit="actions.login(event)" class="stack">
              <input name="email" type="email" placeholder="Email" autocomplete="email" required />
              <input name="password" type="password" placeholder="Password" autocomplete="current-password" required />
              <button>Log in</button>
            </form>
          </div>
          <div class="split-line"></div>
          <div class="auth-section">
            <h2>Register</h2>
            <form onsubmit="actions.register(event)" class="stack">
              <div class="form-grid">
                <input name="first_name" placeholder="First name" autocomplete="given-name" required />
                <input name="last_name" placeholder="Last name" autocomplete="family-name" required />
                <input name="mobile" placeholder="Mobile number" autocomplete="tel" required />
                <input name="emergency_contact" placeholder="Emergency contact" required />
                <input class="full" name="email" type="email" placeholder="Email" autocomplete="email" required />
                <input class="full" name="password" type="password" placeholder="Password" minlength="8" autocomplete="new-password" required />
                <textarea class="full" name="signature_text" placeholder="Type your full name as your signature" required></textarea>
              </div>
              <label class="check-row">
                <input type="checkbox" required />
                <span>I accept the SpinX membership agreement and terms.</span>
              </label>
              <button>Create account</button>
            </form>
          </div>
        </div>
      </section>
    </main>
  `;
}

function render() {
  if (!state.session) {
    renderAuth();
    return;
  }

  if (!state.profile) {
    app.innerHTML = `<main class="loading">${state.error ? `<div class="error">${esc(state.error)}</div>` : "Loading profile..."}</main>`;
    return;
  }

  const tabs = roleTabs[state.profile.role] || roleTabs.member;
  const title = tabLabel(state.tab);
  const initials = `${state.profile.first_name?.[0] || "S"}${state.profile.last_name?.[0] || "X"}`.toUpperCase();

  app.innerHTML = `
    <main class="app-shell">
      <aside class="sidebar">
        <div class="sidebar-title">
          <span>SX</span>
          <div>
            <strong>SpinX</strong>
            <small>${esc(state.profile.role)}</small>
          </div>
        </div>
        <nav class="nav">
          ${tabs.map((tab) => `<button class="${state.tab === tab ? "active" : ""}" onclick="actions.setTab('${tab}')">${tabLabel(tab)}</button>`).join("")}
        </nav>
        <button class="logout-button" onclick="actions.logout()">Log out</button>
      </aside>
      <section class="content">
        <header class="topbar">
          <div>
            <h1>${esc(title)}</h1>
            <p>${esc(fullName(state.profile))} - ${statusPill(state.profile.status)} ${statusPill(state.profile.payment_status)}</p>
          </div>
          <div class="user-chip">${esc(initials)}</div>
        </header>
        ${state.message ? `<div class="success">${esc(state.message)}</div>` : ""}
        ${state.error ? `<div class="error">${esc(state.error)}</div>` : ""}
        ${renderTab()}
      </section>
    </main>
  `;
}

function tabLabel(tab) {
  return {
    dashboard: "Dashboard",
    calendar: "Calendar",
    bookings: "Bookings",
    members: "Members",
    classes: "Classes",
    attendance: "Attendance",
    reports: "Reports",
    profile: "Profile",
  }[tab] || tab;
}

function renderTab() {
  if (state.profile.status === "pending_approval" && state.profile.role === "member") {
    return `
      <section class="empty-state">
        <h2>Waiting for admin approval</h2>
        <p>Your registration is saved. Once an admin approves the account, bookings will unlock.</p>
      </section>
    `;
  }

  return {
    dashboard: renderDashboard,
    calendar: renderCalendar,
    bookings: renderBookings,
    members: renderMembers,
    classes: renderClassesAdmin,
    attendance: renderAttendance,
    reports: renderReports,
    profile: renderProfile,
  }[state.tab]?.() || renderDashboard();
}

function renderDashboard() {
  if (canTeach()) return renderStaffDashboard();
  return renderMemberDashboard();
}

function renderStaffDashboard() {
  const members = state.data.members;
  const activeMembers = members.filter((member) => member.status === "active");
  const pendingMembers = members.filter((member) => member.status === "pending_approval");
  const unpaidMembers = members.filter((member) => member.payment_status === "unpaid");
  const noShowMembers = members.filter((member) => Number(member.no_show_count || 0) > 0);
  const booked = state.data.bookings.filter((booking) => booking.status === "booked");
  const waits = state.data.waitlist.filter((entry) => entry.status === "waiting");
  const todayClasses = classesForDate(toDateKey(new Date()));
  const upcomingClasses = state.data.classes.filter((klass) => klass.status === "active" && new Date(klass.starts_at) >= new Date());

  return `
    <div class="dashboard-grid">
      ${metric("Total members", members.length, "members", "all")}
      ${metric("Active", activeMembers.length, "members", "active")}
      ${metric("Pending", pendingMembers.length, "members", "pending_approval")}
      ${metric("Unpaid", unpaidMembers.length, "members", "unpaid")}
      ${metric("Bookings", booked.length)}
      ${metric("Waiting list", waits.length)}
    </div>
    <div class="page-grid">
      <section class="panel span-7">
        <div class="panel-head">
          <h2>Today</h2>
          <button class="secondary small" onclick="actions.setTab('calendar')">Open calendar</button>
        </div>
        ${todayClasses.length ? todayClasses.map((klass) => renderClassSummary(klass)).join("") : `<p class="muted">No classes scheduled for today.</p>`}
      </section>
      <section class="panel span-5">
        <div class="panel-head">
          <h2>Needs attention</h2>
        </div>
        ${attentionRow("Pending approvals", pendingMembers.length, "pending_approval")}
        ${attentionRow("Unpaid members", unpaidMembers.length, "unpaid")}
        ${attentionRow("No-show warnings", noShowMembers.length, "no_shows")}
      </section>
      <section class="panel span-12">
        <div class="panel-head">
          <h2>Upcoming occupancy</h2>
          <button class="secondary small" onclick="actions.setTab('classes')">Manage classes</button>
        </div>
        <div class="compact-list">
          ${upcomingClasses.slice(0, 8).map((klass) => renderClassSummary(klass)).join("") || `<p class="muted">No upcoming classes yet.</p>`}
        </div>
      </section>
    </div>
  `;
}

function renderMemberDashboard() {
  const myBookings = state.data.bookings
    .filter((booking) => {
      const klass = state.data.classes.find((item) => item.id === booking.class_id);
      return booking.user_id === state.profile.id && booking.status === "booked" && klass && new Date(klass.starts_at) >= new Date();
    })
    .sort((a, b) => {
      const classA = state.data.classes.find((klass) => klass.id === a.class_id);
      const classB = state.data.classes.find((klass) => klass.id === b.class_id);
      return new Date(classA?.starts_at || 0) - new Date(classB?.starts_at || 0);
    });
  const nextBooking = myBookings[0];
  const nextClass = nextBooking ? state.data.classes.find((klass) => klass.id === nextBooking.class_id) : null;
  const upcomingClasses = state.data.classes.filter((klass) => klass.status === "active" && new Date(klass.starts_at) >= new Date());

  return `
    <div class="dashboard-grid">
      <section class="metric-panel">
        <span>Membership</span>
        <strong>${esc(state.profile.status.replaceAll("_", " "))}</strong>
      </section>
      <section class="metric-panel">
        <span>Payment</span>
        <strong>${esc(state.profile.payment_status)}</strong>
      </section>
      <section class="metric-panel">
        <span>No-shows</span>
        <strong>${esc(state.profile.no_show_count || 0)}</strong>
      </section>
    </div>
    <div class="page-grid">
      <section class="panel span-5">
        <h2>Next booking</h2>
        ${nextClass ? `
          <p><strong>${esc(nextClass.title)}</strong></p>
          <p class="muted">${niceDate(nextClass.starts_at)} - Bike ${esc(nextBooking.bike_number)}</p>
        ` : `<p class="muted">You have no upcoming bookings.</p>`}
        ${canBook() ? `<button onclick="actions.setTab('calendar')">Book a class</button>` : `<div class="notice">Bookings are disabled until your account is active and paid.</div>`}
      </section>
      <section class="panel span-7">
        <div class="panel-head">
          <h2>Upcoming classes</h2>
          <button class="secondary small" onclick="actions.setTab('calendar')">View all</button>
        </div>
        ${upcomingClasses.slice(0, 5).map((klass) => renderClassSummary(klass)).join("") || `<p class="muted">No classes scheduled.</p>`}
      </section>
    </div>
  `;
}

function metric(label, value, tab = "", filter = "") {
  const click = tab ? `onclick="actions.openMetric('${tab}', '${filter}')"` : "";
  return `
    <section class="metric-panel ${tab ? "clickable" : ""}" ${click}>
      <span>${esc(label)}</span>
      <strong>${esc(value)}</strong>
    </section>
  `;
}

function attentionRow(label, count, filter) {
  return `
    <button class="attention-row" onclick="actions.showMembers('${filter}')">
      <span>${esc(label)}</span>
      <strong>${esc(count)}</strong>
    </button>
  `;
}

function renderClassSummary(klass) {
  const bookings = classBookings(klass.id);
  const waitlist = classWaitlist(klass.id);
  const percent = Math.min(100, Math.round((bookings.length / 9) * 100));
  return `
    <article class="summary-row">
      <div>
        <strong>${esc(klass.title)}</strong>
        <span>${niceDate(klass.starts_at)}</span>
      </div>
      <div class="occupancy">
        <span>${bookings.length}/9</span>
        <div><i style="width:${percent}%"></i></div>
        ${waitlist.length ? `<small>${waitlist.length} waiting</small>` : ""}
      </div>
    </article>
  `;
}

function renderCalendar() {
  const selectedClasses = classesForDate(state.selectedDate);
  return `
    <div class="calendar-layout">
      <section class="panel calendar-panel">
        <div class="calendar-head">
          <button class="icon-button" onclick="actions.moveMonth(-1)" aria-label="Previous month">&lt;</button>
          <h2>${esc(monthTitle(state.calendarMonth))}</h2>
          <button class="icon-button" onclick="actions.moveMonth(1)" aria-label="Next month">&gt;</button>
        </div>
        ${renderMonthGrid()}
      </section>
      <section class="panel day-panel">
        <div class="panel-head">
          <div>
            <h2>${esc(longDate(state.selectedDate))}</h2>
            <p class="muted">${selectedClasses.length} class${selectedClasses.length === 1 ? "" : "es"}</p>
          </div>
          ${canTeach() ? `<button class="secondary small" onclick="actions.setTab('classes')">Add classes</button>` : ""}
        </div>
        <div class="stack">
          ${selectedClasses.map((klass) => renderClassCard(klass, true)).join("") || `<p class="muted">No classes on this date.</p>`}
        </div>
      </section>
    </div>
  `;
}

function renderMonthGrid() {
  const first = firstOfMonth(state.calendarMonth);
  const gridStart = addDays(first, -first.getDay());
  const cells = Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  const todayKey = toDateKey(new Date());

  return `
    <div class="calendar-weekdays">
      ${dayNames.map((day) => `<span>${day}</span>`).join("")}
    </div>
    <div class="month-grid">
      ${cells.map((date) => {
        const key = toDateKey(date);
        const count = classesForDate(key).length;
        const isOutside = date.getMonth() !== state.calendarMonth.getMonth();
        const isSelected = key === state.selectedDate;
        const isToday = key === todayKey;
        return `
          <button class="day-cell ${isOutside ? "outside" : ""} ${isSelected ? "selected" : ""} ${isToday ? "today" : ""}" onclick="actions.selectDate('${key}')">
            <span>${date.getDate()}</span>
            ${count ? `<em>${count}</em>` : ""}
          </button>
        `;
      }).join("")}
    </div>
  `;
}

function renderClassCard(klass, withActions) {
  const bookings = classBookings(klass.id);
  const waitCount = classWaitlist(klass.id).length;
  const mine = bookings.find((booking) => booking.user_id === state.profile.id);
  const bookedBikes = new Set(bookings.map((booking) => booking.bike_number));
  const bikes = Array.from({ length: 9 }, (_, index) => index + 1);
  const isCancelled = klass.status === "cancelled";
  const full = bookings.length >= 9;

  return `
    <article class="class-block ${isCancelled ? "cancelled" : ""}">
      <div class="class-head">
        <div>
          <h3>${esc(klass.title)}</h3>
          <p>${niceDate(klass.starts_at)} - ${esc(klass.duration_minutes)} min - ${bookings.length}/9 booked${waitCount ? ` - ${waitCount} waiting` : ""}</p>
        </div>
        ${statusPill(klass.status)}
      </div>
      ${klass.notes ? `<p class="muted">${esc(klass.notes)}</p>` : ""}
      ${withActions ? `
        <div class="bike-grid">
          ${bikes.map((bike) => {
            const taken = bookedBikes.has(bike);
            const mineBike = mine?.bike_number === bike;
            const label = mineBike ? `Bike ${bike} - mine` : taken ? `Bike ${bike} - taken` : `Bike ${bike}`;
            return `<button class="bike ${mineBike ? "mine" : taken ? "taken" : ""}" ${taken || !canBook() || isCancelled ? "disabled" : ""} onclick="actions.bookBike('${klass.id}', ${bike})">${label}</button>`;
          }).join("")}
        </div>
        <div class="action-row">
          ${mine ? `<button class="secondary" onclick="actions.cancelBooking('${mine.id}')">Cancel my booking</button>` : ""}
          ${!mine && full && canBook() && !isCancelled ? `<button class="secondary" onclick="actions.joinWaitlist('${klass.id}')">Join waiting list</button>` : ""}
          ${!canBook() && state.profile.role === "member" ? `<span class="muted">Booking is locked until your account is active and paid.</span>` : ""}
        </div>
        ${canTeach() ? renderClassRoster(klass) : ""}
      ` : ""}
    </article>
  `;
}

function renderClassRoster(klass) {
  const bookings = classBookings(klass.id);
  if (!bookings.length) return "";
  return `
    <div class="roster-list">
      ${bookings
        .sort((a, b) => a.bike_number - b.bike_number)
        .map((booking) => {
          const member = memberById(booking.user_id);
          return `
            <div>
              <span>Bike ${esc(booking.bike_number)} - ${esc(fullName(member))}</span>
              <button class="ghost small" onclick="actions.cancelBooking('${booking.id}')">Cancel</button>
            </div>
          `;
        }).join("")}
    </div>
  `;
}

function renderBookings() {
  const visibleBookings = state.data.bookings
    .filter((booking) => canTeach() || booking.user_id === state.profile.id)
    .slice()
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  return `
    <section class="panel">
      <div class="panel-head">
        <h2>Bookings</h2>
        <span class="muted">${visibleBookings.length} records</span>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Class</th><th>Date</th><th>Bike</th><th>Member</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${visibleBookings.map((booking) => {
              const klass = state.data.classes.find((item) => item.id === booking.class_id);
              const member = memberById(booking.user_id);
              return `
                <tr>
                  <td><strong>${esc(klass?.title || "Class")}</strong></td>
                  <td>${esc(klass ? niceDate(klass.starts_at) : "")}</td>
                  <td>Bike ${esc(booking.bike_number)}</td>
                  <td>${esc(member ? fullName(member) : booking.user_id === state.profile.id ? "Me" : "Unknown")}</td>
                  <td>${statusPill(booking.status)}</td>
                  <td>${booking.status === "booked" && (booking.user_id === state.profile.id || canTeach()) ? `<button class="ghost small" onclick="actions.cancelBooking('${booking.id}')">Cancel</button>` : ""}</td>
                </tr>
              `;
            }).join("") || `<tr><td colspan="6">No bookings yet.</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function memberFilterOptions() {
  return [
    ["all", "All"],
    ["pending_approval", "Pending"],
    ["active", "Active"],
    ["unpaid", "Unpaid"],
    ["instructor", "Instructors"],
    ["no_shows", "No-shows"],
  ];
}

function filteredMembers() {
  return state.data.members.filter((member) => {
    if (state.memberFilter === "all") return true;
    if (state.memberFilter === "unpaid") return member.payment_status === "unpaid";
    if (state.memberFilter === "instructor") return member.role === "instructor";
    if (state.memberFilter === "no_shows") return Number(member.no_show_count || 0) > 0;
    return member.status === state.memberFilter;
  });
}

function renderMembers() {
  if (!canTeach()) return `<div class="error">You do not have access to members.</div>`;
  const members = filteredMembers();

  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>Members</h2>
          <p class="muted">${members.length} shown from ${state.data.members.length} total</p>
        </div>
      </div>
      <div class="filter-row">
        ${memberFilterOptions().map(([value, label]) => `
          <button class="${state.memberFilter === value ? "active" : ""}" onclick="actions.showMembers('${value}')">${label}</button>
        `).join("")}
      </div>
      <div class="member-list">
        ${members.map(renderMemberRow).join("") || `<p class="muted">No members match this filter.</p>`}
      </div>
    </section>
  `;
}

function renderMemberRow(member) {
  return `
    <article class="member-row">
      <div class="member-main">
        <div class="avatar">${esc((member.first_name?.[0] || "S") + (member.last_name?.[0] || "X"))}</div>
        <div>
          <strong>${esc(fullName(member))}</strong>
          <span>${esc(member.email)}</span>
        </div>
      </div>
      <div class="member-meta">
        ${statusPill(member.role)}
        ${statusPill(member.status)}
        ${statusPill(member.payment_status)}
        <span class="pill neutral">${esc(member.no_show_count || 0)} no-shows</span>
      </div>
      <div class="member-actions">
        ${memberActionButtons(member)}
      </div>
    </article>
  `;
}

function memberActionButtons(member) {
  if (!canManage()) return "";
  const isSelf = member.id === state.profile.id;
  const actions = [];

  if (member.status === "pending_approval") {
    actions.push(`<button onclick="actions.approveMember('${member.id}')">Approve</button>`);
  } else if (member.status !== "active") {
    actions.push(`<button class="secondary" onclick="actions.approveMember('${member.id}')">Activate</button>`);
  }

  if (member.status === "active" && !isSelf) {
    actions.push(`<button class="secondary" onclick="actions.updateMember('${member.id}', { status: 'inactive' })">Deactivate</button>`);
    actions.push(`<button class="secondary" onclick="actions.updateMember('${member.id}', { status: 'suspended' })">Suspend</button>`);
  }

  if (member.payment_status === "paid") {
    actions.push(`<button class="secondary" onclick="actions.updateMember('${member.id}', { payment_status: 'unpaid' })">Mark unpaid</button>`);
  } else {
    actions.push(`<button class="secondary" onclick="actions.updateMember('${member.id}', { payment_status: 'paid' })">Mark paid</button>`);
  }

  if (member.role === "member") {
    actions.push(`<button class="secondary" onclick="actions.updateMember('${member.id}', { role: 'instructor', status: 'active' })">Make instructor</button>`);
  } else if (member.role === "instructor") {
    actions.push(`<button class="secondary" onclick="actions.updateMember('${member.id}', { role: 'member' })">Make member</button>`);
  }

  if (Number(member.no_show_count || 0) > 0) {
    actions.push(`<button class="secondary" onclick="actions.updateMember('${member.id}', { no_show_count: 0 })">Reset no-shows</button>`);
  }

  if (!isSelf) {
    actions.push(`<button class="danger" onclick="actions.declineMember('${member.id}')">${member.status === "pending_approval" ? "Decline/delete" : "Delete"}</button>`);
  }

  return actions.join("");
}

function renderClassesAdmin() {
  if (!canTeach()) return `<div class="error">You do not have access to class management.</div>`;
  const selectedClasses = classesForDate(state.selectedDate);
  const upcoming = state.data.classes.filter((klass) => new Date(klass.starts_at) >= addDays(new Date(), -1)).slice(0, 24);

  return `
    <div class="page-grid">
      <section class="panel span-5">
        <div class="panel-head">
          <div>
            <h2>Class planner</h2>
            <p class="muted">${esc(longDate(state.selectedDate))}</p>
          </div>
        </div>
        ${renderClassPlanner()}
      </section>
      <section class="panel span-7">
        <div class="panel-head">
          <div>
            <h2>Selected day</h2>
            <p class="muted">${selectedClasses.length} class${selectedClasses.length === 1 ? "" : "es"}</p>
          </div>
          <button class="secondary small" onclick="actions.setTab('calendar')">Open calendar</button>
        </div>
        <div class="stack">
          ${selectedClasses.map(renderManageClassRow).join("") || `<p class="muted">No classes on the selected day.</p>`}
        </div>
      </section>
      <section class="panel span-12">
        <div class="panel-head">
          <h2>Upcoming schedule</h2>
          <span class="muted">${upcoming.length} upcoming</span>
        </div>
        <div class="manage-list">
          ${upcoming.map(renderManageClassRow).join("") || `<p class="muted">No upcoming classes yet.</p>`}
        </div>
      </section>
    </div>
  `;
}

function renderClassPlanner() {
  const selected = fromDateKey(state.selectedDate);
  const until = addDays(selected, 28);
  return `
    <form class="stack" onsubmit="actions.createSchedule(event)">
      <input name="title" placeholder="Class name" value="Morning Spin" required />
      <div class="form-grid">
        <input name="start_date" type="date" value="${esc(state.selectedDate)}" required />
        <input name="start_time" type="time" value="05:30" required />
        <input name="duration_minutes" type="number" min="15" step="5" value="45" required />
        <select name="repeat_mode">
          <option value="none">One class only</option>
          <option value="weekly">Repeat weekly</option>
        </select>
      </div>
      <div class="weekday-picker">
        ${weekdayValues.map((day) => `
          <label>
            <input type="checkbox" name="weekdays" value="${day.value}" ${day.value === selected.getDay() ? "checked" : ""} />
            <span>${day.label}</span>
          </label>
        `).join("")}
      </div>
      <div class="form-grid">
        <input name="until_date" type="date" value="${esc(toDateKey(until))}" />
        <input name="skip_dates" placeholder="Skip dates, e.g. 2026-07-01" />
      </div>
      <textarea name="notes" placeholder="Notes"></textarea>
      <button>Create schedule</button>
    </form>
  `;
}

function renderManageClassRow(klass) {
  if (state.editingClassId === klass.id) return renderEditClassRow(klass);
  const bookings = classBookings(klass.id);
  return `
    <article class="manage-row">
      <div>
        <strong>${esc(klass.title)}</strong>
        <span>${niceDate(klass.starts_at)} - ${esc(klass.duration_minutes)} min - ${bookings.length}/9 booked</span>
      </div>
      <div class="manage-actions">
        ${statusPill(klass.status)}
        <button class="secondary small" onclick="actions.editClass('${klass.id}')">Edit</button>
        <button class="secondary small" onclick="actions.duplicateClass('${klass.id}')">Duplicate</button>
        <button class="secondary small" onclick="actions.updateClass('${klass.id}', { status: '${klass.status === "cancelled" ? "active" : "cancelled"}' })">${klass.status === "cancelled" ? "Reopen" : "Cancel"}</button>
      </div>
    </article>
  `;
}

function renderEditClassRow(klass) {
  return `
    <article class="manage-row editing">
      <form class="edit-class-form" onsubmit="actions.saveClass(event, '${klass.id}')">
        <input name="title" value="${esc(klass.title)}" required />
        <input name="date" type="date" value="${esc(toDateKey(klass.starts_at))}" required />
        <input name="time" type="time" value="${esc(toTimeInput(klass.starts_at))}" required />
        <input name="duration_minutes" type="number" min="15" step="5" value="${esc(klass.duration_minutes)}" required />
        <input name="notes" value="${esc(klass.notes || "")}" placeholder="Notes" />
        <div class="action-row">
          <button class="small">Save</button>
          <button type="button" class="ghost small" onclick="actions.editClass('')">Close</button>
        </div>
      </form>
    </article>
  `;
}

function renderAttendance() {
  if (!canTeach()) return `<div class="error">You do not have access to attendance.</div>`;
  const classes = state.data.classes.filter((klass) => new Date(klass.starts_at) >= addDays(new Date(), -14)).slice(0, 24);

  return `
    <section class="panel">
      <div class="panel-head">
        <h2>Attendance</h2>
        <span class="muted">Recent and upcoming classes</span>
      </div>
      <div class="stack">
        ${classes.map((klass) => {
          const bookings = classBookings(klass.id).sort((a, b) => a.bike_number - b.bike_number);
          return `
            <article class="attendance-block">
              <div class="class-head">
                <div>
                  <h3>${esc(klass.title)}</h3>
                  <p>${niceDate(klass.starts_at)} - ${bookings.length}/9 booked</p>
                </div>
                ${statusPill(klass.status)}
              </div>
              <div class="table-wrap">
                <table class="table">
                  <thead><tr><th>Member</th><th>Bike</th><th>Status</th><th>Mark</th></tr></thead>
                  <tbody>
                    ${bookings.map((booking) => {
                      const member = memberById(booking.user_id);
                      const marked = attendanceFor(klass.id, booking.user_id);
                      return `
                        <tr>
                          <td>${esc(member ? fullName(member) : booking.user_id)}</td>
                          <td>Bike ${esc(booking.bike_number)}</td>
                          <td>${marked ? statusPill(marked.status) : `<span class="muted">Not marked</span>`}</td>
                          <td>
                            <button class="secondary small" onclick="actions.markAttendance('${klass.id}', '${booking.user_id}', 'present')">Present</button>
                            <button class="secondary small" onclick="actions.markAttendance('${klass.id}', '${booking.user_id}', 'absent')">Absent</button>
                          </td>
                        </tr>
                      `;
                    }).join("") || `<tr><td colspan="4">No bookings.</td></tr>`}
                  </tbody>
                </table>
              </div>
            </article>
          `;
        }).join("") || `<p class="muted">No classes available for attendance.</p>`}
      </div>
    </section>
  `;
}

function renderReports() {
  if (!canManage()) return `<div class="error">Only admins can export reports.</div>`;
  return `
    <section class="panel">
      <div class="panel-head">
        <h2>Reports</h2>
        <span class="muted">CSV exports</span>
      </div>
      <div class="report-grid">
        ${reportButton("Members", "members", state.data.members.length)}
        ${reportButton("Classes", "classes", state.data.classes.length)}
        ${reportButton("Bookings", "bookings", state.data.bookings.length)}
        ${reportButton("Attendance", "attendance", state.data.attendance.length)}
        ${reportButton("Waiting list", "waitlist", state.data.waitlist.length)}
      </div>
    </section>
  `;
}

function reportButton(label, kind, count) {
  return `
    <button class="report-button" onclick="actions.exportCsv('${kind}')">
      <strong>${esc(label)}</strong>
      <span>${esc(count)} records</span>
    </button>
  `;
}

function renderProfile() {
  return `
    <section class="panel profile-panel">
      <div class="panel-head">
        <h2>Profile</h2>
        <div>${statusPill(state.profile.role)} ${statusPill(state.profile.status)}</div>
      </div>
      <form class="stack" onsubmit="actions.saveProfile(event)">
        <div class="form-grid">
          <input name="first_name" value="${esc(state.profile.first_name)}" placeholder="First name" required />
          <input name="last_name" value="${esc(state.profile.last_name)}" placeholder="Last name" required />
          <input name="mobile" value="${esc(state.profile.mobile || "")}" placeholder="Mobile" />
          <input name="emergency_contact" value="${esc(state.profile.emergency_contact || "")}" placeholder="Emergency contact" />
        </div>
        <button>Save profile</button>
      </form>
    </section>
  `;
}

async function run(action, success) {
  state.error = "";
  state.message = "";
  const result = await action();
  if (result?.error) {
    state.error = result.error.message;
  } else if (success) {
    state.message = success;
  }
  await loadProfile();
  await loadData();
  render();
}

function authErrorMessage(error) {
  if (!error) return "";
  if (error.message?.toLowerCase().includes("email not confirmed")) {
    return "This account is not approved/confirmed yet. Ask an admin to approve it in Members.";
  }
  return error.message;
}

window.actions = {
  setTab(tab) {
    state.tab = tab;
    render();
  },
  openMetric(tab, filter) {
    state.tab = tab;
    if (tab === "members") state.memberFilter = filter || "all";
    render();
  },
  showMembers(filter) {
    state.tab = "members";
    state.memberFilter = filter;
    render();
  },
  selectDate(dateKey) {
    state.selectedDate = dateKey;
    const selected = fromDateKey(dateKey);
    state.calendarMonth = firstOfMonth(selected);
    render();
  },
  moveMonth(delta) {
    state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() + delta, 1);
    render();
  },
  async login(event) {
    event.preventDefault();
    const form = new FormData(event.target);
    const { error } = await db.auth.signInWithPassword({
      email: form.get("email"),
      password: form.get("password"),
    });
    if (error) {
      document.querySelector("#authMessage").innerHTML = `<div class="error">${esc(authErrorMessage(error))}</div>`;
    }
  },
  async register(event) {
    event.preventDefault();
    const form = new FormData(event.target);
    const { error } = await db.auth.signUp({
      email: form.get("email"),
      password: form.get("password"),
      options: {
        emailRedirectTo: window.location.origin,
        data: {
          first_name: form.get("first_name"),
          last_name: form.get("last_name"),
          mobile: form.get("mobile"),
          emergency_contact: form.get("emergency_contact"),
          signature_text: form.get("signature_text"),
        },
      },
    });
    document.querySelector("#authMessage").innerHTML = error
      ? `<div class="error">${esc(error.message)}</div>`
      : `<div class="success">Account created. An admin must approve it before booking is enabled.</div>`;
    if (!error) event.target.reset();
  },
  async logout() {
    await db.auth.signOut();
  },
  bookBike(classId, bike) {
    run(() => db.rpc("spinx_book_bike", { p_class_id: classId, p_bike_number: bike }), "Bike booked.");
  },
  cancelBooking(bookingId) {
    run(() => db.rpc("spinx_cancel_booking", { p_booking_id: bookingId }), "Booking cancelled.");
  },
  joinWaitlist(classId) {
    run(() => db.rpc("spinx_join_waitlist", { p_class_id: classId }), "Added to waiting list.");
  },
  createSchedule(event) {
    event.preventDefault();
    const form = new FormData(event.target);
    const repeatMode = form.get("repeat_mode");
    const startDate = String(form.get("start_date"));
    const untilDate = String(form.get("until_date") || startDate);
    const time = String(form.get("start_time") || "05:30");
    const selectedWeekdays = form.getAll("weekdays").map(Number);
    const skipDates = String(form.get("skip_dates") || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const skipSet = new Set(skipDates);
    const rows = [];
    let cursor = fromDateKey(startDate);
    const end = fromDateKey(repeatMode === "weekly" ? untilDate : startDate);
    const weekdays = selectedWeekdays.length ? selectedWeekdays : [cursor.getDay()];

    while (cursor <= end) {
      const key = toDateKey(cursor);
      const shouldCreate = repeatMode === "none" ? key === startDate : weekdays.includes(cursor.getDay());
      if (shouldCreate && !skipSet.has(key)) {
        rows.push({
          title: form.get("title"),
          starts_at: dateTimeFromParts(key, time).toISOString(),
          duration_minutes: Number(form.get("duration_minutes")),
          notes: form.get("notes"),
          instructor_id: state.profile.id,
        });
      }
      cursor = addDays(cursor, 1);
    }

    if (!rows.length) return setMessage("", "No classes matched that schedule.");

    run(() => db.from("spinx_classes").insert(rows), rows.length === 1 ? "Class created." : `${rows.length} classes created.`);
  },
  editClass(id) {
    state.editingClassId = id;
    render();
  },
  saveClass(event, id) {
    event.preventDefault();
    const form = new FormData(event.target);
    const startsAt = dateTimeFromParts(form.get("date"), form.get("time")).toISOString();
    run(() => db.from("spinx_classes").update({
      title: form.get("title"),
      starts_at: startsAt,
      duration_minutes: Number(form.get("duration_minutes")),
      notes: form.get("notes"),
    }).eq("id", id), "Class saved.");
    state.editingClassId = "";
  },
  duplicateClass(id) {
    const klass = state.data.classes.find((item) => item.id === id);
    if (!klass) return;
    const startsAt = addDays(new Date(klass.starts_at), 7);
    run(() => db.from("spinx_classes").insert({
      title: klass.title,
      starts_at: startsAt.toISOString(),
      duration_minutes: klass.duration_minutes,
      notes: klass.notes,
      instructor_id: klass.instructor_id || state.profile.id,
    }), "Class duplicated for next week.");
  },
  updateClass(id, patch) {
    run(() => db.from("spinx_classes").update(patch).eq("id", id), "Class updated.");
  },
  approveMember(id) {
    run(() => db.rpc("spinx_approve_member", { p_user_id: id }), "Member approved.");
  },
  updateMember(id, patch) {
    run(() => db.from("spinx_profiles").update(patch).eq("id", id), "Member updated.");
  },
  declineMember(id) {
    if (!confirm("Delete this member and their login account?")) return;
    run(() => db.rpc("spinx_decline_member", { p_user_id: id }), "Member deleted.");
  },
  markAttendance(classId, userId, status) {
    run(() => db.rpc("spinx_mark_attendance", { p_class_id: classId, p_user_id: userId, p_status: status }), "Attendance saved.");
  },
  saveProfile(event) {
    event.preventDefault();
    const form = new FormData(event.target);
    run(() => db.rpc("spinx_update_my_profile", {
      p_first_name: form.get("first_name"),
      p_last_name: form.get("last_name"),
      p_mobile: form.get("mobile"),
      p_emergency_contact: form.get("emergency_contact"),
    }), "Profile saved.");
  },
  exportCsv(kind) {
    const data = {
      members: state.data.members,
      classes: state.data.classes,
      bookings: state.data.bookings,
      attendance: state.data.attendance,
      waitlist: state.data.waitlist,
    }[kind] || [];

    if (!data.length) return setMessage("", "Nothing to export.");

    const keys = Object.keys(data[0]);
    const csv = [
      keys.join(","),
      ...data.map((row) => keys.map((key) => `"${String(row[key] ?? "").replaceAll('"', '""')}"`).join(",")),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `spinx-${kind}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  },
};

init();
