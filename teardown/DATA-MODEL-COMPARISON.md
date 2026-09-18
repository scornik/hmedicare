# Data Model Comparison

The table records only entities actually visible in checked-out source. “None found” is not a claim about upstream repositories that were not initialized.

| Concept | Medigo | OpenEMR | HCW@Home | TPT Doctor | DocPilot |
|---|---|---|---|---|---|
| Patient | `MedigoUser`, `users/{uid}`; no dedicated Patient model | `patient_data` | No `Patient`; `User` with `UserRole.PATIENT` | `Patient` | None found |
| Doctor | `Doctor`, `doctors/{id}` | `users`, provider/facility relationships | `User` with `PRACTITIONER`, plus `Speciality`, `PractitionerAvailability`, `TimeSlot` | `StaffMember` with `UserRole.DOCTOR`, license/specialization | None found |
| Clinic | `Clinic`, `clinics/{id}` | `facility` | `Organization`, `Group` | `Tenant`, `ClinicRoom` | None found |
| Appointment | `Appointment`, `appointments/{id}` | `openemr_postcalendar_events` and calendar module | `TimeSlot`; no `Appointment` model found | `Appointment` | None found |
| Serial/Queue | None; appointment booking only | Calendar/event scheduling, but no Bangladesh chamber serial entity identified | No serial/queue model found; `waitingParticipants` is a consultation counter | `WaitlistEntry`, `CheckInRecord`; no serial number model found | None found |
| Consultation | No dedicated entity; appointment/chat is the consultation surface | Encounter/form/clinical-note tables plus ComLink telehealth session tables | `Consultation` | `Encounter`, `TelemedicineSession` | None found |
| Diagnosis | None found | Problems/conditions/lists and FHIR Condition mappings | None found; `symptoms` is free text | `DiagnosisCode`, `MedicalCondition` | None found |
| Symptom | Not inspectable | Not inspectable | `Consultation.symptoms` | No dedicated `Symptom` model found | None found |
| Medication | None found | `drugs`, `drug_templates`, medication/list structures | None found | `Drug`, `PatientMedication` | None found |
| Prescription | `Prescription`, `prescriptions/{appointmentId}`, free-text `data` | `prescriptions`, drug/prescription UI and API paths | None found | `Prescription`, `PbsPrescription`, `UkEpsPrescription` | None found |
| PrescriptionItem | Not inspectable | Not inspectable | None found | No exact `PrescriptionItem` model found in inspected schema | None found |
| LabReport | `MedicalReport`, `medicalreports/{appointmentId}`, free-text `data`; separate `reports` query flow | Documents/clinical procedure results and laboratory-related tables/modules | None found | No exact `LabReport`; `LabOrder`, `LabPanel`, `ExternalLabConfig`, `Document` | None found |
| LabResult | Not inspectable | Not inspectable | None found | No exact `LabResult` model found | None found |
| Document | Firebase Storage declared, but no durable document entity found | `documents`, clinical note/document tables, document categories | None found in HCW schema inspected | `Document`, `DocumentFolder`, `DocumentTag`, `DocumentVersion`, `MyHealthRecordDocument` | None found |
| Communication | `appointments/{id}/messages`, `Message`, `lastMessage`, read timestamps | Direct messaging, `direct_message_log`, fax/SMS modules, ComLink notifications | `Message`, `MessageReadReceipt`, `ConsultationInvitation`, `MediaEvent`; `MessageService` includes WhatsApp/SMS/EMAIL | `Message`, `TelemedicineChatMessage`, `Notification` | None found |
| FollowUp | Not inspectable | Not inspectable | No dedicated `FollowUp`; reminders/time slots are adjacent | `EncounterType.FOLLOW_UP`, `AppointmentReminder`; no exact `FollowUp` model found | None found |
| Notification | Firebase Messaging/local notification dependencies; no notification entity | `automatic_notification` and telehealth notification services | `UserNotificationSetting`, `ConsultationReminder` | `Notification`, `AppointmentReminder`, `MessageTemplate` | None found |
| AuditLog | None found | `audit_master`, `audit_details`, audit logger/event sinks | `DeletedConsultationLog`; no general `AuditLog` found | `AuditLogEntry`, `PatientMergeLog` | None found |

## Schema observations
- OpenEMR is source-inspectable from git objects despite its sparse working tree. Its concrete relational model includes `patient_data`, `users`, `facility`, `openemr_postcalendar_events`, `forms`, `drugs`, `drug_templates`, `prescriptions`, `documents`, `clinical_notes`, `clinical_plans`, `lists`, `transactions`, `audit_master`, and `audit_details`. The original table cells marked OpenEMR “Not inspectable” should be read with this correction.
- HCW’s model is consultation-first and uses integer IDs, a shared `User`, organization/group membership, and explicit media transport tables (`MediasoupServer`, `MediasoupRouter`, `MediasoupTransport`, `MediasoupProducer`, `MediasoupConsumer`, `Participant`).
- TPT’s model is tenant/EHR-first, uses UUIDs, separates identity (`User`), workforce (`StaffMember`), patient (`Patient`), scheduling (`Appointment`), clinical encounter (`Encounter`), and longitudinal artifacts.
- TPT’s schema is broad and includes regional integration models (`MbsClaimSubmission`, `PbsPrescription`, `UkEpsPrescription`, Canada models), but breadth does not prove all modules are implemented or deployed.
- Neither inspected complete schema contains the requested Bangladesh-specific serial entity, Bangla/Banglish field, Bangladesh medicine catalog, or lab-result structure.
