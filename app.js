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
  admin: ["dashboard", "calendar", "bookings", "members", "classes", "attendance", "reports", "profile"],
  instructor: ["dashboard", "calendar", "bookings", "classes", "attendance", "profile"],
  member: ["dashboard", "calendar", "bookings", "profile"],
};

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function moneyStatus(profile) {
  return profile?.payment_status === "paid" ? "Paid" : "Unpaid";
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
  const kind = value === "active" || value === "paid" || value === "present" ? "ok" : value === "pending_approval" || value === "waiting" ? "warn" : "bad";
  return `<span class="pill ${kind}">${esc(String(value).replaceAll("_", " "))}</span>`;
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

function isoLocalInput(date = new Date()) {
  const copy = new Date(date);
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
  return copy.toISOString().slice(0, 16);
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
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [classes, bookings, waitlist, attendance] = await Promise.all([
    db.from("spinx_classes").select("*").gte("starts_at", today.toISOString()).order("starts_at"),
    db.from("spinx_bookings").select("*").order("created_at"),
    db.from("spinx_waitlist").select("*").order("created_at"),
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
          <p class="muted">Simple class bookings for a small spinning studio.</p>
          <div class="notice">
            New members register here and wait for admin approval before they can book bikes.
          </div>
        </div>
        <div class="auth-form">
          <div id="authMessage"></div>
          <h2>Log in</h2>
          <form onsubmit="actions.login(event)" class="stack">
            <input name="email" type="email" placeholder="Email" required />
            <input name="password" type="password" placeholder="Password" required />
            <button>Log in</button>
          </form>
          <hr />
          <h2>Register</h2>
          <form onsubmit="actions.register(event)" class="stack">
            <div class="form-grid">
              <input name="first_name" placeholder="First name" required />
              <input name="last_name" placeholder="Last name" required />
              <input name="mobile" placeholder="Mobile number" required />
              <input name="emergency_contact" placeholder="Emergency contact" required />
              <input class="full" name="email" type="email" placeholder="Email" required />
              <input class="full" name="password" type="password" placeholder="Password" minlength="8" required />
              <textarea class="full" name="signature_text" placeholder="Type your full name as your signature" required></textarea>
            </div>
            <label class="row">
              <input style="width:auto; min-height:auto" type="checkbox" required />
              I accept the SpinX membership agreement and terms.
            </label>
            <button>Create account</button>
          </form>
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
  const title = state.tab[0].toUpperCase() + state.tab.slice(1);
  app.innerHTML = `
    <main class="app-shell">
      <aside class="sidebar">
        <div class="sidebar-title">
          <span>SX</span>
          <div>
            <strong>SpinX</strong>
            <div class="muted">${esc(state.profile.role)}</div>
          </div>
        </div>
        <nav class="nav">
          ${tabs.map((tab) => `<button class="${state.tab === tab ? "active" : ""}" onclick="actions.setTab('${tab}')">${tabLabel(tab)}</button>`).join("")}
          <button onclick="actions.logout()">Log out</button>
        </nav>
      </aside>
      <section class="content">
        <div class="topbar">
          <div>
            <h1>${esc(title)}</h1>
            <p>${esc(state.profile.first_name)} ${esc(state.profile.last_name)} · ${statusPill(state.profile.status)} ${statusPill(state.profile.payment_status)}</p>
          </div>
        </div>
        ${state.message ? `<div class="success">${esc(state.message)}</div><br />` : ""}
        ${state.error ? `<div class="error">${esc(state.error)}</div><br />` : ""}
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
      <div class="card span-12">
        <h2>Waiting for approval</h2>
        <p>Your account was created, but an admin still needs to approve it before you can book bikes.</p>
      </div>
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
  const members = state.data.members;
  const booked = state.data.bookings.filter((b) => b.status === "booked");
  const waits = state.data.waitlist.filter((w) => w.status === "waiting");
  const activeMembers = members.filter((m) => m.status === "active");
  const pendingMembers = members.filter((m) => m.status === "pending_approval");

  if (canTeach()) {
    return `
      <div class="grid">
        ${metric("Members", members.length)}
        ${metric("Active", activeMembers.length)}
        ${metric("Pending", pendingMembers.length)}
        ${metric("Bookings", booked.length)}
        ${metric("Waiting", waits.length)}
        ${metric("No-shows", members.reduce((sum, m) => sum + (m.no_show_count || 0), 0))}
        <section class="card span-12">
          <h2>Upcoming occupancy</h2>
          ${renderClassList(false)}
        </section>
      </div>
    `;
  }

  return `
    <div class="grid">
      <section class="card span-6">
        <h2>Membership</h2>
        <p>Status: ${statusPill(state.profile.status)}</p>
        <p>Payment: ${statusPill(state.profile.payment_status)}</p>
        ${canBook() ? `<p class="success">You can book classes.</p>` : `<p class="notice">Bookings are disabled until your account is active and paid.</p>`}
      </section>
      <section class="card span-6">
        <h2>Attendance</h2>
        <p>No-show count: <strong>${state.profile.no_show_count || 0}</strong></p>
        <p class="muted">Your attendance history is listed under Bookings.</p>
      </section>
      <section class="card span-12">
        <h2>Next classes</h2>
        ${renderClassList(true)}
      </section>
    </div>
  `;
}

function metric(label, value) {
  return `<section class="card span-3 metric"><span class="muted">${esc(label)}</span><strong>${esc(value)}</strong></section>`;
}

function renderCalendar() {
  return `<section class="card"><h2>Calendar</h2>${renderClassList(true)}</section>`;
}

function renderClassList(withActions) {
  const classes = state.data.classes;
  if (!classes.length) return `<p class="muted">No upcoming classes yet.</p>`;
  return `<div class="stack">${classes.map((klass) => renderClassCard(klass, withActions)).join("")}</div>`;
}

function renderClassCard(klass, withActions) {
  const bookings = state.data.bookings.filter((b) => b.class_id === klass.id && b.status === "booked");
  const waitCount = state.data.waitlist.filter((w) => w.class_id === klass.id && w.status === "waiting").length;
  const mine = bookings.find((b) => b.user_id === state.profile.id);
  const bookedBikes = new Set(bookings.map((b) => b.bike_number));
  const bikes = Array.from({ length: 9 }, (_, index) => index + 1);
  const isCancelled = klass.status === "cancelled";
  const full = bookings.length >= 9;

  return `
    <article class="card">
      <div class="row space">
        <div>
          <h3>${esc(klass.title)}</h3>
          <p class="muted">${niceDate(klass.starts_at)} · ${bookings.length}/9 booked · ${waitCount} waiting</p>
        </div>
        ${statusPill(klass.status)}
      </div>
      ${withActions ? `
        <div class="bike-grid">
          ${bikes.map((bike) => {
            const taken = bookedBikes.has(bike);
            const mineBike = mine?.bike_number === bike;
            return `<button class="bike ${mineBike ? "mine" : taken ? "taken" : ""}" ${taken || !canBook() || isCancelled ? "disabled" : ""} onclick="actions.bookBike('${klass.id}', ${bike})">Bike ${bike}${mineBike ? " · mine" : taken ? " · taken" : ""}</button>`;
          }).join("")}
        </div>
        <div class="row" style="margin-top:10px">
          ${mine ? `<button class="secondary" onclick="actions.cancelBooking('${mine.id}')">Cancel my booking</button>` : ""}
          ${!mine && full && canBook() && !isCancelled ? `<button class="secondary" onclick="actions.joinWaitlist('${klass.id}')">Join waiting list</button>` : ""}
        </div>
      ` : ""}
    </article>
  `;
}

function renderBookings() {
  const rows = state.data.bookings
    .filter((b) => canTeach() || b.user_id === state.profile.id)
    .map((b) => {
      const klass = state.data.classes.find((c) => c.id === b.class_id);
      const member = state.data.members.find((m) => m.id === b.user_id);
      return `<tr><td>${esc(klass?.title || "Class")}</td><td>${esc(klass ? niceDate(klass.starts_at) : "")}</td><td>Bike ${b.bike_number}</td><td>${esc(member ? `${member.first_name} ${member.last_name}` : "Me")}</td><td>${statusPill(b.status)}</td></tr>`;
    })
    .join("");
  return `<section class="card"><h2>Bookings</h2><table class="table"><thead><tr><th>Class</th><th>Date</th><th>Bike</th><th>Member</th><th>Status</th></tr></thead><tbody>${rows || `<tr><td colspan="5">No bookings yet.</td></tr>`}</tbody></table></section>`;
}

function renderMembers() {
  if (!canTeach()) return `<div class="error">You do not have access to members.</div>`;
  const rows = state.data.members.map((m) => `
    <tr>
      <td><strong>${esc(m.first_name)} ${esc(m.last_name)}</strong><br><span class="muted">${esc(m.email)}</span></td>
      <td>${statusPill(m.role)}</td>
      <td>${statusPill(m.status)}</td>
      <td>${statusPill(m.payment_status)}</td>
      <td>${esc(m.no_show_count || 0)}</td>
      <td>
        <div class="row">
          ${canManage() ? `
            <button class="secondary" onclick="actions.updateMember('${m.id}', { status: 'active' })">Approve</button>
            <button class="secondary" onclick="actions.updateMember('${m.id}', { payment_status: 'paid' })">Paid</button>
            <button class="secondary" onclick="actions.updateMember('${m.id}', { payment_status: 'unpaid' })">Unpaid</button>
            <button class="secondary" onclick="actions.updateMember('${m.id}', { role: 'instructor', status: 'active' })">Make instructor</button>
            <button class="secondary" onclick="actions.updateMember('${m.id}', { no_show_count: 0 })">Reset no-shows</button>
            <button class="danger" onclick="actions.declineMember('${m.id}')">Decline/delete</button>
          ` : ""}
        </div>
      </td>
    </tr>
  `).join("");
  return `<section class="card"><h2>Members</h2><table class="table"><thead><tr><th>Member</th><th>Role</th><th>Status</th><th>Payment</th><th>No-shows</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

function renderClassesAdmin() {
  if (!canTeach()) return `<div class="error">You do not have access to class management.</div>`;
  return `
    <div class="grid">
      <section class="card span-4">
        <h2>Add class</h2>
        <form class="stack" onsubmit="actions.createClass(event)">
          <input name="title" placeholder="Class name" value="Spin class" required />
          <input name="starts_at" type="datetime-local" value="${isoLocalInput()}" required />
          <input name="duration_minutes" type="number" min="15" step="5" value="45" required />
          <textarea name="notes" placeholder="Notes"></textarea>
          <button>Create class</button>
        </form>
      </section>
      <section class="card span-8">
        <h2>Upcoming classes</h2>
        <div class="stack">
          ${state.data.classes.map((c) => `
            <article class="card">
              <div class="row space">
                <div><strong>${esc(c.title)}</strong><br><span class="muted">${niceDate(c.starts_at)}</span></div>
                <div class="row">
                  ${statusPill(c.status)}
                  <button class="secondary" onclick="actions.updateClass('${c.id}', { status: '${c.status === "cancelled" ? "active" : "cancelled"}' })">${c.status === "cancelled" ? "Reopen" : "Cancel"}</button>
                </div>
              </div>
            </article>
          `).join("") || `<p class="muted">No classes yet.</p>`}
        </div>
      </section>
    </div>
  `;
}

function renderAttendance() {
  if (!canTeach()) return `<div class="error">You do not have access to attendance.</div>`;
  const classes = state.data.classes;
  return `
    <section class="card">
      <h2>Attendance</h2>
      <div class="stack">
        ${classes.map((klass) => {
          const bookings = state.data.bookings.filter((b) => b.class_id === klass.id && b.status === "booked");
          return `
            <article class="card">
              <h3>${esc(klass.title)}</h3>
              <p class="muted">${niceDate(klass.starts_at)} · ${bookings.length}/9 bikes</p>
              <table class="table">
                <thead><tr><th>Member</th><th>Bike</th><th>Mark</th></tr></thead>
                <tbody>
                  ${bookings.map((b) => {
                    const member = state.data.members.find((m) => m.id === b.user_id);
                    return `<tr><td>${esc(member ? `${member.first_name} ${member.last_name}` : b.user_id)}</td><td>Bike ${b.bike_number}</td><td><button class="secondary" onclick="actions.markAttendance('${klass.id}', '${b.user_id}', 'present')">Present</button> <button class="secondary" onclick="actions.markAttendance('${klass.id}', '${b.user_id}', 'absent')">Absent</button></td></tr>`;
                  }).join("") || `<tr><td colspan="3">No bookings.</td></tr>`}
                </tbody>
              </table>
            </article>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function renderReports() {
  if (!canManage()) return `<div class="error">Only admins can export reports.</div>`;
  return `
    <section class="card">
      <h2>Reports</h2>
      <div class="row">
        <button onclick="actions.exportCsv('members')">Members CSV</button>
        <button onclick="actions.exportCsv('classes')">Classes CSV</button>
        <button onclick="actions.exportCsv('bookings')">Bookings CSV</button>
        <button onclick="actions.exportCsv('attendance')">Attendance CSV</button>
        <button onclick="actions.exportCsv('waitlist')">Waitlist CSV</button>
      </div>
    </section>
  `;
}

function renderProfile() {
  return `
    <section class="card">
      <h2>Profile</h2>
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

window.actions = {
  setTab(tab) {
    state.tab = tab;
    render();
  },
  async login(event) {
    event.preventDefault();
    const form = new FormData(event.target);
    const { error } = await db.auth.signInWithPassword({
      email: form.get("email"),
      password: form.get("password"),
    });
    if (error) document.querySelector("#authMessage").innerHTML = `<div class="error">${esc(error.message)}</div>`;
  },
  async register(event) {
    event.preventDefault();
    const form = new FormData(event.target);
    const { error } = await db.auth.signUp({
      email: form.get("email"),
      password: form.get("password"),
      options: {
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
      : `<div class="success">Account created. Check your email if confirmation is enabled, then wait for admin approval.</div>`;
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
  createClass(event) {
    event.preventDefault();
    const form = new FormData(event.target);
    run(() => db.from("spinx_classes").insert({
      title: form.get("title"),
      starts_at: new Date(form.get("starts_at")).toISOString(),
      duration_minutes: Number(form.get("duration_minutes")),
      notes: form.get("notes"),
      instructor_id: state.profile.id,
    }), "Class created.");
  },
  updateClass(id, patch) {
    run(() => db.from("spinx_classes").update(patch).eq("id", id), "Class updated.");
  },
  updateMember(id, patch) {
    run(() => db.from("spinx_profiles").update(patch).eq("id", id), "Member updated.");
  },
  declineMember(id) {
    if (!confirm("Decline and delete this member?")) return;
    run(() => db.rpc("spinx_decline_member", { p_user_id: id }), "Member declined.");
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
    const csv = [keys.join(","), ...data.map((row) => keys.map((key) => `"${String(row[key] ?? "").replaceAll('"', '""')}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `spinx-${kind}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  },
};

init();
