const path = require("path");
const express = require("express");
const session = require("express-session");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const { MongoClient, ObjectId } = require("mongodb");
const app = express();
const PORT = Number(process.env.PORT || 3004);
if (process.env.NODE_ENV === "production" && (!process.env.SESSION_SECRET || !process.env.ADMIN_PASSWORD)) {
  throw new Error("Set SESSION_SECRET and ADMIN_PASSWORD before running in production.");
}
const DB_NAME = process.env.MONGODB_DB || "Attendance_School_Portal";
const URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
let users, students, classes, subjects, assignments, timetable, attendance;
app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));
app.use(
  session({
    name: "school-portal-teachers.sid",
    secret: process.env.SESSION_SECRET || "change-this-local-secret-before-deployment",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      maxAge: 8 * 60 * 60 * 1000,
    },
  }),
);
app.use("/api", (req, res, next) =>
  req.session.user?.must_change_password &&
  req.method !== "GET" &&
  !["/auth/change-password", "/auth/logout"].includes(req.path)
    ? res.status(403).json({ error: "Change your temporary password before making changes.", mustChangePassword: true })
    : next(),
);
const route = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const auth = (req, res, next) => {
  if (!req.session.user) return res.status(401).json({ error: "Please sign in." });
  users
    .findOne({ _id: id(req.session.user.id), active: true })
    .then((found) => {
      if (!found)
        return res
          .status(401)
          .json({ error: "This account is inactive. Please contact your administrator." });
      req.session.user.role = found.role;
      req.session.user.name = found.name;
      req.session.user.email = found.email;
      req.session.user.must_change_password = !!found.must_change_password;
      if (
        found.must_change_password &&
        req.method !== "GET" &&
        !req.path.endsWith("/auth/change-password") &&
        !req.path.endsWith("/auth/logout")
      )
        return res.status(403).json({ error: "Change your temporary password before making changes.", mustChangePassword: true });
      next();
    })
    .catch(next);
};
const admin = (req, res, next) =>
  req.session.user?.role === "admin"
    ? next()
    : res.status(403).json({ error: "Administrator access required." });
const id = (v) => (ObjectId.isValid(String(v)) ? new ObjectId(String(v)) : null);
const user = (req) => req.session.user;
const clean = (v, n = 100) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const schoolEmail = (email) => /^[^\s@]+@school\.edu\.in$/i.test(email);
const validDate = (d) =>
  typeof d === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(d) &&
  Number.isFinite(Date.parse(d + "T00:00:00Z")) &&
  new Date(d + "T00:00:00Z").toISOString().slice(0, 10) === d;
