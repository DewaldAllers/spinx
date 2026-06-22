const SUPABASE_URL = window.SPINX_SUPABASE_URL;
const SUPABASE_KEY = window.SPINX_SUPABASE_KEY;
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const app = document.querySelector("#app");

const state = {
  session: null,
  profile: null,
  authMode: "login",
  tab: "dashboard",
  message: "",
  error: "",
  selectedDate: toDateKey(new Date()),
  calendarMonth: firstOfMonth(new Date()),
  memberFilter: "all",
  editingClassId: "",
  selectedBookingClassId: "",
  navScrollLeft: 0,
  memberSearch: "",
  calendarFiltersExpanded: false,
  calendarFilters: {
    classId: "all",
    instructorId: "all",
    payment: "all",
    attendance: "all",
    bookingState: "all",
    bikes: "all",
  },
  calendarDetailClassId: "",
  calendarDetailKey: "",
  prospectiveClassId: "",
  data: {
    classes: [],
    bookings: [],
    waitlist: [],
    members: [],
    attendance: [],
    payments: [],
    prospectiveMembers: [],
    prospectiveBookings: [],
    prospectiveOccupancy: [],
    indemnities: [],
  },
};

const PROSPECTIVE_INDEMNITY_TEXT = "I confirm that I am voluntarily participating in a SpinX Studio class. I understand that indoor cycling is physically demanding and may involve risk of injury. I confirm that the information I supplied is accurate, that I will follow the instructor's safety directions, and that I accept responsibility for disclosing any medical condition that may affect safe participation.";

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
  return state.profile.role === "member" && state.profile.status === "active" && state.profile.payment_status === "paid";
}

function isMember() {
  return state.profile?.role === "member";
}

function statusPill(value) {
  const clean = String(value || "").replaceAll("_", " ");
  const kind = value === "active" || value === "paid" || value === "present" || value === "admin" || value === "booked"
    ? "ok"
    : value === "pending_approval" || value === "waiting" || value === "instructor"
      ? "warn"
      : value === "member"
        ? "neutral"
        : "bad";
  return `<span class="pill ${kind}">${esc(clean)}</span>`;
}

function hydrateIcons() {
  window.requestAnimationFrame(() => {
    window.lucide?.createIcons({
      attrs: {
        "aria-hidden": "true",
        "stroke-width": 2,
      },
    });
  });
}

function restoreNavScroll() {
  window.requestAnimationFrame(() => {
    const nav = document.querySelector(".nav");
    if (nav) nav.scrollLeft = state.navScrollLeft;
  });
}

function setupSignaturePads() {
  document.querySelectorAll("canvas.signature-pad").forEach((canvas) => {
    if (canvas.dataset.ready === "true") return;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * ratio));
    canvas.height = Math.max(1, Math.floor(rect.height * ratio));
    const context = canvas.getContext("2d");
    context.scale(ratio, ratio);
    context.strokeStyle = "#91ff19";
    context.lineWidth = 2.4;
    context.lineCap = "round";
    context.lineJoin = "round";
    let drawing = false;

    const point = (event) => {
      const bounds = canvas.getBoundingClientRect();
      return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    };

    canvas.addEventListener("pointerdown", (event) => {
      drawing = true;
      canvas.setPointerCapture(event.pointerId);
      const start = point(event);
      context.beginPath();
      context.moveTo(start.x, start.y);
      event.preventDefault();
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!drawing) return;
      const next = point(event);
      context.lineTo(next.x, next.y);
      context.stroke();
      canvas.dataset.signed = "true";
      event.preventDefault();
    });
    const stop = (event) => {
      drawing = false;
      if (event?.pointerId !== undefined && canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
    };
    canvas.addEventListener("pointerup", stop);
    canvas.addEventListener("pointercancel", stop);
    canvas.dataset.ready = "true";
  });
}

