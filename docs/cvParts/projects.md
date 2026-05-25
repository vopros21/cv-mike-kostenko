### HubitHab — Automatic Habit Tracker
*iOS app · 2024–present · [hubithab.eu](https://hubithab.eu)*

Tracks habits automatically by pulling data from external services — no manual logging required.
Integrations: GitHub commit activity, LeetCode submissions, Apple HealthKit (steps), X/Twitter posts.
Visualises streaks and history as heatmaps.

**Tech stack:** Swift / SwiftUI, HealthKit, RevenueCat, Spring Boot proxy backend (Java, Render hosting).

**Architecture:** Connection-based plugin model — each service conforms to a protocol with its own renderer (`ConnectionViewFactory`). Backend is a thin authenticated proxy keeping credentials off-device. Free tier: 2 connections; paid: unlimited.

---

### Parking Service — Internal Office Booking System
*Web app · 2025–present · [parking.singledev.eu](https://parking.singledev.eu)*

Full-stack parking spot reservation system built for a real workplace. Supports daily bookings,
half-day slots (AM/PM/Full Day), a waitlist queue with automatic slot-aware offers, and a
per-day popup showing who has booked. Slack notifications integrated for queue activity.

**Tech stack:** Java (Spring Boot), PostgreSQL (Neon DB), Resend (transactional email / magic link auth),
Vite 5 + vanilla JS frontend, Cloudflare DNS, Render hosting.

**Architecture:** Monorepo with separate `frontend/` and backend modules. Passwordless auth via
magic links (email → session cookie). Queue entries carry a `desired_slot` field so offers are
filtered by slot type. Frontend built via `build.sh` at deploy time — dist not committed to git.