const dayFor = (d) => DAYS[new Date(d + "T00:00:00Z").getUTCDay() - 1] || null;
const minutes = (t) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
const dto = (d) => d && { ...d, id: d._id.toString(), _id: undefined };
async function assignedClass(staffId, classId) {
  return !!(await assignments.findOne({ staff_id: id(staffId), class_id: id(classId), active: true }));
}
async function fullAssignments(filter = {}) {
  const list = await assignments.find({ active: true, ...filter }).toArray();
  const [cs, ss, us, ts] = await Promise.all([
    classes.find({}).toArray(),
    subjects.find({}).toArray(),
    users.find({}).toArray(),
    timetable.find({ active: true }).toArray(),
  ]);
  const cm = new Map(cs.map((x) => [x._id.toString(), x])),
    sm = new Map(ss.map((x) => [x._id.toString(), x])),
    um = new Map(us.map((x) => [x._id.toString(), x]));
  return list.map((a) => ({
    id: a._id.toString(),
    staff_id: a.staff_id.toString(),
    class_id: a.class_id.toString(),
    subject_id: a.subject_id.toString(),
    staff: um.get(a.staff_id.toString())?.name || "Inactive staff",
    email: um.get(a.staff_id.toString())?.email || "",
    class_name: cm.get(a.class_id.toString())?.name || "Archived class",
    semester: cm.get(a.class_id.toString())?.semester || 1,
    subject: sm.get(a.subject_id.toString())?.name || "Archived subject",
    subject_code: sm.get(a.subject_id.toString())?.code || "",
    slots: ts
      .filter((t) => t.assignment_id.equals(a._id))
      .map((t) => ({ id: t._id.toString(), day: t.day, start_time: t.start_time, end_time: t.end_time })),
  }));
}
app.post(
  "/api/auth/login",
  rateLimit({ windowMs: 900000, limit: 10, standardHeaders: true, legacyHeaders: false }),
  route(async (req, res) => {
    const email = clean(req.body?.email, 254).toLowerCase(),
      pass = String(req.body?.password || "");
    if (!schoolEmail(email)) return res.status(400).json({ error: "Use your @school.edu.in email address." });
    const found = await users.findOne({ email, active: true });
    if (!found || !bcrypt.compareSync(pass, found.password_hash))
      return res.status(401).json({ error: "Email or password is incorrect." });
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: "Could not start your session." });
      req.session.user = {
        id: found._id.toString(),
        email: found.email,
        name: found.name,
        role: found.role,
        must_change_password: !!found.must_change_password,
      };
      res.json({ user: req.session.user });
    });
  }),
);
app.get("/api/auth/me", (req, res, next) => {
  if (!req.session.user) return res.json({ user: null });
  auth(req, res, () => res.json({ user: req.session.user }));
});
app.post("/api/auth/logout", auth, (req, res) =>
  req.session.destroy(() => {
    res.clearCookie("school-teachers.sid");
    res.json({ ok: true });
  }),
);
app.post(
  "/api/auth/change-password",
  auth,
  route(async (req, res) => {
    const oldPass = String(req.body?.currentPassword || ""),
      nextPass = String(req.body?.newPassword || "");
    if (nextPass.length < 10)
      return res.status(400).json({ error: "Use at least 10 characters for the new password." });
    const found = await users.findOne({ _id: id(user(req).id) });
    if (!found || (!user(req).must_change_password && !bcrypt.compareSync(oldPass, found.password_hash)))
      return res.status(400).json({ error: "Current password is incorrect." });
    await users.updateOne(
      { _id: found._id },
      { $set: { password_hash: bcrypt.hashSync(nextPass, 12), must_change_password: false } },
    );
    req.session.user.must_change_password = false;
    res.json({ ok: true });
  }),
);
app.get(
  "/api/dashboard",
  auth,
  route(async (req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    if (user(req).role === "admin") {
      const [studentCount, staffCount, classCount, subjectCount, todaySlots, registers] = await Promise.all([
        students.countDocuments({ active: true }),
        users.countDocuments({ active: true, role: "staff" }),
        classes.countDocuments({ active: true }),
        subjects.countDocuments({ active: true }),
        timetable.countDocuments({ active: true, day: dayFor(today) }),
        attendance.countDocuments({}),
      ]);
      return res.json({
        role: "admin",
        students: studentCount,
        staff: staffCount,
        classes: classCount,
        subjects: subjectCount,
        todaySlots,
        registers,
      });
    }
    const assigned = await fullAssignments({ staff_id: id(user(req).id) });
    const classIds = [...new Set(assigned.map((a) => a.class_id))].map(id);
    const [studentCount, slots] = await Promise.all([
      students.countDocuments({ active: true, class_id: { $in: classIds } }),
      Promise.resolve(assigned.flatMap((a) => a.slots.filter((t) => t.day === dayFor(today)))),
    ]);
    res.json({ role: "staff", students: studentCount, classes: assigned.length, todaySlots: slots.length });
  }),
);
app.get(
  "/api/users",
  auth,
  admin,
  route(async (req, res) => {
    const list = await users
      .find({ active: true })
      .project({ password_hash: 0 })
      .sort({ role: 1, name: 1 })
      .toArray();
    res.json({
      users: list.map((u) => ({
        id: u._id.toString(),
        name: u.name,
        email: u.email,
        role: u.role,
        must_change_password: !!u.must_change_password,
      })),
    });
  }),
);
app.post(
  "/api/users",
  auth,
  admin,
  route(async (req, res) => {
    const email = clean(req.body?.email, 254).toLowerCase(),
      name = clean(req.body?.name),
      pass = String(req.body?.temporaryPassword || "");
    if (!schoolEmail(email) || !name)
      return res.status(400).json({ error: "Use a valid staff name and an @school.edu.in email address." });
    if (pass.length < 10)
      return res.status(400).json({ error: "Temporary password must have at least 10 characters." });
    const doc = {
      email,
      name,
      role: "staff",
      active: true,
      must_change_password: true,
      password_hash: bcrypt.hashSync(pass, 12),
      created_at: new Date(),
    };
    try {
      await users.insertOne(doc);
    } catch (e) {
      if (e.code === 11000) return res.status(409).json({ error: "That email is already registered." });
      throw e;
    }
    res.status(201).json({ id: doc._id.toString(), email, name, role: "staff" });
  }),
);
app.post(
  "/api/users/:id/reset-password",
  auth,
  admin,
  route(async (req, res) => {
    const staffId = id(req.params.id),
      temporaryPassword = String(req.body?.temporaryPassword || "");
    if (!staffId) return res.status(404).json({ error: "Staff account not found." });
    if (temporaryPassword.length < 10)
      return res.status(400).json({ error: "Temporary password must have at least 10 characters." });
    const result = await users.updateOne(
      { _id: staffId, active: true, role: "staff" },
      {
        $set: {
          password_hash: bcrypt.hashSync(temporaryPassword, 12),
          must_change_password: true,
          password_reset_at: new Date(),
        },
      },
    );
    if (!result.matchedCount) return res.status(404).json({ error: "Active staff account not found." });
    res.json({ ok: true });
  }),
);
app.delete(
  "/api/users/:id",
  auth,
  admin,
  route(async (req, res) => {
    const staffId = id(req.params.id);
    if (!staffId) return res.status(404).json({ error: "Staff account not found." });
    if (staffId.toString() === user(req).id)
      return res.status(400).json({ error: "You cannot remove your own admin account." });
    const found = await users.findOne({ _id: staffId, active: true, role: "staff" });
    if (!found) return res.status(404).json({ error: "Staff account not found." });
    await users.updateOne({ _id: staffId }, { $set: { active: false } });
    const assigned = await assignments.find({ staff_id: staffId }).toArray();
    await assignments.updateMany({ staff_id: staffId }, { $set: { active: false } });
    await timetable.updateMany(
      { assignment_id: { $in: assigned.map((a) => a._id) } },
      { $set: { active: false } },
    );
    res.json({ ok: true });
  }),
);
app.get(
  "/api/classes",
  auth,
  route(async (req, res) => {
    if (user(req).role === "admin")
      return res.json({
        classes: (await classes.find({ active: true }).sort({ semester: 1, name: 1 }).toArray()).map(dto),
      });
    const a = await fullAssignments({ staff_id: id(user(req).id) }),
      ids = [...new Set(a.map((x) => x.class_id))].map(id);
    res.json({
      classes: (
        await classes
          .find({ _id: { $in: ids }, active: true })
          .sort({ semester: 1, name: 1 })
          .toArray()
      ).map(dto),
    });
  }),
);
app.post(
  "/api/classes",
  auth,
  admin,
  route(async (req, res) => {
    const name = clean(req.body?.name, 50).toUpperCase(),
      semester = Number(req.body?.semester);
    if (!name || !Number.isInteger(semester) || semester < 1 || semester > 8)
      return res.status(400).json({ error: "Enter a class name and semester 1–8." });
    const doc = { name, semester, active: true, created_at: new Date() };
    try {
      await classes.insertOne(doc);
    } catch (e) {
      if (e.code === 11000)
        return res.status(409).json({ error: "This class already exists for that semester." });
      throw e;
    }
    res.status(201).json({ class: dto(doc) });
  }),
);
app.delete(
  "/api/classes/:id",
  auth,
  admin,
  route(async (req, res) => {
    const cid = id(req.params.id);
    if (!cid) return res.status(404).json({ error: "Class not found." });
    if (await assignments.countDocuments({ class_id: cid, active: true }))
      return res.status(409).json({ error: "Remove this class's active teacher assignments first." });
    await classes.updateOne({ _id: cid }, { $set: { active: false } });
    res.json({ ok: true });
  }),
);
app.get(
  "/api/subjects",
  auth,
  route(async (req, res) => {
    if (user(req).role === "admin")
      return res.json({
        subjects: (await subjects.find({ active: true }).sort({ semester: 1, name: 1 }).toArray()).map(dto),
      });
    const a = await fullAssignments({ staff_id: id(user(req).id) }),
      ids = [...new Set(a.map((x) => x.subject_id))].map(id);
    res.json({
      subjects: (
        await subjects
          .find({ _id: { $in: ids }, active: true })
          .sort({ semester: 1, name: 1 })
          .toArray()
      ).map(dto),
    });
  }),
);
app.post(
  "/api/subjects",
  auth,
  admin,
  route(async (req, res) => {
    const name = clean(req.body?.name),
      code = clean(req.body?.code, 20).toUpperCase(),
      semester = Number(req.body?.semester);
    if (!name || !code || !Number.isInteger(semester) || semester < 1 || semester > 8)
      return res.status(400).json({ error: "Enter a subject name, code, and semester 1–8." });
    const doc = { name, code, semester, active: true, created_at: new Date() };
    try {
      await subjects.insertOne(doc);
    } catch (e) {
      if (e.code === 11000) return res.status(409).json({ error: "Subject code already exists." });
      throw e;
    }
    res.status(201).json({ subject: dto(doc) });
  }),
);
app.delete(
  "/api/subjects/:id",
  auth,
  admin,
  route(async (req, res) => {
    const sid = id(req.params.id);
    if (!sid) return res.status(404).json({ error: "Subject not found." });
    if (await assignments.countDocuments({ subject_id: sid, active: true }))
      return res.status(409).json({ error: "Remove active assignments for this subject first." });
    await subjects.updateOne({ _id: sid }, { $set: { active: false } });
    res.json({ ok: true });
  }),
);
app.get(
  "/api/assignments",
  auth,
  route(async (req, res) => {
    const filter = user(req).role === "admin" ? {} : { staff_id: id(user(req).id) };
    res.json({ assignments: await fullAssignments(filter) });
  }),
);
app.post(
  "/api/assignments",
  auth,
  admin,
  route(async (req, res) => {
    const staffId = id(req.body?.staff_id),
      classId = id(req.body?.class_id),
      subjectId = id(req.body?.subject_id);
    if (!staffId || !classId || !subjectId)
      return res.status(400).json({ error: "Choose a teacher, class, and subject." });
    const [staff, c, s] = await Promise.all([
      users.findOne({ _id: staffId, active: true, role: "staff" }),
      classes.findOne({ _id: classId, active: true }),
      subjects.findOne({ _id: subjectId, active: true }),
    ]);
    if (!staff || !c || !s) return res.status(400).json({ error: "Choose active records." });
    if (c.semester !== s.semester)
      return res.status(400).json({ error: "Class and subject must be in the same semester." });
    const doc = {
      staff_id: staffId,
      class_id: classId,
      subject_id: subjectId,
      active: true,
      created_at: new Date(),
    };
    try {
      await assignments.insertOne(doc);
    } catch (e) {
      if (e.code === 11000) return res.status(409).json({ error: "This assignment already exists." });
      throw e;
    }
    res.status(201).json({ id: doc._id.toString() });
  }),
);
app.delete(
  "/api/assignments/:id",
  auth,
  admin,
  route(async (req, res) => {
    const aid = id(req.params.id);
    if (!aid) return res.status(404).json({ error: "Assignment not found." });
    await assignments.updateOne({ _id: aid }, { $set: { active: false } });
    await timetable.updateMany({ assignment_id: aid }, { $set: { active: false } });
    res.json({ ok: true });
  }),
);
app.get(
  "/api/timetable",
  auth,
  route(async (req, res) => {
    const filter = user(req).role === "admin" ? {} : { staff_id: id(user(req).id) },
      info = await fullAssignments(filter),
      map = new Map(info.map((a) => [a.id, a])),
      slots = await timetable.find({ active: true }).sort({ day: 1, start_time: 1 }).toArray();
    res.json({
      timetable: slots
        .map((t) => {
          const a = map.get(t.assignment_id.toString());
          return a
            ? { ...a, slot_id: t._id.toString(), day: t.day, start_time: t.start_time, end_time: t.end_time }
            : null;
        })
        .filter(Boolean),
    });
  }),
);
app.post(
  "/api/timetable",
  auth,
  admin,
  route(async (req, res) => {
    const aid = id(req.body?.assignment_id),
      day = clean(req.body?.day),
      start = clean(req.body?.start_time, 5),
      end = clean(req.body?.end_time, 5);
    if (
      !aid ||
      !DAYS.includes(day) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(start) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(end) ||
      minutes(start) >= minutes(end)
    )
      return res.status(400).json({ error: "Choose a weekday and valid start and end times." });
    const a = await assignments.findOne({ _id: aid, active: true });
    if (!a) return res.status(404).json({ error: "Teacher assignment not found." });
    const other = await timetable.find({ day, active: true }).toArray();
    const ownerAssignments = await assignments
      .find({ _id: { $in: other.map((t) => t.assignment_id) } })
      .toArray();
    const ownerMap = new Map(ownerAssignments.map((x) => [x._id.toString(), x.staff_id.toString()]));
    const collision = other.find(
      (t) =>
        minutes(start) < minutes(t.end_time) &&
        minutes(end) > minutes(t.start_time) &&
        (t.class_id.equals(a.class_id) || ownerMap.get(t.assignment_id.toString()) === a.staff_id.toString()),
    );
    if (collision)
      return res.status(409).json({ error: "This class already has an overlapping timetable entry." });
    const doc = {
      assignment_id: aid,
      class_id: a.class_id,
      day,
      start_time: start,
      end_time: end,
      active: true,
      created_at: new Date(),
    };
    await timetable.insertOne(doc);
    res.status(201).json({ slot_id: doc._id.toString() });
  }),
);
app.delete(
  "/api/timetable/:id",
  auth,
  admin,
  route(async (req, res) => {
    const tid = id(req.params.id);
    if (!tid) return res.status(404).json({ error: "Entry not found." });
    await timetable.updateOne({ _id: tid }, { $set: { active: false } });
    res.json({ ok: true });
  }),
);
app.get(
  "/api/students",
  auth,
  route(async (req, res) => {
    const filter = { active: true };
    if (req.query.class_id) {
      filter.class_id = id(req.query.class_id);
      if (!filter.class_id) return res.json({ students: [] });
    }
    if (user(req).role === "staff") {
      const list = await fullAssignments({ staff_id: id(user(req).id) }),
        allowed = [...new Set(list.map((a) => a.class_id))].map(id);
      if (req.query.class_id && !allowed.some((x) => x.equals(filter.class_id)))
        return res.status(403).json({ error: "You can only view assigned classes." });
      if (!req.query.class_id) filter.class_id = { $in: allowed };
    }
    const list = await students.find(filter).sort({ semester: 1, name: 1 }).toArray(),
      cids = [...new Set(list.map((s) => s.class_id.toString()))].map(id),
      [cs, regs] = await Promise.all([
        classes.find({ _id: { $in: cids } }).toArray(),
        attendance.find({ class_id: { $in: cids } }, { projection: { class_id: 1, records: 1, created_at: 1 } }).toArray(),
      ]),
      cmap = new Map(cs.map((c) => [c._id.toString(), c]));
    res.json({
      students: list.map((s) => {
        const enrolledAt = s.enrolled_at || s.created_at || new Date(0),
          cr = regs.filter((r) => r.class_id.equals(s.class_id) && r.created_at >= enrolledAt),
          attended = cr.filter((r) => r.records.some((x) => x.student_id.equals(s._id) && x.present)).length;
        return {
          id: s._id.toString(),
          usn: s.usn,
          name: s.name,
          class_id: s.class_id.toString(),
          class_name: cmap.get(s.class_id.toString())?.name || "",
          semester: s.semester,
          classes_attended: attended,
          classes_taken: cr.length,
          percentage: cr.length ? Math.round((1000 * attended) / cr.length) / 10 : 0,
        };
      }),
    });
  }),
);
app.post(
  "/api/students",
  auth,
  route(async (req, res) => {
    const cid = id(req.body?.class_id),
      usn = clean(req.body?.usn, 30).toUpperCase(),
      name = clean(req.body?.name);
    if (!cid || !usn || !name) return res.status(400).json({ error: "Enter a name, USN, and class." });
    const c = await classes.findOne({ _id: cid, active: true });
    if (!c) return res.status(404).json({ error: "Class not found." });
    if (user(req).role === "staff" && !(await assignedClass(user(req).id, cid)))
      return res.status(403).json({ error: "You can only add students to assigned classes." });
    const now = new Date();
    const doc = { usn, name, class_id: cid, semester: c.semester, active: true, created_at: now, enrolled_at: now };
    try {
      await students.insertOne(doc);
    } catch (e) {
      if (e.code === 11000) return res.status(409).json({ error: "That USN already exists." });
      throw e;
    }
    res.status(201).json({ student: dto(doc) });
  }),
);
app.put(
  "/api/students/:id",
  auth,
  route(async (req, res) => {
    const sid = id(req.params.id),
      cid = id(req.body?.class_id),
      name = clean(req.body?.name),
      usn = clean(req.body?.usn, 30).toUpperCase();
    if (!sid || !cid || !name || !usn)
      return res.status(400).json({ error: "Enter a name, USN, and class." });
    const c = await classes.findOne({ _id: cid, active: true });
    if (!c) return res.status(404).json({ error: "Class not found." });
    if (user(req).role === "staff" && !(await assignedClass(user(req).id, cid)))
      return res.status(403).json({ error: "You can only move students to assigned classes." });
    const existing = await students.findOne({ _id: sid, active: true });
    if (!existing) return res.status(404).json({ error: "Student not found." });
    const update = { name, usn, class_id: cid, semester: c.semester };
    if (!existing.class_id.equals(cid)) update.enrolled_at = new Date();
    try {
      await students.updateOne({ _id: sid, active: true }, { $set: update });
    } catch (e) {
      if (e.code === 11000) return res.status(409).json({ error: "That USN already exists." });
      throw e;
    }
    res.json({ ok: true });
  }),
);
app.delete(
  "/api/students/:id",
  auth,
  route(async (req, res) => {
    const sid = id(req.params.id),
      s = sid && (await students.findOne({ _id: sid, active: true }));
    if (!s) return res.status(404).json({ error: "Student not found." });
    if (user(req).role === "staff" && !(await assignedClass(user(req).id, s.class_id)))
      return res.status(403).json({ error: "You can only remove students from assigned classes." });
    await students.updateOne({ _id: sid }, { $set: { active: false } });
    res.json({ ok: true });
  }),
);
async function slotAccess(req, slotId, date) {
  if (!validDate(date)) return { error: "Choose a valid date." };
  const slot = await timetable.findOne({ _id: id(slotId), active: true });
  if (!slot) return { error: "Timetable class not found." };
  if (dayFor(date) !== slot.day) return { error: `Choose a ${slot.day} for this class.` };
  if (
    user(req).role === "staff" &&
    !(await assignments.findOne({ _id: slot.assignment_id, staff_id: id(user(req).id), active: true }))
  )
    return { denied: true };
  return { slot };
}
async function makeMarks(slot, records) {
  const roster = await students.find({ class_id: slot.class_id, active: true }).toArray();
  if (!roster.length || !Array.isArray(records) || records.length !== roster.length) return null;
  const m = new Map(roster.map((s) => [s._id.toString(), s]));
  if (
    new Set(records.map((r) => String(r.student_id))).size !== records.length ||
    records.some((r) => !m.has(String(r.student_id)) || typeof r.present !== "boolean")
  )
    return null;
  return records.map((r) => ({
    student_id: m.get(String(r.student_id))._id,
    usn: m.get(String(r.student_id)).usn,
    name: m.get(String(r.student_id)).name,
    present: r.present,
  }));
}
app.get(
  "/api/attendance",
  auth,
  route(async (req, res) => {
    const filter = {};
    if (req.query.date) filter.date = String(req.query.date);
    if (req.query.slot_id) filter.slot_id = id(req.query.slot_id);
    if (user(req).role === "staff") {
      const slots = await (async () => {
        const a = await assignments.find({ staff_id: id(user(req).id), active: true }).toArray();
        return a.length
          ? timetable.find({ assignment_id: { $in: a.map((x) => x._id) }, active: true }).toArray()
          : [];
      })();
      filter.slot_id = { $in: slots.map((x) => x._id) };
    }
    const docs = await attendance.find(filter).sort({ date: -1 }).limit(200).toArray();
    const data = docs.map((r) => ({
      id: r._id.toString(),
      date: r.date,
      slot_id: r.slot_id.toString(),
      class_name: r.class_name,
      subject: r.subject,
      staff_name: r.staff_name,
      start_time: r.start_time,
      end_time: r.end_time,
      present: r.records.filter((x) => x.present).length,
      recorded: r.records.length,
      records: r.records,
    }));
    res.json({
      registers: data,
      register:
        req.query.date && req.query.slot_id
          ? data.find((x) => x.date === req.query.date && x.slot_id === String(req.query.slot_id)) || null
          : null,
    });
  }),
);
app.post(
  "/api/attendance",
  auth,
  route(async (req, res) => {
    if (user(req).role !== "staff")
      return res.status(403).json({ error: "Only the assigned teacher can mark attendance." });
    const { date, slot_id: slotId, records } = req.body || {},
      access = await slotAccess(req, slotId, date);
    if (access.denied) return res.status(403).json({ error: "You can only mark your assigned classes." });
    if (access.error) return res.status(400).json({ error: access.error });
    const marks = await makeMarks(access.slot, records);
    if (!marks) return res.status(400).json({ error: "Mark every active student in this class once." });
    const a = await assignments.findOne({ _id: access.slot.assignment_id }),
      [c, s, teacher] = await Promise.all([
        classes.findOne({ _id: a.class_id }),
        subjects.findOne({ _id: a.subject_id }),
        users.findOne({ _id: a.staff_id }),
      ]);
    const doc = {
      date,
      slot_id: access.slot._id,
      class_id: a.class_id,
      subject_id: a.subject_id,
      staff_id: a.staff_id,
      class_name: c.name,
      subject: s.name,
      staff_name: teacher.name,
      start_time: access.slot.start_time,
      end_time: access.slot.end_time,
      records: marks,
      created_at: new Date(),
      updated_at: new Date(),
    };
    try {
      await attendance.insertOne(doc);
    } catch (e) {
      if (e.code === 11000)
        return res.status(409).json({ error: "Attendance is already recorded for this class and date." });
      throw e;
    }
    res.status(201).json({ ok: true });
  }),
);
app.put(
  "/api/attendance/:date/:slotId",
  auth,
  route(async (req, res) => {
    if (user(req).role !== "staff")
      return res.status(403).json({ error: "Only the assigned teacher can edit attendance." });
    const access = await slotAccess(req, req.params.slotId, req.params.date);
    if (access.denied) return res.status(403).json({ error: "You can only edit your assigned classes." });
    if (access.error) return res.status(400).json({ error: access.error });
    const marks = await makeMarks(access.slot, req.body?.records);
    if (!marks) return res.status(400).json({ error: "Mark every active student in this class once." });
    const result = await attendance.updateOne(
      { date: req.params.date, slot_id: access.slot._id },
      { $set: { records: marks, updated_at: new Date() } },
    );
    if (!result.matchedCount) return res.status(404).json({ error: "Attendance register not found." });
    res.json({ ok: true });
  }),
);
app.get(
  "/api/attendance/export.csv",
  auth,
  admin,
  route(async (req, res) => {
    const docs = await attendance.find({}).sort({ date: 1 }).toArray(),
      cell = (v) => {
        const value = String(v ?? "");
        const safe = /^[\s]*[=+\-@]/.test(value) ? String.fromCharCode(39) + value : value;
        return String.fromCharCode(34) + safe.replace(/"/g, '""') + String.fromCharCode(34);
      };
    const rows = docs.flatMap((r) =>
      r.records.map((x) =>
        [
          r.date,
          r.class_name,
          r.subject,
          r.staff_name,
          r.start_time,
          r.end_time,
          x.usn,
          x.name,
          x.present ? "Present" : "Absent",
        ]
          .map(cell)
          .join(","),
      ),
    );
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="school-attendance.csv"');
    res.send("\uFEFF" + ["Date,Class,Subject,Teacher,Start,End,USN,Student,Status", ...rows].join("\r\n"));
  }),
);
app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.use((e, req, res, next) => {
  console.error(e);
  res.status(500).json({ error: "Something went wrong. Please try again." });
});
async function ensureActiveUniqueIndex(collection, oldName, keys) {
  try { await collection.dropIndex(oldName); } catch (error) { if (error.codeName !== "IndexNotFound") throw error; }
  await collection.createIndex(keys, { unique: true, partialFilterExpression: { active: true } });
}
async function start() {
  const client = new MongoClient(URI, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const db = client.db(DB_NAME);
  users = db.collection("users");
  students = db.collection("students");
  classes = db.collection("classes");
  subjects = db.collection("subjects");
  assignments = db.collection("assignments");
  timetable = db.collection("timetable");
  attendance = db.collection("attendance");
  await Promise.all([
    attendance.createIndex({ date: 1, slot_id: 1 }, { unique: true }),
  ]);
  await Promise.all([
    ensureActiveUniqueIndex(users, "email_1", { email: 1 }),
    ensureActiveUniqueIndex(students, "usn_1", { usn: 1 }),
    ensureActiveUniqueIndex(classes, "name_1_semester_1", { name: 1, semester: 1 }),
    ensureActiveUniqueIndex(subjects, "code_1", { code: 1 }),
    ensureActiveUniqueIndex(assignments, "staff_id_1_class_id_1_subject_id_1", { staff_id: 1, class_id: 1, subject_id: 1 }),
    ensureActiveUniqueIndex(timetable, "assignment_id_1_day_1_start_time_1", { assignment_id: 1, day: 1, start_time: 1 }),
  ]);
  const email = clean(process.env.ADMIN_EMAIL || "admin@school.edu.in", 254).toLowerCase(),
    pass = process.env.ADMIN_PASSWORD || "AdminChangeMe123!";
  if (!schoolEmail(email)) throw new Error("ADMIN_EMAIL must use the @school.edu.in domain.");
  if (!(await users.findOne({ email }))) {
    await users.insertOne({
      email,
      name: "School Administrator",
      role: "admin",
      active: true,
      must_change_password: false,
      password_hash: bcrypt.hashSync(pass, 12),
      created_at: new Date(),
    });
    console.log(
      `Initial admin account created for ${email}. Set ADMIN_PASSWORD to a private value before production use.`,
    );
  }
  app.listen(PORT, () =>
    console.log(`School Attendance Portal connected to ${DB_NAME} at http://localhost:${PORT}`),
  );
}
start().catch((e) => {
  console.error(`MongoDB connection failed (${URI}): ${e.message}`);
  process.exit(1);
});
