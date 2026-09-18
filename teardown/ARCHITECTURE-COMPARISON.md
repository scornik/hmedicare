# Architecture Comparison

## Medigo
- **Repository shape:** Parent repository plus three separately fetched applications: Flutter `MedigoUser`, Flutter `MedigoDoctor`, and React/Redux/TypeScript `MedigoAdmin`. The isolated clone is `medigo-analysis/`; the original reference checkout remains untouched.
- **Backend/data layer:** Firebase is the backend. `UserDatabaseService.dart` in both mobile apps reads Firestore documents in `users`, `doctors`, `clinics`, `appointments`, `prescriptions`, and `medicalreports`; `AppointmentProvider.dart` writes appointment fields and nested `messages`. Admin `src/utils/firebase.ts` exposes the same Firebase project collections plus `patients`.
- **Identity:** Firebase email/password authentication, email verification, password reset, Google sign-in, and Facebook sign-in are implemented in `MedigoUser/lib/services/FirebaseAuthenticationService.dart`; the doctor app has a parallel Firebase authentication service. Admin auth is Firebase-based through React actions/reducers.
- **Patient/doctor/clinic:** `Doctor.dart`, `MedigoUser.dart`, and `Clinic.dart` are client-side Firestore mappers. Doctor fields include name, phone, email, image, field, hospital, city, geolocation, clinic ID, verification, experience, and age. No server-side domain service or relational model was found.
- **Appointments/consultation:** `Appointment.dart` models doctor/user IDs, date/time, channel ID, active audio/video flags, last message, timestamps, and read markers. Booking updates an existing `appointments/{id}` document and links report/medical-report/prescription documents by appointment ID. This is an appointment/chat record, not a robust consultation or serial entity.
- **Communication:** Messages are stored at `appointments/{appointmentId}/messages/{timestamp}`. Audio/video calls use Agora channel names, with `audioCallActive`/`videoCallActive` flags in Firestore. There is no server call-state machine, waiting room, recording, or durable call event model.
- **Clinical artifacts:** `MedicalReport` and `Prescription` each contain a free-text `data` string plus user/doctor/date IDs. There are no structured diagnosis, symptom, medication, prescription-item, lab-result, or audit entities.
- **Admin layer:** React admin fetches appointments by `doctorId` and uses Firestore directly. No custom API boundary or authorization middleware was found in the fetched source.

## OpenEMR
- **Layers/modules:** PHP web application with legacy interface/library code, Composer services, REST/FHIR controllers, SQL migrations/schema, custom modules, portal/templates, and JavaScript assets. `composer.json`, `src/`, `apis/`, `interface/`, `sql/`, `FHIR_README.md`, and `Documentation/api/` are the main boundaries.
- **Domain model:** relational MySQL/MariaDB schema documented in `sql/database.sql` and EHI export diagrams. Concrete tables include `patient_data`, `users`, `facility`, `openemr_postcalendar_events`, `forms`, `drugs`, `drug_templates`, `prescriptions`, `documents`, `clinical_notes`, `clinical_plans`, `lists`, `transactions`, and audit tables such as `audit_master`/`audit_details`.
- **Clinical workflow:** patient demographics and users are separate; scheduling is calendar/event based; encounters, forms, clinical notes, problems/conditions, medications, prescriptions, documents, billing, and reporting are long-lived relational records.
- **API/auth:** REST routes in `apis/routes/`, API documentation in `Documentation/api/`, OAuth2/API token tables and tests, FHIR R4 resources, SMART-on-FHIR documentation, and GACL authorization classes. Exact deployment configuration is required before assuming every route is enabled.
- **Telehealth/messaging:** custom `oe-module-comlink-telehealth` includes controllers, telehealth session repository, registration/auth utilities, participant invitation mailer, notification events, and `sql/table.sql`; direct messaging and fax/SMS modules are also present.
- **Security/audit:** `src/Common/Logging/Audit/`, `src/Common/Database/Middleware/QueryAuditor.php`, `config/audit.php`, and audit tables provide substantial security patterns. This remains an implementation to review, not a certification.
- **Build/deployment:** PHP 8.3+, Composer, npm/Webpack, Docker, and broad GitHub Actions for syntax, styling, tests, PHPStan, Rector, security, builds, releases, and acceptance testing.

