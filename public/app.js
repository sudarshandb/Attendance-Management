const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const state = {
  user: null,
  classes: [],
  subjects: [],
  users: [],
  assignments: [],
  timetable: [],
  students: [],
  registers: [],
  selectedDay: days[0],
  editingStudent: null,
  attendanceSlot: null,
  attendanceDate: null,
  marks: {},
};
let toastTimer;

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = response.headers.get("content-type")?.includes("application/json")
    ? await response.json()
    : null;
  if (!response.ok) {
    if (response.status === 401 && url !== "/api/auth/login") showLogin();
    if (response.status === 403 && data?.mustChangePassword && state.user) {
      state.user.must_change_password = true;
      showApp(state.user);
      renderAll();
    }
    throw new Error(data?.error || "Request failed.");
  }
  return data;
}
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
function say(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
}
function showLogin() {
  $("#loginView").classList.remove("hidden");
  $("#appView").classList.add("hidden");
}
function showApp(user) {
  state.user = user;
  $("#loginView").classList.add("hidden");
  $("#appView").classList.remove("hidden");
  $("#userLabel").textContent = user.name || user.email;
  $("#userRoleLabel").textContent = user.role === "admin" ? "Administrator" : "Teacher / staff";
  $("#userAvatar").textContent = (user.name || user.email)[0].toUpperCase();
  $$(".admin-only").forEach((e) => e.classList.toggle("hidden", user.role !== "admin"));
  $("#dashboardMarkButton").textContent = user.role === "admin" ? "View attendance" : user.must_change_password ? "Browse my classes" : "＋ Mark attendance";
$("#temporaryPasswordNotice").classList.toggle("hidden", !user.must_change_password);
  $("#addStudentButton").classList.toggle("hidden", !!user.must_change_password);
  $("#openAttendanceButton").textContent = user.must_change_password ? "View register" : "Mark attendance →";
  $$("#appView form button[type=submit]").forEach((button) => { if (!button.closest("#passwordForm")) button.disabled = !!user.must_change_password; });
  $("#roleHelpTitle").textContent = user.role === "admin" ? "Administrator" : "Teacher workspace";
  $("#roleHelpText").textContent =
    user.role === "admin" ? "You manage the school portal." : "Your classes and registers are here.";
  $("#timetableNavLabel").textContent = user.role === "admin" ? "Timetable" : "My classes";
  if (user.must_change_password) {
    $("#passwordHint").textContent = "You can view your classes and student details now. Change your temporary password before making changes.";
    $("#currentPassword").required = false;
    $("#currentPasswordField").classList.add("hidden");
  } else {
    $("#passwordHint").textContent = "Choose a password with at least 10 characters.";
    $("#currentPassword").required = true;
    $("#currentPasswordField").classList.remove("hidden");
  }
}
function setSelect(selector, first, options, label) {
  const select = $(selector),
    previous = select.value;
  select.innerHTML =
    `<option value="">${first}</option>` +
    options.map((o) => `<option value="${esc(o.id)}">${esc(label(o))}</option>`).join("");
  if (options.some((o) => o.id === previous)) select.value = previous;
}
function semLabel(n) {
  return `Semester ${n}`;
}
function classLabel(c) {
  return `${c.name} · ${semLabel(c.semester)}`;
}
function assignmentLabel(a) {
  return `${a.class_name} · ${a.subject} · ${a.staff} · ${a.semester ? semLabel(a.semester) : ""}`;
}
function updateSemesterSelects() {
  const opts = Array.from(
    { length: 8 },
    (_, i) => `<option value="${i + 1}">${semLabel(i + 1)}</option>`,
  ).join("");
  ["#classSemester", "#subjectSemester"].forEach((s) => {
    $(s).innerHTML = opts;
  });
}
async function loadData() {
  const requests = [
    api("/api/dashboard"),
    api("/api/classes"),
    api("/api/subjects"),
    api("/api/assignments"),
    api("/api/timetable"),
    api("/api/students"),
    api("/api/attendance"),
  ];
  if (state.user.role === "admin") requests.push(api("/api/users"));
  const result = await Promise.all(requests);
  const [dashboard, classes, subjects, assignments, timetable, students, attendance] = result;
  state.dashboard = dashboard;
  state.classes = classes.classes;
  state.subjects = subjects.subjects;
  state.assignments = assignments.assignments;
  state.timetable = timetable.timetable;
  state.students = students.students;
  state.registers = attendance.registers;
  state.users = state.user.role === "admin" ? result[7].users : [];
  updateSemesterSelects();
  renderAll();
}
function renderAll() {
  populateSelects();
  renderDashboard();
  renderStudents();
  renderTeaching();
  renderTimetable();
  renderAttendance();
  renderStaff();
  renderTeacherAssignments();
}
function populateSelects() {
  setSelect("#studentClass", "Choose class", state.classes, classLabel);
  setSelect("#studentClassFilter", "All accessible classes", state.classes, classLabel);
  setSelect(
    "#assignmentTeacher",
    "Choose teacher",
    state.users.filter((u) => u.role === "staff"),
    (u) => `${u.name} · ${u.email}`,
  );
  setSelect("#assignmentClass", "Choose class", state.classes, classLabel);
  setSelect("#teacherAssignTeacher", "Choose teacher", state.users.filter((u) => u.role === "staff"), (u) => `${u.name} · ${u.email}`);
  setSelect("#teacherAssignClass", "Choose class", state.classes, classLabel);
  setSelect("#teacherAssignSubject", "Choose subject", state.subjects, (subject) => `${subject.code} · ${subject.name} · ${semLabel(subject.semester)}`);
  setSelect(
    "#assignmentSubject",
    "Choose subject",
    state.subjects,
    (s) => `${s.code} · ${s.name} · ${semLabel(s.semester)}`,
  );
  setSelect("#timetableAssignment", "Choose class / subject / teacher", state.assignments, assignmentLabel);
  const attendanceOptions = state.timetable.map((s) => ({
    ...s,
    id: s.slot_id,
    label: `${s.day} · ${s.start_time}–${s.end_time} · ${s.class_name} · ${s.subject}`,
  }));
  setSelect("#attendanceSlotPicker", "Choose a scheduled class", attendanceOptions, (s) => s.label);
}
function card(label, value, note, icon) {
  return `<article class="stat-card"><div class="stat-top"><span>${label}</span><span class="stat-icon green">${icon}</span></div><div class="stat-value">${value}</div><div class="stat-note">${note}</div></article>`;
}
function renderDashboard() {
  const d = state.dashboard || {};
  $("#welcomeTitle").textContent =
    state.user.role === "admin" ? "Your school, at a glance." : `Welcome, ${state.user.name.split(" ")[0]}.`;
  $("#welcomeSubtitle").textContent =
    state.user.role === "admin"
      ? "A shared view of classes, attendance, and today's schedule."
      : "Here are your classes and today's teaching schedule.";
  $("#scheduleSubheading").textContent =
    state.user.role === "admin"
      ? "The school's classes scheduled for today."
      : "Your assigned classes for today.";
  $("#dashboardStats").innerHTML =
    state.user.role === "admin"
      ? card("STUDENTS", d.students || 0, "Active student records", "♙") +
        card("STAFF", d.staff || 0, "Teachers and staff", "♧") +
        card("CLASSES", d.classes || 0, "Across 8 semesters", "▦") +
        card("SUBJECTS", d.subjects || 0, `${d.registers || 0} attendance registers`, "▤")
      : card("MY STUDENTS", d.students || 0, "Across your assigned classes", "♙") +
        card("MY CLASSES", d.classes || 0, "Subject and class assignments", "▦") +
        card("TODAY'S CLASSES", d.todaySlots || 0, "Scheduled Monday to Friday", "◷");
  const today = new Date().toLocaleDateString("en-US", { weekday: "long" });
  const todayList = state.timetable.filter((s) => s.day === today);
  $("#todaySchedule").innerHTML = todayList.length
    ? todayList.map(scheduleCard).join("")
    : '<div class="empty-inline">No classes are scheduled for today.</div>';
  $("#recentAttendance").innerHTML =
    state.registers
      .slice(0, 5)
      .map(
        (r) =>
          `<div class="recent-row"><div class="date-icon">▤</div><div class="recent-meta"><strong>${dateLabel(r.date)} · ${esc(r.class_name)}</strong><small>${esc(r.subject)} · ${esc(r.start_time)}–${esc(r.end_time)}</small></div><span class="recent-count">${r.present}/${r.recorded} present</span></div>`,
      )
      .join("") || '<div class="empty-inline">No attendance recorded yet.</div>';
}
function scheduleCard(s) {
  const markAction = state.user.role === "staff" && !state.user.must_change_password
    ? `<button class="button button-light" data-mark-slot="${s.slot_id}">Mark attendance</button>`
    : "";
  return `<article class="schedule-card"><div class="schedule-time">${esc(s.start_time)}<span>${esc(s.end_time)}</span></div><div class="schedule-detail"><strong>${esc(s.subject)} <span>${esc(s.subject_code)}</span></strong><small>${esc(s.class_name)} · ${semLabel(s.semester)}${state.user.role === "admin" ? ` · ${esc(s.staff)}` : ""}</small></div>${markAction}</article>`;
}
function dateLabel(date) {
  return new Date(date + "T12:00:00").toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
function progress(s) {
  const low = s.percentage < 75;
  return `<td>${s.classes_attended} / ${s.classes_taken}</td><td><div class="progress-cell"><div class="progress-track"><div class="progress-fill ${low ? "low" : ""}" style="width:${Math.min(100, s.percentage)}%"></div></div><strong>${s.percentage}%</strong></div></td><td><span class="badge ${low ? "low" : "good"}">${low ? "Below 75%" : "On track"}</span></td>`;
}
function renderStudents() {
  const query = $("#studentSearch").value.trim().toLowerCase(),
    classId = $("#studentClassFilter").value;
  const list = state.students.filter(
    (s) => (!classId || s.class_id === classId) && `${s.name} ${s.usn}`.toLowerCase().includes(query),
  );
  $("#studentRows").innerHTML = list
    .map(
      (s) =>
        `<tr><td><strong>${esc(s.name)}</strong><small class="table-subline">${esc(s.usn)}</small></td><td>${semLabel(s.semester)}</td><td>${esc(s.class_name)}</td>${progress(s)}<td class="row-actions">${state.user.must_change_password ? "" : `<button data-student-edit="${s.id}" class="table-action">Edit</button><button data-student-delete="${s.id}" class="table-action danger">Delete</button>`}</td></tr>`,
    )
    .join("");
  $("#emptyStudents").classList.toggle("hidden", list.length > 0);
}
function renderTeaching() {
  $("#classList").innerHTML =
    state.classes
      .map(
        (c) =>
          `<div class="management-row"><span><strong>${esc(c.name)}</strong><small>${semLabel(c.semester)}</small></span><button class="icon-action danger" data-class-delete="${c.id}" aria-label="Archive class">×</button></div>`,
      )
      .join("") || '<div class="empty-inline">No classes yet.</div>';
  $("#subjectList").innerHTML =
    state.subjects
      .map(
        (s) =>
          `<div class="management-row"><span><strong>${esc(s.code)} · ${esc(s.name)}</strong><small>${semLabel(s.semester)}</small></span><button class="icon-action danger" data-subject-delete="${s.id}" aria-label="Archive subject">×</button></div>`,
      )
      .join("") || '<div class="empty-inline">No subjects yet.</div>';
  $("#assignmentList").innerHTML =
    state.assignments
      .map(
        (a) =>
          `<div class="management-row"><span><strong>${esc(a.class_name)} · ${esc(a.subject)}</strong><small>${esc(a.staff)} · ${semLabel(a.semester)}</small></span><button class="icon-action danger" data-assignment-delete="${a.id}" aria-label="Remove assignment">×</button></div>`,
      )
      .join("") || '<div class="empty-inline">No teacher assignments yet.</div>';
}
function renderTimetable() {
  $("#weekdayTabs").innerHTML = days
    .map(
      (day) =>
        `<button class="weekday-tab ${state.selectedDay === day ? "active" : ""}" data-day="${day}">${day}</button>`,
    )
    .join("");
  const list = state.timetable
    .filter((s) => s.day === state.selectedDay)
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
  $("#timetableList").innerHTML = list.length
    ? list
        .map(
          (s) =>
            `<div class="timetable-row"><div class="schedule-time">${esc(s.start_time)}<span>${esc(s.end_time)}</span></div><div class="schedule-detail"><strong>${esc(s.subject)} <span>${esc(s.subject_code)}</span></strong><small>${esc(s.class_name)} · ${semLabel(s.semester)}${state.user.role === "admin" ? ` · ${esc(s.staff)}` : " · My class"}</small></div><div class="timetable-actions">${`${state.user.role === "staff" && !state.user.must_change_password ? `<button class="button button-light" data-mark-slot="${s.slot_id}">Mark attendance</button>` : ""}${state.user.role === "admin" ? `<button class="icon-action danger" data-timetable-delete="${s.slot_id}" aria-label="Remove timetable entry">×</button>` : ""}`}</div></div>`,
        )
        .join("")
    : '<div class="empty-state"><div class="empty-icon">▤</div><strong>No classes scheduled</strong><span>There are no classes on this weekday.</span></div>';
}
function renderAttendance() {
  $("#attendanceClassPicker").classList.toggle("hidden", state.user.role === "admin");
  $("#attendanceDescription").textContent =
    state.user.role === "admin"
      ? "View attendance registers and student marks across the school."
      : state.user.must_change_password
        ? "View your class registers now. Change your temporary password to record or edit attendance."
        : "Choose one of your scheduled classes to mark attendance.";
  $("#registerList").innerHTML = state.registers
    .map(
      (r) =>
        `<div class="register-row"><div class="register-date-icon">▤</div><div class="register-info"><strong>${dateLabel(r.date)} · ${esc(r.class_name)}</strong><small>${esc(r.subject)} · ${esc(r.start_time)}–${esc(r.end_time)} · ${esc(r.staff_name)}</small></div><span class="register-numbers">${r.present}/${r.recorded} present</span><button class="button button-light" data-review-register="${r.date}" data-slot="${r.slot_id}">${state.user.role === "admin" ? "View details" : "Review"}</button></div>`,
    )
    .join("");
  $("#emptyRegisters").classList.toggle("hidden", state.registers.length > 0);
}
function renderStaff() {
  if (state.user.role !== "admin") return;
  const query = $("#teacherSearch").value.trim().toLowerCase();
  const teachers = state.users.filter(
    (u) => u.role === "staff" && `${u.name} ${u.email}`.toLowerCase().includes(query),
  );
  $("#teacherList").innerHTML =
    teachers
      .map((u) => {
        const assigned = state.assignments.filter((a) => a.staff_id === u.id);
        const detail = assigned.length
          ? assigned.map((a) => `${esc(a.class_name)} · ${esc(a.subject)}`).join(", ")
          : "No classes assigned yet";
        return `<div class="teacher-entry"><div class="teacher-avatar">${esc((u.name || u.email)[0].toUpperCase())}</div><div class="teacher-identity"><strong>${esc(u.name)}</strong><small>${esc(u.email)} · ${assigned.length} assignment${assigned.length === 1 ? "" : "s"}</small>${u.must_change_password ? '<span class="badge low">Password change required</span>' : ""}<small class="teacher-classes">${detail}</small></div><div class="teacher-actions"><button class="button button-light" data-reset-staff-password="${u.id}">Reset password</button><button class="button button-light" data-assign-teacher="${u.id}">Assign class</button><button class="button button-light danger-button" data-staff-delete="${u.id}">Remove</button></div></div>`;
      })
      .join("") || '<div class="empty-inline">No matching teachers or staff.</div>';
}

function renderTeacherAssignments() {
  if (state.user.role !== "admin") return;
  $("#teacherAssignmentList").innerHTML = state.assignments.map((assignment) => `<div class="management-row"><span><strong>${esc(assignment.staff)} · ${esc(assignment.class_name)} · ${esc(assignment.subject)}</strong><small>${esc(assignment.email)} · ${semLabel(assignment.semester)}${assignment.slots.length ? ` · ${assignment.slots.length} scheduled period${assignment.slots.length === 1 ? "" : "s"}` : " · Not yet on the timetable"}</small></span><button class="button button-light danger-button" data-teacher-assignment-delete="${assignment.id}">Remove</button></div>`).join("") || '<div class="empty-inline">No teaching assignments yet.</div>';
}
function switchView(view) {
  $$(".page-section").forEach((section) => section.classList.add("hidden"));
  $(`#${view}Page`).classList.remove("hidden");
  $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  $("#pageTitle").textContent = {
    dashboard: "Overview",
    students: "Students",
    teachers: "Teachers",
    teaching: "Classes & subjects",
    timetable: state.user.role === "admin" ? "Timetable" : "My classes",
    attendance: "Attendance",
    account: "Account",
  }[view];
}
function todayDate() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function nextDateForDay(day) {
  const today = new Date();
  const diff = (days.indexOf(day) - ((today.getDay() + 6) % 7) + 7) % 7;
  const target = new Date(today);
  target.setDate(today.getDate() + diff);
  return new Date(target.getTime() - target.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function openRegisterDetails(register) {
  state.attendanceRoster = register.records.map((record) => ({
    id: String(record.student_id),
    name: record.name,
    usn: record.usn,
  }));
  state.marks = Object.fromEntries(register.records.map((record) => [String(record.student_id), !!record.present]));
  state.hasExistingRegister = true;
  state.attendanceDate = register.date;
  $("#attendanceError").textContent = "";
  $("#attendanceModalTitle").textContent = "Attendance details · " + register.class_name;
  $("#attendanceInfo").textContent = register.subject + " · " + dateLabel(register.date) + " · " + register.start_time + "–" + register.end_time + " · " + register.staff_name;
  $(".mark-toolbar").classList.add("hidden");
  $("#attendanceForm [type=submit]").classList.add("hidden");
  $("#attendanceForm [data-close]").textContent = "Close";
  $("#absenceWarning").classList.add("hidden");
  renderRoster();
  $("#attendanceModal").classList.remove("hidden");
}async function openAttendance(slotId, date = null) {
  const slot = state.timetable.find((s) => s.slot_id === slotId);
  if (!slot) return say("That class is no longer scheduled.");
  state.attendanceSlot = slot;
  state.attendanceDate = date || nextDateForDay(slot.day);
  state.marks = {};
  state.hasExistingRegister = false;
  $("#attendanceError").textContent = "";
  const readOnly = state.user.role === "admin" || state.user.must_change_password;
  $("#attendanceModalTitle").textContent = `${state.user.role === "admin" ? "Attendance details" : "Attendance"} · ${slot.class_name}`;
  $(".mark-toolbar").classList.toggle("hidden", readOnly);
  $("#attendanceForm [type=submit]").classList.toggle("hidden", readOnly);
  $("#attendanceForm [data-close]").textContent = readOnly ? "Close" : "Cancel";
  $("#attendanceInfo").textContent =
    `${slot.subject} · ${semLabel(slot.semester)} · ${dateLabel(state.attendanceDate)} · ${slot.start_time}–${slot.end_time}`;
  $("#attendanceRoster").innerHTML = '<div class="empty-inline">Loading class roster…</div>';
  $("#absenceWarning").classList.add("hidden");
  $("#attendanceModal").classList.remove("hidden");
  try {
    const [rosterData, previous] = await Promise.all([
      api(`/api/students?class_id=${encodeURIComponent(slot.class_id)}`),
      api(
        `/api/attendance?date=${encodeURIComponent(state.attendanceDate)}&slot_id=${encodeURIComponent(slot.slot_id)}`,
      ),
    ]);
    state.hasExistingRegister = !!previous.register;
    state.marks = Object.fromEntries(
      rosterData.students.map((s) => [
        s.id,
        previous.register ? !!previous.register.records.find((r) => String(r.student_id) === s.id)?.present : true,
      ]),
    );
    state.attendanceRoster = rosterData.students;
    renderRoster();
  } catch (error) {
    $("#attendanceError").textContent = error.message;
  }
}
function renderRoster() {
  const list = state.attendanceRoster || [],
    absent = list.filter((s) => !state.marks[s.id]),
    readOnly = state.user.role === "admin" || state.user.must_change_password;
  $("#markCount").textContent = `${list.length} students · ${absent.length} absent`;
  $("#absenceWarning").classList.toggle("hidden", readOnly || absent.length === 0);
  $("#absenceWarning").textContent = absent.length
    ? `${absent.length} marked absent: ${absent.slice(0, 6).map((s) => s.name).join(", ")}${absent.length > 6 ? " and others" : ""}. Please check before saving.`
    : "";
  $("#attendanceRoster").innerHTML = list.length
    ? list.map((s) => `<div class="attendance-row ${state.marks[s.id] ? "" : "absent-row"}"><div class="attendance-person"><strong>${esc(s.name)}</strong><small>${esc(s.usn)}</small></div>${readOnly ? `<span class="badge ${state.hasExistingRegister ? (state.marks[s.id] ? "good" : "low") : ""}">${state.hasExistingRegister ? (state.marks[s.id] ? "Present" : "Absent") : "Not recorded"}</span>` : `<div class="attendance-toggle"><button type="button" class="${state.marks[s.id] ? "selected present" : ""}" data-mark="${s.id}" data-value="1">Present</button><button type="button" class="${state.marks[s.id] ? "" : "selected absent"}" data-mark="${s.id}" data-value="0">Absent</button></div>`}</div>`).join("")
    : '<div class="empty-inline">No students are assigned to this class yet.</div>';
}
async function refresh() {
  await loadData();
}
async function init() {
  try {
    const { user } = await api("/api/auth/me");
    if (user) {
      showApp(user);
      updateSemesterSelects();
      await loadData();
      switchView("dashboard");
    } else showLogin();
  } catch {
    showLogin();
  }
}

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#loginError").textContent = "";
  try {
    const data = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: $("#email").value, password: $("#password").value }),
    });
    showApp(data.user);
    await loadData();
    switchView("dashboard");
  } catch (error) {
    $("#loginError").textContent = error.message;
  }
});
$("#togglePassword").onclick = () => {
  const p = $("#password"),
    visible = p.type === "password";
  p.type = visible ? "text" : "password";
  $("#togglePassword").textContent = visible ? "Hide" : "Show";
};
$("#logoutButton").onclick = async () => {
  await api("/api/auth/logout", { method: "POST" });
  showLogin();
};
$$(".nav-item").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
$$("[data-go]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.go)));
$("#studentSearch").oninput = renderStudents;
$("#studentClassFilter").onchange = renderStudents;
$("#dashboardMarkButton").onclick = () => switchView(state.user.role === "admin" ? "attendance" : "timetable");
$("#exportButton").onclick = async () => {
  try {
    const r = await fetch("/api/attendance/export.csv", { credentials: "same-origin" });
    if (!r.ok) throw new Error("Could not export attendance.");
    const u = URL.createObjectURL(await r.blob()),
      a = document.createElement("a");
    a.href = u;
    a.download = "school-attendance.csv";
    a.click();
    URL.revokeObjectURL(u);
  } catch (e) {
    say(e.message);
  }
};
$$("[data-close]").forEach((b) => (b.onclick = () => $("#" + b.dataset.close).classList.add("hidden")));
$$(".modal-backdrop").forEach((b) =>
  b.addEventListener("click", (e) => {
    if (e.target === b) b.classList.add("hidden");
  }),
);

$("#classForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("/api/classes", {
      method: "POST",
      body: JSON.stringify({ name: $("#className").value, semester: Number($("#classSemester").value) }),
    });
    e.target.reset();
    await refresh();
    say("Class added.");
  } catch (x) {
    say(x.message);
  }
});
$("#subjectForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("/api/subjects", {
      method: "POST",
      body: JSON.stringify({
        name: $("#subjectName").value,
        code: $("#subjectCode").value,
        semester: Number($("#subjectSemester").value),
      }),
    });
    e.target.reset();
    await refresh();
    say("Subject added.");
  } catch (x) {
    say(x.message);
  }
});
$("#assignmentForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("/api/assignments", {
      method: "POST",
      body: JSON.stringify({
        staff_id: $("#assignmentTeacher").value,
        class_id: $("#assignmentClass").value,
        subject_id: $("#assignmentSubject").value,
      }),
    });
    e.target.reset();
    await refresh();
    say("Teacher assigned.");
  } catch (x) {
    say(x.message);
  }
});
$("#timetableForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("/api/timetable", {
      method: "POST",
      body: JSON.stringify({
        assignment_id: $("#timetableAssignment").value,
        day: $("#timetableDay").value,
        start_time: $("#timetableStart").value,
        end_time: $("#timetableEnd").value,
      }),
    });
    e.target.reset();
    await refresh();
    say("Timetable entry added.");
  } catch (x) {
    say(x.message);
  }
});
$("#teacherForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#teacherError").textContent = "";
  try {
    await api("/api/users", {
      method: "POST",
      body: JSON.stringify({
        name: $("#teacherName").value,
        email: $("#teacherEmail").value,
        temporaryPassword: $("#teacherPassword").value,
      }),
    });
    e.target.reset();
    await refresh();
    say("Staff account created. They must change the temporary password on first sign-in.");
  } catch (x) {
    $("#teacherError").textContent = x.message;
  }
});
$("#resetPasswordForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#resetPasswordError").textContent = "";
  if ($("#resetNewPassword").value !== $("#resetConfirmPassword").value) {
    $("#resetPasswordError").textContent = "The temporary passwords do not match.";
    return;
  }
  try {
    await api("/api/users/" + encodeURIComponent($("#resetPasswordStaffId").value) + "/reset-password", {
      method: "POST",
      body: JSON.stringify({ temporaryPassword: $("#resetNewPassword").value }),
    });
    $("#resetPasswordModal").classList.add("hidden");
    e.target.reset();
    await refresh();
    say("Temporary password set. The staff member must change it at next sign-in.");
  } catch (error) {
    $("#resetPasswordError").textContent = error.message;
  }
});
$("#teacherSearch").oninput = renderStaff;
$("#teacherAssignmentForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("/api/assignments", { method: "POST", body: JSON.stringify({ staff_id: $("#teacherAssignTeacher").value, class_id: $("#teacherAssignClass").value, subject_id: $("#teacherAssignSubject").value }) });
    e.target.reset();
    await refresh();
    say("Teacher assigned to the class and subject.");
  } catch (error) { say(error.message); }
});
$("#teacherAssignmentList").addEventListener("click", async (e) => {
  const button = e.target.closest("[data-teacher-assignment-delete]");
  if (button && confirm("Remove this teacher assignment and its timetable entries?")) {
    try { await api(`/api/assignments/${button.dataset.teacherAssignmentDelete}`, { method: "DELETE" }); await refresh(); say("Teacher assignment removed."); }
    catch (error) { say(error.message); }
  }
});
$("#manageTeachersButton").onclick = () => switchView("teachers");
$("#teacherList").addEventListener("click", async (e) => {
  const reset = e.target.closest("[data-reset-staff-password]");
  if (reset) {
    const teacher = state.users.find((u) => u.id === reset.dataset.resetStaffPassword);
    if (!teacher) return;
    $("#resetPasswordForm").reset();
    $("#resetPasswordStaffId").value = teacher.id;
    $("#resetPasswordTeacher").textContent = teacher.name + " · " + teacher.email;
    $("#resetPasswordError").textContent = "";
    $("#resetPasswordModal").classList.remove("hidden");
    $("#resetNewPassword").focus();
    return;
  }  const assign = e.target.closest("[data-assign-teacher]");
  const remove = e.target.closest("[data-staff-delete]");
  if (assign) {
    switchView("teachers");
    $("#teacherAssignTeacher").value = assign.dataset.assignTeacher;
    $("#teacherAssignmentForm").scrollIntoView({ behavior: "smooth", block: "center" });
    $("#teacherAssignClass").focus();
  }
  if (
    remove &&
    confirm("Deactivate this staff account and remove its active assignments? Saved attendance is retained.")
  ) {
    try {
      await api(`/api/users/${remove.dataset.staffDelete}`, { method: "DELETE" });
      await refresh();
      say("Staff account deactivated.");
    } catch (x) {
      say(x.message);
    }
  }
});

