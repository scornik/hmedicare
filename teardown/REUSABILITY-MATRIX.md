# Reusability Matrix

Legend: **A** directly reusable component/code candidate after license/security review; **B** reusable architectural pattern; **C** reference only; **D** avoid.

| Feature | Medigo | OpenEMR | HCW@Home | TPT Doctor | DocPilot | Recommendation |
|---|---:|---:|---:|---:|---:|---|
| Patient/EHR model | C | B | C | B | C | Medigo’s simple Firestore collection split is useful for mobile workflow reference only; study OpenEMR’s mature model and TPT’s separation; design Bangladesh-specific fields independently |
| Consultation state machine | C | C | B | B | C | Study HCW statuses/admission/invitations; reconcile with TPT Encounter/TelemedicineSession |
| Video/media topology | C | C | B | C/B | C | Medigo’s Agora integration is a useful provider integration reference; HCW mediasoup entities are stronger for server orchestration; do not copy without security/load/ICE review |
| Serial/chamber queue | C | C | C | C | C | Build new domain model; no verified implementation found |
| Appointment/waitlist | C | C | B | B | C | Study Medigo’s mobile booking/chat flow plus TPT `Appointment`, `WaitlistEntry`, `CheckInRecord` and HCW `TimeSlot`; build a real serial model |
| Prescription workflow | C | B | C | B | C | Medigo is only a free-text prescription UI/reference; study OpenEMR’s integrated tables and TPT clinical/e-prescribing entities; build editor/PDF/delivery for Bangladesh |
| Medicine autocomplete | C | C | C | B | C | Use TPT `Drug` as pattern; populate a separately sourced Bangladesh catalog |
| Chat/notifications | C | C | B | B | C | Study HCW message/read/invitation and TPT notification/reminder patterns |
| Documents/lab reports | C | C | C | B | C | Study TPT Document/version/checksum/storage-key pattern; create explicit LabReport/LabResult if required |
| Auth/RBAC/tenancy | C | B | B | B | C | Study OpenEMR GACL/OAuth/audit and TPT tenant/audit/encryption packages; independently verify |
| Mobile architecture | B | C | C | C | B | Study Medigo’s separate patient/doctor Flutter apps, Firebase streams, and Agora call surface alongside DocPilot’s shared package; do not inherit Medigo’s legacy dependencies |
| AI/voice workflow | C | C | C | C | C | No verified implementation; build and safety-review from scratch |
| WhatsApp/SMS delivery | C | C | B | C | C | HCW has integration hooks only; build provider abstraction and delivery audit |

## Avoid
- **D:** Copying code from repositories with unknown/no license (Medigo, HCW@Home) or GPL code without legal analysis (OpenEMR).
- **D:** Treating schema breadth, README claims, compliance labels, provider dependencies, or Medigo client-side Firestore writes as finished production functionality.
- **D:** Copying a generic US/AU/NZ/UK/Canada data model unchanged into a Bangladesh workflow.
- **D:** Silent AI writes to diagnosis or prescription records.