function dashboardIcon(label) {
  const normalized = String(label || "").toLowerCase();
  if (normalized.includes("total member")) return "users";
  if (normalized === "active" || normalized.includes("membership")) return "activity";
  if (normalized.includes("pending")) return "clock-3";
  if (normalized.includes("payment") || normalized.includes("unpaid")) return "wallet-cards";
  if (normalized.includes("booking")) return "calendar-check-2";
  if (normalized.includes("waiting")) return "users-round";
  if (normalized.includes("no-show")) return "triangle-alert";
  if (normalized.includes("streak")) return "flame";
  if (normalized.includes("ride")) return "bike";
  return "circle-gauge";
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

function startOfWeek(date) {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function weekKey(date) {
  return toDateKey(startOfWeek(date));
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function toDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function makeUuid() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
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
  return visibleClasses()
    .filter((klass) => classDateKey(klass) === dateKey)
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
}

function classBookings(classId) {
  return state.data.bookings.filter((booking) => booking.class_id === classId && booking.status === "booked");
}

function classCancelledBookings(classId) {
  return state.data.bookings.filter((booking) => booking.class_id === classId && booking.status === "cancelled");
}

function classProspectiveBookings(classId, status = "booked") {
  return state.data.prospectiveBookings.filter((booking) => booking.class_id === classId && booking.status === status);
}

function prospectiveById(id) {
  return state.data.prospectiveMembers.find((person) => person.id === id);
}

function indemnityForProspective(classId, prospectiveMemberId) {
  return state.data.indemnities.find((record) => record.class_id === classId && record.prospective_member_id === prospectiveMemberId);
}

function prospectiveOccupiedBikeNumbers(classId) {
  const source = canManage()
    ? classProspectiveBookings(classId, "booked")
    : state.data.prospectiveOccupancy.filter((booking) => booking.class_id === classId);
  return source.map((booking) => Number(booking.bike_number));
}

function classWaitlist(classId) {
  return state.data.waitlist.filter((entry) => entry.class_id === classId && entry.status === "waiting");
}

function availabilityForClass(klass) {
  const memberBookings = classBookings(klass.id);
  const occupiedBikes = new Set([
    ...memberBookings.map((booking) => Number(booking.bike_number)),
    ...prospectiveOccupiedBikeNumbers(klass.id),
  ]);
  const booked = occupiedBikes.size;
  const left = Math.max(0, 9 - booked);
  return {
    booked,
    memberBooked: memberBookings.length,
    prospectiveBooked: prospectiveOccupiedBikeNumbers(klass.id).length,
    occupiedBikes,
    openBikes: Array.from({ length: 9 }, (_, index) => index + 1).filter((bike) => !occupiedBikes.has(bike)),
    left,
    full: left === 0,
  };
}

function availabilityForDate(dateKey) {
  const activeClasses = classesForDate(dateKey).filter((klass) => klass.status === "active");
  const classDetails = activeClasses.map((klass) => ({
    id: klass.id,
    time: toTimeInput(klass.starts_at),
    left: availabilityForClass(klass).left,
    full: availabilityForClass(klass).full,
  }));
  const capacity = activeClasses.length * 9;
  const booked = activeClasses.reduce((sum, klass) => sum + availabilityForClass(klass).booked, 0);
  const left = Math.max(0, capacity - booked);
  return {
    classCount: activeClasses.length,
    capacity,
    booked,
    left,
    full: activeClasses.length > 0 && left === 0,
    classDetails,
  };
}

function memberById(id) {
  return state.data.members.find((member) => member.id === id);
}

function instructors() {
  return state.data.members
    .filter((member) => (member.role === "instructor" || member.role === "admin") && member.status === "active")
    .sort((a, b) => fullName(a).localeCompare(fullName(b)));
}

function membersForAdminBooking() {
  return state.data.members
    .filter((member) => member.role === "member" && member.status === "active")
    .sort((a, b) => fullName(a).localeCompare(fullName(b)));
}

function instructorName(klass) {
  const instructor = memberById(klass.instructor_id);
  return instructor ? fullName(instructor) : "Unassigned";
}

function visibleClasses() {
  if (state.profile?.role !== "instructor") return state.data.classes;
  return state.data.classes.filter((klass) => klass.instructor_id === state.profile.id);
}

function instructorSelect(name, selectedId = "", required = false) {
  const list = instructors();
  return `
    <select name="${esc(name)}" ${required ? "required" : ""}>
      <option value="">${list.length ? "Choose instructor" : "No instructor assigned"}</option>
      ${list.map((member) => `<option value="${esc(member.id)}" ${member.id === selectedId ? "selected" : ""}>${esc(fullName(member))}</option>`).join("")}
    </select>
  `;
}

function attendanceFor(classId, userId) {
  return state.data.attendance.find((item) => item.class_id === classId && item.user_id === userId);
}

function classCalendarStats(klass) {
  const activeBookings = classBookings(klass.id).sort((a, b) => a.bike_number - b.bike_number);
  const prospectiveBookings = classProspectiveBookings(klass.id, "booked").sort((a, b) => a.bike_number - b.bike_number);
  const cancelledBookings = classCancelledBookings(klass.id);
  const cancelledProspective = classProspectiveBookings(klass.id, "cancelled");
  const waiting = classWaitlist(klass.id);
  const attendanceRows = activeBookings.map((booking) => ({
    booking,
    member: memberById(booking.user_id),
    attendance: attendanceFor(klass.id, booking.user_id),
  }));
  const present = attendanceRows.filter((row) => row.attendance?.status === "present");
  const absent = attendanceRows.filter((row) => row.attendance?.status === "absent");
  const notMarked = attendanceRows.filter((row) => !row.attendance);
  const unpaid = attendanceRows.filter((row) => row.member?.payment_status === "unpaid");
  const availability = availabilityForClass(klass);

  return {
    activeBookings,
    prospectiveBookings,
    cancelledBookings,
    cancelledProspective,
    waiting,
    attendanceRows,
    present,
    absent,
    notMarked,
    unpaid,
    availability,
  };
}

function filteredCalendarClasses() {
  const filters = state.calendarFilters;
  return classesForDate(state.selectedDate).filter((klass) => {
    const stats = classCalendarStats(klass);
    if (filters.classId !== "all" && klass.id !== filters.classId) return false;
    if (filters.instructorId !== "all" && (klass.instructor_id || "") !== filters.instructorId) return false;
    if (filters.payment === "paid" && !stats.attendanceRows.some((row) => row.member?.payment_status === "paid")) return false;
    if (filters.payment === "unpaid" && stats.unpaid.length === 0) return false;
    if (filters.attendance === "present" && stats.present.length === 0) return false;
    if (filters.attendance === "absent" && stats.absent.length === 0) return false;
    if (filters.attendance === "not_marked" && stats.notMarked.length === 0) return false;
    if (filters.bookingState === "cancelled" && stats.cancelledBookings.length + stats.cancelledProspective.length === 0) return false;
    if (filters.bookingState === "no_show" && stats.absent.length === 0) return false;
    if (filters.bikes === "booked" && stats.availability.booked === 0) return false;
    if (filters.bikes === "open" && stats.availability.left === 0) return false;
    if (filters.bikes === "full" && !stats.availability.full) return false;
    return true;
  });
}

function classForBooking(booking) {
  return state.data.classes.find((klass) => klass.id === booking.class_id);
}

function compareBookingsByClassDate(direction = "asc") {
  return (a, b) => {
    const classA = classForBooking(a);
    const classB = classForBooking(b);
    const timeA = new Date(classA?.starts_at || a.created_at || 0).getTime();
    const timeB = new Date(classB?.starts_at || b.created_at || 0).getTime();
    return direction === "asc" ? timeA - timeB : timeB - timeA;
  };
}

function compareClassesByStart(direction = "asc") {
  return (a, b) => {
    const diff = new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime();
    return direction === "asc" ? diff : -diff;
  };
}

function memberStreakStats() {
  const now = new Date();
  const myAttendance = state.data.attendance.filter((item) => item.user_id === state.profile.id && item.status === "present");
  const attendedClassDates = myAttendance
    .map((item) => state.data.classes.find((klass) => klass.id === item.class_id))
    .filter(Boolean)
    .map((klass) => new Date(klass.starts_at));
  const attendedWeeks = new Set(attendedClassDates.map((date) => weekKey(date)));
  const attendedMonths = new Set(attendedClassDates.map((date) => monthKey(date)));

  const classWeeks = Array.from(new Set(
    state.data.classes
      .filter((klass) => klass.status === "active" && new Date(klass.starts_at) <= now)
      .map((klass) => weekKey(new Date(klass.starts_at)))
  )).sort().reverse();

  let weeklyStreak = 0;
  for (const key of classWeeks) {
    const weekStart = fromDateKey(key);
    const weekEnd = addDays(weekStart, 7);
    if (weekEnd > now && !attendedWeeks.has(key)) continue;
    if (!attendedWeeks.has(key)) break;
    weeklyStreak += 1;
  }

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthClasses = state.data.classes.filter((klass) => {
    const startsAt = new Date(klass.starts_at);
    return klass.status === "active" && startsAt >= monthStart && startsAt <= now;
  }).length;
  const monthAttendance = attendedClassDates.filter((date) => date >= monthStart && date <= now).length;

  return {
    weeklyStreak,
    monthAttendance,
    monthClasses,
    activeMonths: attendedMonths.size,
  };
}

function matchingFutureClassIds(source) {
  const sourceStart = new Date(source.starts_at);
  if (source.series_id) {
    return state.data.classes
      .filter((klass) => klass.series_id === source.series_id && new Date(klass.starts_at) >= sourceStart)
      .map((klass) => klass.id);
  }

  const sourceTime = toTimeInput(source.starts_at);
  const sourceDay = sourceStart.getDay();
  return state.data.classes
    .filter((klass) => {
      const startsAt = new Date(klass.starts_at);
      return startsAt >= sourceStart
        && klass.title === source.title
        && Number(klass.duration_minutes) === Number(source.duration_minutes)
        && (klass.instructor_id || "") === (source.instructor_id || "")
        && startsAt.getDay() === sourceDay
        && toTimeInput(klass.starts_at) === sourceTime;
    })
    .map((klass) => klass.id);
}

function setMessage(message, error = "") {
  state.message = message;
  state.error = error;
  render();
}

function clearMessages() {
  state.message = "";
  state.error = "";
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

  const occupancy = await db.rpc("spinx_prospective_occupancy");
  state.data.prospectiveOccupancy = occupancy.data || [];

  if (canTeach()) {
    const members = await db.from("spinx_profiles").select("*").order("created_at", { ascending: false });
    state.data.members = members.data || [];
  } else {
    state.data.members = [];
  }

  if (canManage()) {
    const [payments, prospectiveMembers, prospectiveBookings, indemnities] = await Promise.all([
      db.from("spinx_payments").select("*").order("due_month", { ascending: false }),
      db.from("spinx_prospective_members").select("*").order("created_at", { ascending: false }),
      db.from("spinx_prospective_bookings").select("*").order("created_at", { ascending: false }),
      db.from("spinx_indemnities").select("*").order("signed_at", { ascending: false }),
    ]);
    state.data.payments = payments.data || [];
    state.data.prospectiveMembers = prospectiveMembers.data || [];
    state.data.prospectiveBookings = prospectiveBookings.data || [];
    state.data.indemnities = indemnities.data || [];
  } else {
    state.data.payments = [];
    state.data.prospectiveMembers = [];
    state.data.prospectiveBookings = [];
    state.data.indemnities = [];
  }
}

function renderAuth() {
  app.innerHTML = `
    <main class="auth-shell">
      <section class="auth-card">
        <div class="brand-panel">
          <div>
            <img class="brand-logo" src="./assets/spinx-logo.jpeg" alt="SpinX Studio" />
            <h1>SpinX Studio</h1>
            <p class="lead">Pedal. Connect. Belong.</p>
          </div>
          <div class="auth-stats">
            <span>9 bikes</span>
            <span>Manual EFT</span>
            <span>Admin approval</span>
          </div>
        </div>
        <div class="auth-form">
          <div id="authMessage"></div>
          <div class="auth-mode-tabs" role="tablist" aria-label="Account access">
            <button type="button" class="${state.authMode === "login" ? "active" : ""}" onclick="actions.setAuthMode('login')">Log in</button>
            <button type="button" class="${state.authMode === "register" ? "active" : ""}" onclick="actions.setAuthMode('register')">Sign up</button>
          </div>
          <div class="auth-section ${state.authMode === "login" ? "active" : ""}">
            <h2>Log in</h2>
            <form onsubmit="actions.login(event)" class="stack">
              <input name="email" type="email" placeholder="Email" autocomplete="email" required />
              <div class="password-field">
                <input name="password" type="password" placeholder="Password" autocomplete="current-password" required />
                <button type="button" class="password-toggle" onclick="actions.togglePassword(this)" aria-label="Show password" title="Show password">
                  <i data-lucide="eye"></i>
                </button>
              </div>
              <button>Log in</button>
              <button type="button" class="ghost auth-switch" onclick="actions.setAuthMode('register')">Create a new account</button>
            </form>
          </div>
          <div class="auth-section ${state.authMode === "register" ? "active" : ""}">
            <h2>Sign up</h2>
            <form onsubmit="actions.register(event)" class="stack">
              <div class="form-grid">
                <input name="first_name" placeholder="First name" autocomplete="given-name" required />
                <input name="last_name" placeholder="Last name" autocomplete="family-name" required />
                <input name="mobile" placeholder="Mobile number" autocomplete="tel" required />
                <input name="emergency_contact" placeholder="Emergency contact" required />
                <input class="full" name="email" type="email" placeholder="Email" autocomplete="email" required />
                <div class="password-field full">
                  <input name="password" type="password" placeholder="Password" minlength="8" autocomplete="new-password" required />
                  <button type="button" class="password-toggle" onclick="actions.togglePassword(this)" aria-label="Show password" title="Show password">
                    <i data-lucide="eye"></i>
                  </button>
                </div>
                <textarea class="full" name="signature_text" placeholder="Type your full name as your signature" required></textarea>
              </div>
              <label class="check-row">
                <input type="checkbox" required />
                <span>I accept the SpinX membership agreement and terms.</span>
              </label>
              <button>Create account</button>
              <button type="button" class="ghost auth-switch" onclick="actions.setAuthMode('login')">Back to log in</button>
            </form>
          </div>
        </div>
      </section>
    </main>
  `;
  hydrateIcons();
}

function formatMemberNumber(value) {
  if (value === null || value === undefined || value === "") return "Pending";
  return String(value).padStart(4, "0");
}

function prospectiveFullName(person) {
  return `${person?.first_name || ""} ${person?.last_name || ""}`.trim() || person?.email || "Prospective member";
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
    <main class="app-shell role-${esc(state.profile.role)} tab-shell-${esc(state.tab)}">
      <aside class="sidebar">
        <div class="sidebar-title">
          <img class="sidebar-logo" src="./assets/spinx-logo.jpeg" alt="SpinX Studio" />
          <div>
            <strong>SpinX Studio</strong>
            <small>${esc(state.profile.role)}</small>
          </div>
        </div>
        <div class="sidebar-user">
          <div class="user-chip">${esc(initials)}</div>
          <small>${esc(state.profile.role)}</small>
        </div>
        <button class="mobile-logout-button" onclick="actions.logout()" aria-label="Log out" title="Log out">
          <i data-lucide="log-out"></i>
        </button>
        <nav class="nav" onscroll="actions.rememberNavScroll(event)">
          ${tabs.map((tab) => `<button class="${state.tab === tab ? "active" : ""}" onclick="actions.setTab('${tab}')">${tabLabel(tab)}</button>`).join("")}
        </nav>
        <button class="logout-button" onclick="actions.logout()">Log out</button>
      </aside>
      <section class="content tab-${esc(state.tab)}">
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
  hydrateIcons();
  restoreNavScroll();
  setupSignaturePads();
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
  const upcomingClasses = visibleClasses().filter((klass) => klass.status === "active" && new Date(klass.starts_at) >= new Date());
  const nextClass = upcomingClasses[0];

  return `
    ${dashboardHero()}
    <div class="dashboard-section-head">
      <h2>Overview</h2>
      <span>Current view</span>
    </div>
    <div class="dashboard-grid neon-overview">
      ${metric("Total members", members.length, "members", "all", "All time", "cyan")}
      ${metric("Active", activeMembers.length, "members", "active", "Current", "lime")}
      ${metric("Pending approvals", pendingMembers.length, "members", "pending_approval", "Needs review", "orange")}
      ${metric("Unpaid members", unpaidMembers.length, "members", "unpaid", "This month", "red")}
      ${metric("Bookings", booked.length, "bookings", "", "This week", "blue")}
      ${metric("Waiting list", waits.length, "bookings", "", "Queue", "purple")}
      ${metric("No-show warnings", noShowMembers.length, "members", "no_shows", "Warnings", "yellow")}
    </div>
    ${renderNextClassCard(nextClass)}
    <section class="panel neon-panel attention-panel">
      <div class="panel-head">
        <h2>Needs attention</h2>
        <button class="ghost small attention-view-all" onclick="actions.setTab('members')">View all</button>
      </div>
      ${attentionRow("Pending approvals", pendingMembers.length, "pending_approval", "cyan")}
      ${attentionRow("Unpaid members", unpaidMembers.length, "unpaid", "red")}
      ${attentionRow("No-show warnings", noShowMembers.length, "no_shows", "yellow")}
    </section>
    <section class="panel neon-panel occupancy-panel">
      <div class="panel-head">
        <h2>Upcoming occupancy</h2>
        <button class="ghost small manage-link" onclick="actions.setTab('classes')">Manage classes</button>
      </div>
      <div class="occupancy-list">
        ${upcomingClasses.slice(0, 6).map((klass, index) => renderOccupancyRow(klass, index)).join("") || `<p class="muted">No upcoming classes yet.</p>`}
      </div>
    </section>
  `;
}

function renderMemberDashboard() {
  const streak = memberStreakStats();
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
  const upcomingClasses = visibleClasses().filter((klass) => klass.status === "active" && new Date(klass.starts_at) >= new Date());
  const displayNextClass = nextClass || upcomingClasses[0];

  return `
    ${dashboardHero()}
    <div class="dashboard-section-head">
      <h2>Overview</h2>
      <span>Member view</span>
    </div>
    <div class="dashboard-grid neon-overview">
      ${metric("Membership", state.profile.status.replaceAll("_", " "), "", "", "Current", "lime")}
      ${metric("Payment", state.profile.payment_status, "", "", "This month", state.profile.payment_status === "paid" ? "cyan" : "red")}
      ${metric("No-shows", state.profile.no_show_count || 0, "", "", "Warnings", "yellow")}
      ${metric("Weekly streak", streak.weeklyStreak, "", "", "Active weeks", "purple")}
      ${metric("Month rides", streak.monthAttendance, "", "", "This month", "blue")}
    </div>
    ${renderNextClassCard(displayNextClass)}
    <section class="panel neon-panel">
      <div class="panel-head">
        <h2>Upcoming classes</h2>
        <button class="ghost small manage-link" onclick="actions.setTab('calendar')">View all</button>
      </div>
      <div class="occupancy-list">
        ${upcomingClasses.slice(0, 5).map((klass, index) => renderOccupancyRow(klass, index)).join("") || `<p class="muted">No classes scheduled.</p>`}
      </div>
    </section>
  `;
}

function greetingPrefix() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function dashboardHero() {
  return `
    <section class="dashboard-hero">
      <div>
        <h2>${greetingPrefix()},<br><strong>${esc(state.profile.first_name || fullName(state.profile))}</strong></h2>
        <p>Here's what's happening at SpinX Studio.</p>
      </div>
      <div class="hero-bike-art">
        <img src="./assets/spinx-logo.jpeg" alt="" />
      </div>
    </section>
  `;
}

function metric(label, value, tab = "", filter = "", meta = "Current", tone = "cyan") {
  const click = tab ? `onclick="actions.openMetric('${tab}', '${filter}')"` : "";
  return `
    <section class="metric-panel neon-metric tone-${tone} ${tab ? "clickable" : ""}" ${click}>
      <div class="metric-icon"><i data-lucide="${dashboardIcon(label)}"></i></div>
      <span>${esc(label)}</span>
      <strong>${esc(value)}</strong>
      <small>${esc(meta)}</small>
    </section>
  `;
}

function attentionRow(label, count, filter, tone = "cyan") {
  return `
    <button class="attention-row tone-${tone}" onclick="actions.showMembers('${filter}')">
      <span><i class="attention-icon" data-lucide="${dashboardIcon(label)}"></i>${esc(label)}</span>
      <strong>${esc(count)}</strong>
      <b>›</b>
    </button>
  `;
}

function renderNextClassCard(klass) {
  if (!klass) {
    return `
      <section class="next-class-card">
        <div>
          <small>Today's next class</small>
          <h2>No upcoming class</h2>
          <p class="muted">Create a class from the calendar or class planner.</p>
        </div>
      </section>
    `;
  }
  const availability = availabilityForClass(klass);
  return `
    <section class="next-class-card" onclick="actions.openClassDate('${classDateKey(klass)}')">
      <div class="next-class-icon">SX</div>
      <div>
        <small>Today's next class</small>
        <h2>${esc(klass.title)}</h2>
        <p>${niceDate(klass.starts_at)}</p>
        <p>Instructor: ${esc(instructorName(klass))}</p>
        <span>${availability.left} spot${availability.left === 1 ? "" : "s"} left</span>
      </div>
      <button type="button" class="next-arrow">›</button>
    </section>
  `;
}

function renderOccupancyRow(klass, index = 0) {
  const availability = availabilityForClass(klass);
  const percent = Math.min(100, Math.round((availability.booked / 9) * 100));
  const tone = ["lime", "yellow", "purple", "blue"][index % 4];
  return `
    <button type="button" class="occupancy-row tone-${tone}" onclick="actions.openClassDate('${classDateKey(klass)}')">
      <div class="occupancy-ring" style="--value:${percent}"><span>${percent}%</span></div>
      <div>
        <strong>${esc(klass.title)}</strong>
        <span>${niceDate(klass.starts_at)} - ${esc(instructorName(klass))}</span>
      </div>
      <em>${availability.left} spot${availability.left === 1 ? "" : "s"} left</em>
      <div class="occupancy-line"><i style="width:${percent}%"></i></div>
      <b>›</b>
    </button>
  `;
}

function renderClassSummary(klass) {
  const availability = availabilityForClass(klass);
  const waitlist = classWaitlist(klass.id);
  const percent = Math.min(100, Math.round((availability.booked / 9) * 100));
  const dateKey = classDateKey(klass);
  return `
    <button type="button" class="summary-row ${availability.full ? "full" : availability.left <= 2 ? "low" : ""}" onclick="actions.openClassDate('${dateKey}')">
      <div>
        <strong>${esc(klass.title)}</strong>
        <span>${niceDate(klass.starts_at)} - Instructor: ${esc(instructorName(klass))}</span>
      </div>
      <div class="occupancy">
        <span>${availability.full ? "Full" : `${availability.left} spot${availability.left === 1 ? "" : "s"} left`}</span>
        <div><i style="width:${percent}%"></i></div>
        ${waitlist.length ? `<small>${waitlist.length} waiting</small>` : ""}
      </div>
    </button>
  `;
}

function renderCalendarFilters() {
  if (!canManage()) return "";
  const dayClasses = classesForDate(state.selectedDate);
  const filters = state.calendarFilters;
  const selected = (current, value) => current === value ? "selected" : "";
  return `
    <section class="panel calendar-filter-panel ${state.calendarFiltersExpanded ? "expanded" : ""}">
      <div class="panel-head">
        <div>
          <h2>Calendar filters</h2>
          <p class="muted">Narrow the selected day by class, instructor, payment, attendance, cancellations, no-shows, or bike availability.</p>
        </div>
        <div class="action-row compact-actions">
          <button class="ghost small calendar-filter-toggle" onclick="actions.toggleCalendarFilters()">${state.calendarFiltersExpanded ? "Hide filters" : "Show filters"}</button>
          <button class="ghost small" onclick="actions.resetCalendarFilters()">Reset</button>
        </div>
      </div>
      <div class="calendar-filter-content">
        <div class="calendar-filter-grid">
        <label class="field-label">Date
          <input type="date" value="${esc(state.selectedDate)}" onchange="actions.setCalendarDate(this.value)" />
        </label>
        <label class="field-label">Class
          <select onchange="actions.setCalendarFilter('classId', this.value)">
            <option value="all">All classes</option>
            ${dayClasses.map((klass) => `<option value="${esc(klass.id)}" ${selected(filters.classId, klass.id)}>${esc(klass.title)} - ${esc(toTimeInput(klass.starts_at))}</option>`).join("")}
          </select>
        </label>
        <label class="field-label">Instructor
          <select onchange="actions.setCalendarFilter('instructorId', this.value)">
            <option value="all">All instructors</option>
            ${instructors().map((person) => `<option value="${esc(person.id)}" ${selected(filters.instructorId, person.id)}>${esc(fullName(person))}</option>`).join("")}
          </select>
        </label>
        <label class="field-label">Payment
          <select onchange="actions.setCalendarFilter('payment', this.value)">
            <option value="all">Paid and unpaid</option>
            <option value="paid" ${selected(filters.payment, "paid")}>Paid members</option>
            <option value="unpaid" ${selected(filters.payment, "unpaid")}>Unpaid members</option>
          </select>
        </label>
        <label class="field-label">Attendance
          <select onchange="actions.setCalendarFilter('attendance', this.value)">
            <option value="all">All attendance</option>
            <option value="present" ${selected(filters.attendance, "present")}>Present</option>
            <option value="absent" ${selected(filters.attendance, "absent")}>Absent / no-show</option>
            <option value="not_marked" ${selected(filters.attendance, "not_marked")}>Not marked</option>
          </select>
        </label>
        <label class="field-label">Booking status
          <select onchange="actions.setCalendarFilter('bookingState', this.value)">
            <option value="all">All bookings</option>
            <option value="cancelled" ${selected(filters.bookingState, "cancelled")}>Cancellations</option>
            <option value="no_show" ${selected(filters.bookingState, "no_show")}>No-shows</option>
          </select>
        </label>
        <label class="field-label">Bikes
          <select onchange="actions.setCalendarFilter('bikes', this.value)">
            <option value="all">Booked and open bikes</option>
            <option value="booked" ${selected(filters.bikes, "booked")}>Has booked bikes</option>
            <option value="open" ${selected(filters.bikes, "open")}>Has open bikes</option>
            <option value="full" ${selected(filters.bikes, "full")}>Full classes</option>
          </select>
        </label>
        </div>
      </div>
    </section>
  `;
}

function calendarSummaryChip(klass, key, label, value, tone) {
  const active = state.calendarDetailClassId === klass.id && state.calendarDetailKey === key;
  return `
    <button type="button" class="calendar-summary-chip tone-${tone} ${active ? "active" : ""}" onclick="actions.toggleCalendarDetail('${klass.id}', '${key}')">
      <span>${esc(label)}</span>
      <strong>${esc(value)}</strong>
    </button>
  `;
}

function memberCalendarLine(row) {
  const attendance = row.attendance?.status || "not marked";
  return `
    <div class="calendar-detail-row">
      <div>
        <strong>${esc(fullName(row.member))}</strong>
        <span>Bike ${esc(row.booking.bike_number)} - ${esc(row.member?.payment_status || "unknown payment")} - ${esc(attendance)}</span>
      </div>
      ${row.member ? statusPill(row.member.payment_status) : ""}
    </div>
  `;
}

function prospectiveCalendarLine(booking) {
  const person = prospectiveById(booking.prospective_member_id);
  const agreement = indemnityForProspective(booking.class_id, booking.prospective_member_id);
  return `
    <div class="calendar-detail-row">
      <div>
        <strong>${esc(prospectiveFullName(person))} <span class="pill warn">prospective</span></strong>
        <span>Bike ${esc(booking.bike_number)} - ${esc(person?.phone || "No phone")}</span>
      </div>
      <div class="action-row compact-actions">
        ${agreement ? `<button class="ghost small" onclick="actions.downloadIndemnity('${agreement.id}')">Indemnity PDF</button>` : ""}
        ${booking.status === "booked" ? `<button class="danger small" onclick="actions.cancelProspectiveBooking('${booking.id}')">Cancel</button>` : ""}
      </div>
    </div>
  `;
}

function renderCalendarDetail(klass, key, stats) {
  if (key === "all") {
    return ["booked", "open", "attendance", "cancelled", "no_show", "unpaid", "waiting"]
      .map((detailKey) => renderCalendarDetail(klass, detailKey, stats))
      .join("");
  }

  let title = "Details";
  let content = "";
  if (key === "booked") {
    title = "Booked bikes";
    content = [
      ...stats.attendanceRows.map(memberCalendarLine),
      ...stats.prospectiveBookings.map(prospectiveCalendarLine),
    ].join("") || `<p class="muted">No bikes are booked.</p>`;
  } else if (key === "open") {
    title = "Open bikes";
    content = stats.availability.openBikes.length
      ? `<div class="open-bike-list">${stats.availability.openBikes.map((bike) => `<span>Bike ${bike}</span>`).join("")}</div>`
      : `<p class="muted">This class is full.</p>`;
  } else if (key === "attendance") {
    title = "Attendance totals";
    content = `
      <div class="detail-totals"><span>${stats.present.length} present</span><span>${stats.absent.length} absent</span><span>${stats.notMarked.length} not marked</span></div>
      ${stats.attendanceRows.map(memberCalendarLine).join("") || `<p class="muted">No member attendance to show.</p>`}
    `;
  } else if (key === "cancelled") {
    title = "Cancelled bookings";
    content = [
      ...stats.cancelledBookings.map((booking) => {
        const member = memberById(booking.user_id);
        return `<div class="calendar-detail-row"><div><strong>${esc(fullName(member))}</strong><span>Bike ${esc(booking.bike_number)}</span></div>${statusPill("cancelled")}</div>`;
      }),
      ...stats.cancelledProspective.map(prospectiveCalendarLine),
    ].join("") || `<p class="muted">No cancelled bookings.</p>`;
  } else if (key === "no_show") {
    title = "No-shows";
    content = stats.absent.map(memberCalendarLine).join("") || `<p class="muted">No no-shows recorded.</p>`;
  } else if (key === "unpaid") {
    title = "Unpaid booked members";
    content = stats.unpaid.map(memberCalendarLine).join("") || `<p class="muted">No unpaid members are booked.</p>`;
  } else if (key === "waiting") {
    title = "Waiting list";
    content = stats.waiting.map((entry) => {
      const member = memberById(entry.user_id);
      return `<div class="calendar-detail-row"><div><strong>${esc(fullName(member))}</strong><span>${esc(member?.mobile || member?.email || "")}</span></div>${statusPill("waiting")}</div>`;
    }).join("") || `<p class="muted">Nobody is waiting.</p>`;
  }

  return `<section class="calendar-detail-panel"><h4>${esc(title)}</h4>${content}</section>`;
}

function renderProspectiveBookingForm(klass) {
  if (!canManage() || state.prospectiveClassId !== klass.id) return "";
  return `
    <form class="prospective-form" onsubmit="actions.bookProspective(event, '${klass.id}')">
      <div class="panel-head">
        <div><h3>Prospective member</h3><p class="muted">Contact details, indemnity acceptance, and signature are required.</p></div>
        <button type="button" class="ghost small" onclick="actions.openProspectiveBooking('')">Close</button>
      </div>
      <div class="form-grid">
        <input name="first_name" placeholder="First name" required />
        <input name="last_name" placeholder="Last name" required />
        <input name="phone" placeholder="Phone number" autocomplete="tel" required />
        <input name="email" type="email" placeholder="Email address" autocomplete="email" required />
      </div>
      <div class="indemnity-copy"><strong>SpinX Studio indemnity</strong><p>${esc(PROSPECTIVE_INDEMNITY_TEXT)}</p></div>
      <label class="check-row"><input name="indemnity_accepted" type="checkbox" required /><span>I have read and accept this indemnity.</span></label>
      <label class="field-label">Signature
        <canvas id="prospective-signature-${esc(klass.id)}" class="signature-pad" aria-label="Signature pad"></canvas>
      </label>
      <div class="action-row">
        <button type="button" class="ghost" onclick="actions.clearSignature('${klass.id}')">Clear signature</button>
        <button>Sign, book, and download PDF</button>
      </div>
    </form>
  `;
}

function renderStaffCalendarClassCard(klass) {
  const stats = classCalendarStats(klass);
  const cancellationCount = stats.cancelledBookings.length + stats.cancelledProspective.length;
  const detailOpen = state.calendarDetailClassId === klass.id;
  return `
    <article class="class-block calendar-admin-class ${klass.status === "cancelled" ? "cancelled" : ""}">
      <div class="class-head">
        <div>
          <h3>${esc(klass.title)}</h3>
          <p>${niceDate(klass.starts_at)} - Instructor: ${esc(instructorName(klass))}</p>
          <p>${stats.availability.booked}/9 bikes booked - ${stats.availability.left} open</p>
        </div>
        ${statusPill(klass.status)}
      </div>
      ${stats.unpaid.length ? `<div class="notice compact">${stats.unpaid.length} unpaid booked member${stats.unpaid.length === 1 ? "" : "s"}</div>` : ""}
      <div class="calendar-summary-grid">
        ${calendarSummaryChip(klass, "booked", "Bikes booked", stats.availability.booked, "cyan")}
        ${calendarSummaryChip(klass, "open", "Bikes open", stats.availability.left, "lime")}
        ${calendarSummaryChip(klass, "attendance", "Attendance", `${stats.present.length}/${stats.absent.length}`, "blue")}
        ${calendarSummaryChip(klass, "cancelled", "Cancellations", cancellationCount, "red")}
        ${calendarSummaryChip(klass, "no_show", "No-shows", stats.absent.length, "yellow")}
        ${calendarSummaryChip(klass, "unpaid", "Unpaid booked", stats.unpaid.length, "orange")}
        ${calendarSummaryChip(klass, "waiting", "Waiting", stats.waiting.length, "purple")}
        ${calendarSummaryChip(klass, "all", "Full details", detailOpen && state.calendarDetailKey === "all" ? "Hide" : "View", "cyan")}
      </div>
      ${detailOpen ? renderCalendarDetail(klass, state.calendarDetailKey, stats) : ""}
      <details class="calendar-action-menu">
        <summary>Class actions</summary>
        <div class="calendar-action-content">
          ${canManage() ? renderAdminBookMember(klass, stats.availability.full, klass.status === "cancelled") : ""}
          ${canManage() && klass.status === "active" && !stats.availability.full ? `<button class="secondary" onclick="actions.openProspectiveBooking('${klass.id}')">Book prospective member</button>` : ""}
          ${renderClassScopeControls(klass)}
        </div>
      </details>
      ${renderProspectiveBookingForm(klass)}
    </article>
  `;
}

function renderCalendar() {
  const allSelectedClasses = classesForDate(state.selectedDate);
  const selectedClasses = canManage() ? filteredCalendarClasses() : allSelectedClasses;
  return `
    ${renderCalendarFilters()}
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
            <p class="muted">${selectedClasses.length} shown from ${allSelectedClasses.length} class${allSelectedClasses.length === 1 ? "" : "es"}</p>
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
        const availability = availabilityForDate(key);
        const isOutside = date.getMonth() !== state.calendarMonth.getMonth();
        const isSelected = key === state.selectedDate;
        const isToday = key === todayKey;
        return `
          <button class="day-cell ${isOutside ? "outside" : ""} ${isSelected ? "selected" : ""} ${isToday ? "today" : ""} ${availability.full ? "full" : availability.left > 0 ? "available" : ""}" onclick="actions.selectDate('${key}')">
            <span>${date.getDate()}</span>
            ${availability.classCount ? `
              <em>${availability.classCount}</em>
              <small>
                <span class="desktop-availability-label">${availability.full ? "full" : `${availability.left} total left`}</span>
                <span class="mobile-availability-label">${availability.full ? "full" : `${availability.left} left`}</span>
              </small>
              <div class="day-availability">
                ${availability.classDetails.slice(0, 2).map((item) => `<b class="${item.full ? "full" : ""}">${esc(item.time)} ${item.full ? "full" : `${item.left} left`}</b>`).join("")}
                ${availability.classDetails.length > 2 ? `<b>+${availability.classDetails.length - 2} more</b>` : ""}
              </div>
            ` : ""}
          </button>
        `;
      }).join("")}
    </div>
  `;
}

function renderClassCard(klass, withActions) {
  if (withActions && canTeach() && state.tab === "calendar") return renderStaffCalendarClassCard(klass);
  const bookings = classBookings(klass.id);
  const availability = availabilityForClass(klass);
  const waitCount = classWaitlist(klass.id).length;
  const mine = bookings.find((booking) => booking.user_id === state.profile.id);
  const isCancelled = klass.status === "cancelled";
  const full = availability.full;
  const showMemberBooking = withActions && isMember();
  const instructor = instructorName(klass);

  return `
    <article class="class-block ${isCancelled ? "cancelled" : ""}">
      <div class="class-head">
        <div>
          <h3>${esc(klass.title)}</h3>
          <p>${niceDate(klass.starts_at)} - ${esc(klass.duration_minutes)} min - ${availability.full ? "Full" : `${availability.left} spot${availability.left === 1 ? "" : "s"} left`}${waitCount ? ` - ${waitCount} waiting` : ""}</p>
          <p class="instructor-line">Instructor: ${esc(instructor)}</p>
        </div>
        ${statusPill(klass.status)}
      </div>
      ${klass.notes ? `<p class="muted">${esc(klass.notes)}</p>` : ""}
      ${showMemberBooking ? `
        <div class="booking-status-card">
          <strong>${mine ? "You are booked" : full ? "Class is full" : "Book your spot"}</strong>
          <span>${mine ? "Your bike is reserved." : full ? "Join the waiting list and you will be promoted if a spot opens." : "One tap books the next available bike."}</span>
        </div>
        <div class="action-row">
          ${!mine && !full && canBook() && !isCancelled ? `<button onclick="actions.bookBike('${klass.id}')">Book a bike</button>` : ""}
          ${mine ? `<button class="secondary" onclick="actions.cancelBooking('${mine.id}')">Cancel booking</button>` : ""}
          ${!mine && full && canBook() && !isCancelled ? `<button class="secondary" onclick="actions.joinWaitlist('${klass.id}')">Join waiting list</button>` : ""}
          ${!canBook() && state.profile.role === "member" ? `<span class="muted">Booking is locked until your account is active and paid.</span>` : ""}
        </div>
      ` : withActions && canTeach() ? `
        <div class="staff-class-tools">
          <span>${bookings.length} member bikes booked</span>
          <span>${9 - bookings.length} member bikes open</span>
          <span>Instructor: ${esc(instructor)}</span>
        </div>
        ${canManage() ? renderAdminBookMember(klass, full, isCancelled) : ""}
        ${renderClassScopeControls(klass)}
        ${renderClassRoster(klass)}
      ` : ""}
    </article>
  `;
}

function renderAdminBookMember(klass, full, isCancelled) {
  const bookedUserIds = new Set(classBookings(klass.id).map((booking) => booking.user_id));
  const members = membersForAdminBooking().filter((member) => !bookedUserIds.has(member.id));
  return `
    <form class="admin-book-form" onsubmit="actions.adminBookMember(event, '${klass.id}')">
      <select name="user_id" ${!members.length || full || isCancelled ? "disabled" : ""} required>
        <option value="">${members.length ? "Book a member into this class" : "No active members available"}</option>
        ${members.map((member) => `<option value="${esc(member.id)}">${esc(fullName(member))}</option>`).join("")}
      </select>
      <button class="secondary" ${!members.length || full || isCancelled ? "disabled" : ""}>Book spot</button>
    </form>
  `;
}

function renderClassScopeControls(klass) {
  const nextStatus = klass.status === "cancelled" ? "active" : "cancelled";
  const primary = nextStatus === "cancelled" ? "Cancel this class" : "Reopen this class";
  const future = nextStatus === "cancelled" ? "Cancel this and future" : "Reopen this and future";
  return `
    <div class="scope-actions">
      <button class="secondary small" onclick="actions.updateClassScope('${klass.id}', '${nextStatus}', 'single')">${primary}</button>
      <button class="secondary small" onclick="actions.updateClassScope('${klass.id}', '${nextStatus}', 'future')">${future}</button>
    </div>
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
  if (canTeach()) return renderStaffBookings();
  return renderMemberBookings();
}

function renderMemberBookings() {
  const now = new Date();
  const myBookings = state.data.bookings.filter((booking) => booking.user_id === state.profile.id);
  const upcoming = myBookings
    .filter((booking) => {
      const klass = classForBooking(booking);
      return booking.status === "booked" && klass && new Date(klass.starts_at) >= now;
    })
    .sort(compareBookingsByClassDate("asc"));
  const archive = myBookings
    .filter((booking) => {
      const klass = classForBooking(booking);
      return booking.status !== "booked" || !klass || new Date(klass.starts_at) < now;
    })
    .sort(compareBookingsByClassDate("desc"));

  return `
    <div class="page-grid">
      <section class="panel span-12">
        <div class="panel-head">
          <div>
            <h2>Upcoming bookings</h2>
            <p class="muted">Nearest class first</p>
          </div>
          <span class="muted">${upcoming.length} active</span>
        </div>
        <div class="booking-card-list">
          ${upcoming.map((booking) => renderMemberBookingCard(booking, true)).join("") || `<p class="muted">No upcoming bookings.</p>`}
        </div>
      </section>
      <section class="panel span-12">
        <div class="panel-head">
          <div>
            <h2>Done / archive</h2>
            <p class="muted">Past and cancelled bookings</p>
          </div>
          <span class="muted">${archive.length} records</span>
        </div>
        <div class="booking-card-list archive-list">
          ${archive.map((booking) => renderMemberBookingCard(booking, false)).join("") || `<p class="muted">No archived bookings yet.</p>`}
        </div>
      </section>
    </div>
  `;
}

function renderMemberBookingCard(booking, canCancel) {
  const klass = classForBooking(booking);
  const displayStatus = !canCancel && booking.status === "booked" ? `<span class="pill ok">done</span>` : statusPill(booking.status);
  return `
    <article class="booking-card ${!canCancel ? "archived" : ""}">
      <div>
        <strong>${esc(klass?.title || "Class")}</strong>
        <span>${klass ? niceDate(klass.starts_at) : "Class removed"}</span>
      </div>
      <div class="booking-card-meta">
        <span>${booking.status === "booked" ? "Booked spot" : "Archived spot"}</span>
        ${displayStatus}
        ${canCancel ? `<button class="ghost small" onclick="actions.cancelBooking('${booking.id}')">Cancel</button>` : ""}
      </div>
    </article>
  `;
}

function renderStaffBookings() {
  const selected = state.selectedBookingClassId
    ? visibleClasses().find((klass) => klass.id === state.selectedBookingClassId)
    : null;
  if (selected) return renderStaffBookingDetails(selected);

  const now = new Date();
  const classes = visibleClasses().slice();
  const upcoming = classes
    .filter((klass) => new Date(klass.starts_at) >= now)
    .sort(compareClassesByStart("asc"));
  const archive = classes
    .filter((klass) => new Date(klass.starts_at) < now)
    .sort(compareClassesByStart("desc"))
    .slice(0, 12);

  return `
    <div class="page-grid">
      <section class="panel span-12">
        <div class="panel-head">
          <div>
            <h2>Class bookings</h2>
            <p class="muted">Tap a class to see its booking list</p>
          </div>
          <span class="muted">${upcoming.length} upcoming</span>
        </div>
        <div class="booking-class-list">
          ${upcoming.map(renderBookingClassCard).join("") || `<p class="muted">No upcoming classes.</p>`}
        </div>
      </section>
      <section class="panel span-12">
        <div class="panel-head">
          <div>
            <h2>Done / archive</h2>
            <p class="muted">Recent completed classes</p>
          </div>
        </div>
        <div class="booking-class-list compact">
          ${archive.map(renderBookingClassCard).join("") || `<p class="muted">No archived classes yet.</p>`}
        </div>
      </section>
    </div>
  `;
}

function renderBookingClassCard(klass) {
  const availability = availabilityForClass(klass);
  const waitCount = classWaitlist(klass.id).length;
  return `
    <button type="button" class="booking-class-card ${availability.full ? "full" : availability.left <= 2 ? "low" : ""}" onclick="actions.openBookingClass('${klass.id}')">
      <div>
        <strong>${esc(klass.title)}</strong>
        <span>${niceDate(klass.starts_at)} - Instructor: ${esc(instructorName(klass))}</span>
      </div>
      <div class="booking-class-stats">
        <span>${availability.booked}/9 booked</span>
        <span>${availability.full ? "Full" : `${availability.left} left`}</span>
        ${waitCount ? `<span>${waitCount} waiting</span>` : ""}
        ${statusPill(klass.status)}
      </div>
    </button>
  `;
}

function renderStaffBookingDetails(klass) {
  const bookings = classBookings(klass.id).sort((a, b) => a.bike_number - b.bike_number);
  const cancelled = state.data.bookings
    .filter((booking) => booking.class_id === klass.id && booking.status !== "booked")
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const availability = availabilityForClass(klass);

  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <button class="ghost small" onclick="actions.closeBookingClass()">Back to classes</button>
          <h2>${esc(klass.title)}</h2>
          <p class="muted">${niceDate(klass.starts_at)} - Instructor: ${esc(instructorName(klass))}</p>
        </div>
        <div class="booking-class-stats detail">
          <span>${availability.booked}/9 booked</span>
          <span>${availability.full ? "Full" : `${availability.left} left`}</span>
          ${statusPill(klass.status)}
        </div>
      </div>
      ${canManage() ? renderAdminBookMember(klass, availability.full, klass.status === "cancelled") : ""}
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Bike</th><th>Member</th><th>Mobile</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${bookings.map((booking) => {
              const member = memberById(booking.user_id);
              return `
                <tr>
                  <td>Bike ${esc(booking.bike_number)}</td>
                  <td><strong>${esc(member ? fullName(member) : "Unknown")}</strong></td>
                  <td>${esc(member?.mobile || "")}</td>
                  <td>${statusPill(booking.status)}</td>
                  <td><button class="ghost small" onclick="actions.cancelBooking('${booking.id}')">Cancel</button></td>
                </tr>
              `;
            }).join("") || `<tr><td colspan="5">No one booked yet.</td></tr>`}
          </tbody>
        </table>
      </div>
      ${cancelled.length ? `
        <div class="archive-subsection">
          <h3>Cancelled spots</h3>
          <div class="booking-card-list archive-list">
            ${cancelled.map((booking) => {
              const member = memberById(booking.user_id);
              return `
                <article class="booking-card archived">
                  <div>
                    <strong>${esc(member ? fullName(member) : "Unknown")}</strong>
                    <span>Bike ${esc(booking.bike_number)}</span>
                  </div>
                  ${statusPill(booking.status)}
                </article>
              `;
            }).join("")}
          </div>
        </div>
      ` : ""}
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
    const query = state.memberSearch.trim().toLowerCase();
    const searchable = [
      fullName(member),
      member.email,
      member.mobile,
      member.member_number,
      formatMemberNumber(member.member_number),
    ].join(" ").toLowerCase();
    if (query && !searchable.includes(query)) return false;
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
      <form class="member-search" onsubmit="actions.searchMembers(event)">
        <input name="query" value="${esc(state.memberSearch)}" placeholder="Search name, email, mobile, or member number" />
        <button class="secondary">Search</button>
        ${state.memberSearch ? `<button type="button" class="ghost" onclick="actions.clearMemberSearch()">Clear</button>` : ""}
      </form>
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
          <span>${member.role === "member" ? `Member #${esc(formatMemberNumber(member.member_number))} - ` : ""}${esc(member.email)}</span>
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
  const upcoming = visibleClasses().filter((klass) => new Date(klass.starts_at) >= addDays(new Date(), -1)).slice(0, 24);

  return `
    <div class="page-grid classes-layout">
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
  const instructorInput = canManage()
    ? instructorSelect("instructor_id", state.profile.id, false)
    : `<input type="hidden" name="instructor_id" value="${esc(state.profile.id)}" />`;
  return `
    <form class="stack class-planner-form" onsubmit="actions.createSchedule(event)">
      <input name="title" placeholder="Class name" value="Morning Spin" required />
      ${canManage() ? `<label class="field-label">Instructor ${instructorInput}</label>` : instructorInput}
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
  const availability = availabilityForClass(klass);
  return `
    <article class="manage-row">
      <div>
        <strong>${esc(klass.title)}</strong>
        <span>${niceDate(klass.starts_at)} - ${esc(klass.duration_minutes)} min - ${availability.full ? "Full" : `${availability.left} spots left`} - ${esc(instructorName(klass))}</span>
      </div>
      <div class="manage-actions">
        ${statusPill(klass.status)}
        <button class="secondary small" onclick="actions.editClass('${klass.id}')">Edit</button>
        <button class="secondary small" onclick="actions.duplicateClass('${klass.id}')">Duplicate</button>
        ${renderClassScopeControls(klass)}
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
        ${canManage() ? instructorSelect("instructor_id", klass.instructor_id || "", false) : `<input type="hidden" name="instructor_id" value="${esc(klass.instructor_id || state.profile.id)}" />`}
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
  const classes = visibleClasses().filter((klass) => new Date(klass.starts_at) >= addDays(new Date(), -14)).slice(0, 24);

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
      ${state.profile.role === "member" ? `<div class="member-number-banner"><span>Member number</span><strong>#${esc(formatMemberNumber(state.profile.member_number))}</strong></div>` : ""}
      <p class="muted">Keep these contact details up to date so the studio can reach you if needed.</p>
      <form class="stack" onsubmit="actions.saveProfile(event)">
        <div class="profile-grid">
          <label class="field-label">First name
            <input name="first_name" value="${esc(state.profile.first_name)}" placeholder="First name" required />
          </label>
          <label class="field-label">Last name
            <input name="last_name" value="${esc(state.profile.last_name)}" placeholder="Last name" required />
          </label>
          <label class="field-label">Personal mobile number
            <input name="mobile" value="${esc(state.profile.mobile || "")}" placeholder="Mobile number" />
          </label>
          <label class="field-label">Emergency contact number
            <input name="emergency_contact" value="${esc(state.profile.emergency_contact || "")}" placeholder="Emergency contact number" />
          </label>
        </div>
        <button>Save profile</button>
      </form>
    </section>
  `;
}

function indemnityPdfFileName(person, signedAt) {
  const name = prospectiveFullName(person).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "prospective-member";
  return `spinx-indemnity-${name}-${toDateKey(signedAt)}.pdf`;
}

function generateIndemnityPdf(person, klass, indemnityText, signatureData, signedAt, fileName) {
  const JsPdf = window.jspdf?.jsPDF;
  if (!JsPdf) throw new Error("PDF generator did not load. Check the internet connection and try again.");
  const doc = new JsPdf({ unit: "mm", format: "a4" });
  const margin = 18;
  let y = 22;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("SpinX Studio", margin, y);
  y += 10;
  doc.setFontSize(14);
  doc.text("Prospective Member Indemnity", margin, y);
  y += 12;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  const details = [
    `Name: ${prospectiveFullName(person)}`,
    `Phone: ${person?.phone || ""}`,
    `Email: ${person?.email || ""}`,
    `Class: ${klass ? `${klass.title} - ${niceDate(klass.starts_at)}` : "Not linked"}`,
    `Signed: ${new Date(signedAt).toLocaleString("en-ZA")}`,
  ];
  details.forEach((line) => { doc.text(line, margin, y); y += 6; });
  y += 4;
  doc.setFont("helvetica", "bold");
  doc.text("Indemnity", margin, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  const lines = doc.splitTextToSize(indemnityText, 174);
  doc.text(lines, margin, y);
  y += lines.length * 5 + 10;
  doc.setFont("helvetica", "bold");
  doc.text("Signature", margin, y);
  y += 4;
  doc.addImage(signatureData, "PNG", margin, y, 90, 34, undefined, "FAST");
  y += 42;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("Electronically signed and stored by SpinX Studio.", margin, y);
  doc.save(fileName);
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

async function updateClassStatusForEveryone(classIds, status) {
  const rpcResult = await db.rpc("spinx_set_class_status", {
    p_class_ids: classIds,
    p_status: status,
  });
  const missingRpc = rpcResult.error && (
    rpcResult.error.code === "PGRST202"
    || rpcResult.error.code === "42883"
    || rpcResult.error.message?.toLowerCase().includes("could not find the function")
  );
  if (!rpcResult.error || !missingRpc) return rpcResult;

  // Backward-compatible fallback while the review migration has not been applied yet.
  const classResult = await db.from("spinx_classes").update({ status }).in("id", classIds);
  if (classResult.error || status !== "cancelled") return classResult;

  const bookingResult = await db
    .from("spinx_bookings")
    .update({ status: "cancelled" })
    .in("class_id", classIds)
    .eq("status", "booked");
  if (bookingResult.error) return bookingResult;

  return db
    .from("spinx_waitlist")
    .update({ status: "cancelled" })
    .in("class_id", classIds)
    .eq("status", "waiting");
}

function authErrorMessage(error) {
  if (!error) return "";
  if (error.message?.toLowerCase().includes("email not confirmed")) {
    return "This account is not approved/confirmed yet. Ask an admin to approve it in Members.";
  }
  return error.message;
}

window.actions = {
  togglePassword(button) {
    const input = button.closest(".password-field")?.querySelector("input");
    if (!input) return;
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    button.setAttribute("aria-label", show ? "Hide password" : "Show password");
    button.setAttribute("title", show ? "Hide password" : "Show password");
    button.innerHTML = `<i data-lucide="${show ? "eye-off" : "eye"}"></i>`;
    hydrateIcons();
  },
  setAuthMode(mode) {
    state.authMode = mode === "register" ? "register" : "login";
    renderAuth();
  },
  setTab(tab) {
    state.navScrollLeft = document.querySelector(".nav")?.scrollLeft || state.navScrollLeft;
    clearMessages();
    state.tab = tab;
    if (tab !== "bookings") state.selectedBookingClassId = "";
    render();
  },
  rememberNavScroll(event) {
    state.navScrollLeft = event.currentTarget.scrollLeft;
  },
  openMetric(tab, filter) {
    clearMessages();
    state.tab = tab;
    if (tab === "members") state.memberFilter = filter || "all";
    render();
  },
  showMembers(filter) {
    clearMessages();
    state.tab = "members";
    state.memberFilter = filter;
    render();
  },
  openClassDate(dateKey) {
    clearMessages();
    state.selectedDate = dateKey;
    state.calendarMonth = firstOfMonth(fromDateKey(dateKey));
    state.calendarFilters.classId = "all";
    state.tab = "calendar";
    state.selectedBookingClassId = "";
    render();
  },
  openBookingClass(classId) {
    clearMessages();
    state.selectedBookingClassId = classId;
    state.tab = "bookings";
    render();
  },
  closeBookingClass() {
    clearMessages();
    state.selectedBookingClassId = "";
    render();
  },
  selectDate(dateKey) {
    clearMessages();
    state.selectedDate = dateKey;
    const selected = fromDateKey(dateKey);
    state.calendarMonth = firstOfMonth(selected);
    state.calendarFilters.classId = "all";
    render();
  },
  moveMonth(delta) {
    clearMessages();
    state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() + delta, 1);
    render();
  },
  searchMembers(event) {
    event.preventDefault();
    const form = new FormData(event.target);
    state.memberSearch = String(form.get("query") || "").trim();
    render();
  },
  clearMemberSearch() {
    state.memberSearch = "";
    render();
  },
  setCalendarDate(dateKey) {
    if (!dateKey) return;
    clearMessages();
    state.selectedDate = dateKey;
    state.calendarMonth = firstOfMonth(fromDateKey(dateKey));
    state.calendarFilters.classId = "all";
    state.calendarDetailClassId = "";
    state.calendarDetailKey = "";
    render();
  },
  setCalendarFilter(name, value) {
    if (!(name in state.calendarFilters)) return;
    state.calendarFilters[name] = value;
    state.calendarDetailClassId = "";
    state.calendarDetailKey = "";
    render();
  },
  resetCalendarFilters() {
    state.calendarFilters = {
      classId: "all",
      instructorId: "all",
      payment: "all",
      attendance: "all",
      bookingState: "all",
      bikes: "all",
    };
    state.calendarDetailClassId = "";
    state.calendarDetailKey = "";
    render();
  },
  toggleCalendarFilters() {
    state.calendarFiltersExpanded = !state.calendarFiltersExpanded;
    render();
  },
  toggleCalendarDetail(classId, key) {
    if (state.calendarDetailClassId === classId && state.calendarDetailKey === key) {
      state.calendarDetailClassId = "";
      state.calendarDetailKey = "";
    } else {
      state.calendarDetailClassId = classId;
      state.calendarDetailKey = key;
    }
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
  bookBike(classId) {
    run(() => db.rpc("spinx_book_next_bike", { p_class_id: classId }), "Spot booked.");
  },
  cancelBooking(bookingId) {
    run(() => db.rpc("spinx_cancel_booking", { p_booking_id: bookingId }), "Booking cancelled.");
  },
  joinWaitlist(classId) {
    run(() => db.rpc("spinx_join_waitlist", { p_class_id: classId }), "Added to waiting list.");
  },
  adminBookMember(event, classId) {
    event.preventDefault();
    const form = new FormData(event.target);
    const userId = String(form.get("user_id") || "").trim();
    if (!userId) return;
    run(() => db.rpc("spinx_admin_book_member", { p_class_id: classId, p_user_id: userId }), "Member spot booked.");
  },
  openProspectiveBooking(classId) {
    state.prospectiveClassId = classId;
    render();
  },
  clearSignature(classId) {
    const canvas = document.getElementById(`prospective-signature-${classId}`);
    if (!canvas) return;
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);
    canvas.dataset.signed = "false";
  },
  async bookProspective(event, classId) {
    event.preventDefault();
    const form = new FormData(event.target);
    const canvas = document.getElementById(`prospective-signature-${classId}`);
    if (!canvas || canvas.dataset.signed !== "true") {
      setMessage("", "The prospective member must sign the indemnity.");
      return;
    }

    const person = {
      first_name: String(form.get("first_name") || "").trim(),
      last_name: String(form.get("last_name") || "").trim(),
      phone: String(form.get("phone") || "").trim(),
      email: String(form.get("email") || "").trim().toLowerCase(),
    };
    const signedAt = new Date().toISOString();
    const signatureData = canvas.toDataURL("image/png");
    state.error = "";
    state.message = "";

    const result = await db.rpc("spinx_admin_book_prospective", {
      p_class_id: classId,
      p_first_name: person.first_name,
      p_last_name: person.last_name,
      p_phone: person.phone,
      p_email: person.email,
      p_indemnity_text: PROSPECTIVE_INDEMNITY_TEXT,
      p_signature_data_url: signatureData,
      p_signed_at: signedAt,
    });

    if (result.error) {
      state.error = result.error.message;
      render();
      return;
    }

    const created = result.data?.[0];
    const klass = state.data.classes.find((item) => item.id === classId);
    const fileName = indemnityPdfFileName(person, signedAt);
    try {
      generateIndemnityPdf(person, klass, PROSPECTIVE_INDEMNITY_TEXT, signatureData, signedAt, fileName);
      if (created?.indemnity_id) {
        await db.from("spinx_indemnities").update({
          pdf_file_name: fileName,
          pdf_generated_at: new Date().toISOString(),
        }).eq("id", created.indemnity_id);
      }
      state.message = `Prospective member booked on Bike ${created?.bike_number || ""}. Indemnity PDF downloaded.`;
    } catch (pdfError) {
      state.message = "Prospective member booked and signature stored.";
      state.error = pdfError.message;
    }
    state.prospectiveClassId = "";
    await loadData();
    render();
  },
  downloadIndemnity(indemnityId) {
    const record = state.data.indemnities.find((item) => item.id === indemnityId);
    if (!record) return setMessage("", "Indemnity record not found.");
    const person = prospectiveById(record.prospective_member_id);
    const klass = state.data.classes.find((item) => item.id === record.class_id);
    const fileName = record.pdf_file_name || indemnityPdfFileName(person, record.signed_at);
    try {
      generateIndemnityPdf(person, klass, record.indemnity_text, record.signature_data_url, record.signed_at, fileName);
    } catch (error) {
      setMessage("", error.message);
    }
  },
  cancelProspectiveBooking(bookingId) {
    if (!confirm("Cancel this prospective member booking?")) return;
    run(() => db.rpc("spinx_cancel_prospective_booking", { p_booking_id: bookingId }), "Prospective booking cancelled.");
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
    const instructorId = String(form.get("instructor_id") || "").trim() || null;
    const seriesId = repeatMode === "weekly" ? makeUuid() : null;
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
          instructor_id: instructorId,
          series_id: seriesId,
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
      instructor_id: String(form.get("instructor_id") || "").trim() || null,
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
      instructor_id: klass.instructor_id || null,
    }), "Class duplicated for next week.");
  },
  updateClass(id, patch) {
    run(() => db.from("spinx_classes").update(patch).eq("id", id), "Class updated.");
  },
  updateClassScope(id, status, scope) {
    const klass = state.data.classes.find((item) => item.id === id);
    if (!klass) return;
    const ids = scope === "future" ? matchingFutureClassIds(klass) : [id];
    if (!ids.length) return;
    const label = status === "cancelled" ? "cancel" : "reopen";
    const target = scope === "future" ? "this class and future matching classes" : "this class for everyone";
    if (!confirm(`This will ${label} ${target}. Continue?`)) return;
    const success = status === "cancelled"
      ? scope === "future"
        ? `${ids.length} classes and their bookings cancelled.`
        : "Class and all member bookings cancelled."
      : scope === "future"
        ? `${ids.length} classes reopened. Previous bookings remain cancelled.`
        : "Class reopened. Previous bookings remain cancelled.";
    run(() => updateClassStatusForEveryone(ids, status), success);
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