$("#passwordForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#passwordError").textContent = "";
  if ($("#newPassword").value !== $("#confirmPassword").value) {
    $("#passwordError").textContent = "The new passwords do not match.";
    return;
  }
  try {
    await api("/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify({
        currentPassword: $("#currentPassword").value,
        newPassword: $("#newPassword").value,
      }),
    });
    state.user.must_change_password = false;
    showApp(state.user);
    e.target.reset();
    $("#currentPasswordField").classList.remove("hidden");
    $("#currentPassword").required = true;
    $("#passwordHint").textContent = "Choose a password with at least 10 characters.";
    say("Password changed.");
    await loadData();
    switchView("dashboard");
  } catch (x) {
    $("#passwordError").textContent = x.message;
  }
});

$("#studentRows").addEventListener("click", async (e) => {
  const edit = e.target.closest("[data-student-edit]"),
    del = e.target.closest("[data-student-delete]");
  if (edit) {
    const s = state.students.find((x) => x.id === edit.dataset.studentEdit);
    state.editingStudent = s;
    $("#studentModalTitle").textContent = "Edit student";
    $("#studentSubmit").textContent = "Save changes";
    $("#studentName").value = s.name;
    $("#studentUsn").value = s.usn;
    $("#studentClass").value = s.class_id;
    $("#studentModal").classList.remove("hidden");
  }
  if (del && confirm("Remove this student from the active roster? Past attendance is retained.")) {
    try {
      await api(`/api/students/${del.dataset.studentDelete}`, { method: "DELETE" });
      await refresh();
      say("Student removed.");
    } catch (x) {
      say(x.message);
    }
  }
});
$("#addStudentButton").onclick = () => {
  state.editingStudent = null;
  $("#studentForm").reset();
  $("#studentModalTitle").textContent = "Add student";
  $("#studentSubmit").textContent = "Save student";
  $("#studentError").textContent = "";
  $("#studentModal").classList.remove("hidden");
};
$("#studentForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = JSON.stringify({
    name: $("#studentName").value,
    usn: $("#studentUsn").value,
    class_id: $("#studentClass").value,
  });
  try {
    const s = state.editingStudent;
    await api(s ? `/api/students/${s.id}` : "/api/students", { method: s ? "PUT" : "POST", body });
    state.editingStudent = null;
    $("#studentModal").classList.add("hidden");
    await refresh();
    say("Student saved.");
  } catch (x) {
    $("#studentError").textContent = x.message;
  }
});