## HCW@Home
- **Layers/modules:** separate Angular `admin`, `patient`, and `practitioner` clients; NestJS `backend/src`; Prisma schema and migrations/config. Backend feature boundaries are represented by Nest modules/controllers/services.
- **Domain model:** a single `User` acts as patient/practitioner/admin via `UserRole`; `Organization`, `OrganizationMember`, `Group`, `Speciality`, availability/time slots, and consultation-centric entities surround it.
- **Clinical/communication core:** `Consultation` owns participants, messages, payment, reminders, feedback, mediasoup routers/transports, invitations, and media events. It has statuses `DRAFT`, `SCHEDULED`, `WAITING`, `ACTIVE`, `COMPLETED`, `CANCELLED`, `TERMINATED_OPEN`.
- **Patient/doctor:** no separate Patient or Doctor table in the Prisma schema; both are `User` rows differentiated by `UserRole`. Practitioner profile data is specialties, languages, availability, and time slots.
- **Appointment/queue:** `TimeSlot` and `PractitionerAvailability` exist. No serial/chamber queue entity was identified.
- **Prescription/medication/diagnosis/lab:** no corresponding Prisma models were identified in the checked-out schema. `Consultation.symptoms` is a free-text field; this is not a diagnosis or longitudinal clinical record.
- **Documents/notifications:** `Document`/lab-report domain models were not identified. `UserNotificationSetting`, `ConsultationReminder`, message service values (`SMS`, `EMAIL`, `WHATSAPP`, `MANUALLY`), and `Message` exist.
- **API/auth:** NestJS REST-style modules with Passport local/custom/OpenID Connect dependencies; exact guards and endpoint authorization need per-controller review. Payments use Stripe declarations. Socket.IO and mediasoup support live communication.
- **Persistence/storage:** PostgreSQL/Prisma. Cloudinary is declared for media storage; exact permission and retention behavior needs verification.
- **Audit/logging:** `DeletedConsultationLog` and media events exist; a general immutable audit log was not identified.

## TPT Doctor
- **Layers/modules:** pnpm monorepo with `apps/api`, `apps/web`, `apps/patient-portal`, and reusable packages including `auth`, `database`, `encryption`, `compliance`, `audit-log`, `notifications`, `shared`, and `config`.
- **Tenant boundary:** `Tenant` owns staff, patients, appointments, encounters, prescriptions, labs, documents, messages, notifications, and audit logs. The schema comments claim row-level security, but operational enforcement must be verified in migrations/query code.
- **Identity/authorization:** `User` is Auth0-linked by unique `auth0Id`; `StaffMember` carries `UserRole` and a string-array `permissions`. Roles include `SUPER_ADMIN`, `PRACTICE_ADMIN`, `DOCTOR`, `NURSE`, `RECEPTIONIST`, `PATIENT`.
- **Patient/doctor:** `Patient` has MRN, demographics, contact data, conditions, allergies, immunizations, medications, documents, appointments, encounters, prescriptions, lab orders, and telemedicine sessions. Doctors are `StaffMember` rows with license/specialization and tenant relation.
- **Encounter/appointment:** `Appointment` and `Encounter` are distinct. `EncounterType` includes `TELEMEDICINE`, `FOLLOW_UP`, `CONSULTATION`, and office/home/emergency types. No dedicated serial/queue model was found; `WaitlistEntry` and `CheckInRecord` cover adjacent workflows.
- **Clinical record:** `DiagnosisCode`, `MedicalCondition`, `Allergy`, `PatientMedication`, `Prescription`, `LabOrder`, `Document`, and `TelemedicineSession` are explicit. Detailed clinical-note/voice entities were not identified in the inspected schema.
- **Safety/operations:** `PatientConsent`, `AuditLogEntry`, `PatientMergeLog`, `DecisionSupportRule`, `DrugInteraction`, and `ControlledSubstanceLog` provide an EHR/compliance pattern. `Notification`, `AppointmentReminder`, and `Message` cover communication.
- **API/deployment:** Nest API, Prisma/PostgreSQL, Socket.IO dependency, Docker Compose, AWS workflow, Ansible/on-premise deployment, Prometheus/alerting. Exact endpoint contract and runtime authorization require deeper execution review.

## DocPilot
- **Layers/modules:** shared Flutter package plus doctor and patient Flutter applications. App `lib/` trees provide presentation/core/theme/routing/assets; no server package is present.
- **Domain model:** no checked-out clinical persistence or network domain model was found. `go_router` is used for navigation; shared UI/utilities are intended for `docpilot_core`.
- **Auth/API/realtime:** no backend, database, auth, API client, realtime, or file-storage dependency was found in the three pubspecs inspected.
- **Clinical concepts:** the checkout does not substantiate patient, doctor, appointment, consultation, prescription, medication, diagnosis, lab, notification, or audit persistence.
- **Mobile value:** separate doctor/patient app shells, shared package, Flutter asset/font generation, and Android/iOS project scaffolding are reusable architectural references only.
