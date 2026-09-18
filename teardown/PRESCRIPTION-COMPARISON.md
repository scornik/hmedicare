# Prescription Comparison

| Area | Medigo | OpenEMR | HCW@Home | TPT Doctor | DocPilot |
|---|---|---|---|---|---|
| Diagnosis model | None found; prescription/report text only | Problems/conditions, clinical notes/forms, and FHIR Condition mappings | No diagnosis entity; consultation symptoms only | `DiagnosisCode`, `MedicalCondition` | None found |
| Medicine model/search | None found; no medicine collection or autocomplete model | `drugs`, `drug_templates`, medication/list structures, and drug/prescription UI/API paths | No medication/drug model found | `Drug`, `PatientMedication`, `DrugInteraction` | None found |
| Dosage/frequency/duration/instructions | Prescription is free-text `Prescription.data`; no structured fields | Prescription/drug tables and clinical forms; exact field semantics require source review | No prescription model found | Prescription exists in schema; exact field semantics require source read of model/service; no exact `PrescriptionItem` entity found | None found |
| Generation/PDF/printing | No PDF/print implementation found; Flutter `share` dependency is general-purpose | `dompdf/dompdf`, print-oriented UI/report paths, documents, and prescription API/UI tests; exact delivery path requires runtime verification | No prescription artifact found | `Document` and generated-letter/report infrastructure exist; prescription PDF/print path not proven | None found |
| Electronic delivery | Prescription is read from Firestore; no email/WhatsApp/PDF delivery path found | PHPMailer, fax/SMS module, direct messaging, and portal/API mechanisms; no Bangladesh WhatsApp prescription delivery found | Message service supports WhatsApp/SMS/EMAIL values, but no prescription delivery record found | Notification/message/reminder models; no verified prescription delivery workflow | None found |
| Autocomplete/reusable prescriptions | No evidence | `drug_templates` is a reusable-data pattern; no target Bangladesh autocomplete claim made | No evidence | `Drug`/templates may support it architecturally; no verified autocomplete or reusable-prescription implementation | None found |

## Evidence-based conclusion
TPT Doctor is the only inspected checkout with explicit prescription, drug, patient-medication, interaction, controlled-substance, and e-prescribing entities (`Prescription`, `Drug`, `PatientMedication`, `DrugInteraction`, `ControlledSubstanceLog`, `EPrescribingTransaction`, plus regional `PbsPrescription`/`UkEpsPrescription`). This is an architectural reference, not evidence that a complete prescription editor or PDF delivery flow works.

OpenEMR is also a strong prescription reference: its SQL schema includes `prescriptions`, `drugs`, and `drug_templates`, and its source tree contains prescription API tests, clinical forms, document/print infrastructure, and `dompdf/dompdf`. It is more mature as an integrated EHR workflow than HCW@Home, but GPL licensing and its broad legacy schema are significant adoption constraints.

HCW@Home’s prescription gap is material: the consultation model and communication hooks do not extend to a structured medication/prescription record. Medigo has a working-looking free-text prescription document in Firestore, but no structured medication model, PDF generation, or delivery path. DocPilot contains no clinical prescription backend.

For the target product, dosage, frequency, duration, route, instructions, substitution, approval status, author, and immutable rendered version must be designed explicitly. The current references do not provide a verified Bangladesh medicine catalog or Bangladesh prescription format.