$("#classList").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-class-delete]");
  if (b && confirm("Archive this class? It must have no active teacher assignments.")) {
    try {
      await api(`/api/classes/${b.dataset.classDelete}`, { method: "DELETE" });
      await refresh();
      say("Class archived.");
    } catch (x) {
      say(x.message);
    }
  }
});
$("#subjectList").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-subject-delete]");
  if (b && confirm("Archive this subject? It must have no active assignments.")) {
    try {
      await api(`/api/subjects/${b.dataset.subjectDelete}`, { method: "DELETE" });
      await refresh();
      say("Subject archived.");
    } catch (x) {
      say(x.message);
    }
  }
});
$("#assignmentList").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-assignment-delete]");
  if (b && confirm("Remove this teacher assignment and its timetable entries?")) {
    try {
      await api(`/api/assignments/${b.dataset.assignmentDelete}`, { method: "DELETE" });
      await refresh();
      say("Assignment removed.");
    } catch (x) {
      say(x.message);
    }
  }
});
$("#timetableList").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-timetable-delete]");
  if (b && confirm("Remove this timetable entry?")) {
    try {
      await api(`/api/timetable/${b.dataset.timetableDelete}`, { method: "DELETE" });
      await refresh();
      say("Timetable entry removed.");
    } catch (x) {
      say(x.message);
    }
  }
});
$("#weekdayTabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-day]");
  if (b) {
    state.selectedDay = b.dataset.day;
    renderTimetable();
  }
});
$("#timetableList").addEventListener("click", (e) => {
  const b = e.target.closest("[data-mark-slot]");
  if (b) openAttendance(b.dataset.markSlot);
});
$("#todaySchedule").addEventListener("click", (e) => {
  const b = e.target.closest("[data-mark-slot]");
  if (b) openAttendance(b.dataset.markSlot);
});
$("#attendanceSlotPicker").onchange = () => {
  const s = state.timetable.find((x) => x.slot_id === $("#attendanceSlotPicker").value);
  if (s) $("#attendanceDatePicker").value = nextDateForDay(s.day);
};
$("#openAttendanceButton").onclick = () => {
  if (!$("#attendanceSlotPicker").value) return say("Choose a scheduled class first.");
  openAttendance($("#attendanceSlotPicker").value, $("#attendanceDatePicker").value);
};
$("#attendanceClassPicker").addEventListener("change", (e) => {
  if (e.target.id === "attendanceSlotPicker") {
    const s = state.timetable.find((x) => x.slot_id === e.target.value);
    if (s) $("#attendanceDatePicker").value = nextDateForDay(s.day);
  }
});
$("#attendanceRoster").addEventListener("click", (e) => {
  const b = e.target.closest("[data-mark]");
  if (b) {
    state.marks[b.dataset.mark] = b.dataset.value === "1";
    renderRoster();
  }
});
$("#markAllPresent").onclick = () => {
  for (const id of Object.keys(state.marks)) state.marks[id] = true;
  renderRoster();
};
$("#markAllAbsent").onclick = () => {
  for (const id of Object.keys(state.marks)) state.marks[id] = false;
  renderRoster();
};
$("#attendanceForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const records = (state.attendanceRoster || []).map((s) => ({
      student_id: s.id,
      present: !!state.marks[s.id],
    })),
    absent = records.filter((x) => !x.present).length;

  try {
    const previous = await api(
      `/api/attendance?date=${state.attendanceDate}&slot_id=${state.attendanceSlot.slot_id}`,
    );
    await api(
      previous.register
        ? `/api/attendance/${state.attendanceDate}/${state.attendanceSlot.slot_id}`
        : "/api/attendance",
      {
        method: previous.register ? "PUT" : "POST",
        body: JSON.stringify({ date: state.attendanceDate, slot_id: state.attendanceSlot.slot_id, records }),
      },
    );
    $("#attendanceModal").classList.add("hidden");
    await refresh();
    say(previous.register ? "Attendance register updated." : "Attendance saved.");
  } catch (x) {
    $("#attendanceError").textContent = x.message;
  }
});
$("#registerList").addEventListener("click", (e) => {
  const b = e.target.closest("[data-review-register]");
  if (!b) return;
  const register = state.registers.find((item) => item.date === b.dataset.reviewRegister && item.slot_id === b.dataset.slot);
  if (state.user.role === "admin" && register) openRegisterDetails(register);
  else openAttendance(b.dataset.slot, b.dataset.reviewRegister);
});
init();
