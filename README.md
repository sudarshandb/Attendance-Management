# School Attendance Portal

A standalone attendance and timetable portal for school administrators and teachers. It uses the separate MongoDB database `Attendance_School_Portal` and runs at `http://localhost:3004`, so the earlier projects on ports 3000–3003 remain separate.

## Run locally

1. Install Node.js 20 or newer and MongoDB Community Server.
2. Start the local MongoDB service.
3. In this folder, run `npm install` and `npm start`.
4. Open http://localhost:3004.
5. The first admin signs in with `admin@school.edu.in` / `AdminChangeMe123!`; change this password under Account before normal use.

The default MongoDB address is `mongodb://127.0.0.1:27017`. Set `MONGODB_URI`, `MONGODB_DB`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SESSION_SECRET`, or `PORT` in the environment to customize them. `.env.example` lists sample values; the app does not automatically load `.env` files. Production mode refuses to start without `SESSION_SECRET` and `ADMIN_PASSWORD`.

## Roles

- **Admin:** sees all students and attendance details; can add/deactivate staff, reset a staff password to a temporary password without removing their assignments, assign teachers to a class and subject, manage the eight-semester class/subject catalog, edit the Monday–Friday timetable, and export school attendance. Only staff can create or edit attendance registers.
- **Teacher/staff:** signs in with a school email, sees assigned classes and student records immediately, and changes a temporary password before making changes. They can add/edit/archive students in those classes and mark attendance for scheduled periods.
- Login and new staff addresses must end in `@school.edu.in`. The domain is checked by the server, but mailbox ownership is not verified.
- Attendance is saved for each scheduled class period and date. Staff can only mark or edit their assigned period on its scheduled weekday.
- Student attendance percentages now count periods from their enrollment in the class, so students added or transferred mid-semester are not counted absent for earlier classes.

## Data and protection

MongoDB collections: `users`, `students`, `classes`, `subjects`, `assignments`, `timetable`, and `attendance`. Active accounts, roster IDs, classes, subjects, assignments, and timetable entries have unique indexes; archived records retain history but can be replaced. Attendance registers are unique per period/date. Removing staff or students archives them and preserves past attendance. CSV output escapes spreadsheet formulas.

## Security review and next steps

This is a local-use app, not a completed production security audit. The server hashes passwords, rate-limits sign-in, regenerates sessions at login, uses HTTP-only SameSite cookies, enforces API roles, restricts email domains, and requires production secrets. Before public deployment, replace Express's in-memory session store with a persistent store, require HTTPS, configure MongoDB authentication and backups, and add admin MFA plus an audit log for staff, timetable, and attendance changes. The default admin password is known; replace it now. For stronger account assurance, verify school email ownership or use the school's identity provider. Add a CSRF token as extra protection for state-changing requests.
