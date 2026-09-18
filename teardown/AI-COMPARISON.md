# AI Comparison

| Capability | Medigo | OpenEMR | HCW@Home | TPT Doctor | DocPilot |
|---|---|---|---|---|---|
| Speech-to-text/transcription | No speech/AI dependency or implementation found in fetched Flutter/React source | Not inspectable | No checked-out implementation found | No checked-out implementation found | No speech/AI dependency or service found in pubspecs |
| LLM integration | No OpenAI/Gemini/Anthropic/LLM provider or prompt pipeline found | Not inspectable | No OpenAI/Gemini/Anthropic/LLM source evidence found | No LLM provider or prompt pipeline verified | None found |
| Clinical extraction/recommendation | No clinical AI model; `MedicalReport`/`Prescription` are free-text artifacts | Not inspectable | No AI extraction/recommendation model found | `DecisionSupportRule`, `DrugInteraction`, and decision-support enums are structured safety concepts; no LLM extraction workflow proven | None found |
| History retrieval/suggestions | Firestore streams retrieve user/doctor/appointment/report history; no patient-specific AI suggestion engine | Not inspectable | No evidence | Patient relationships and full-text-search preview flag provide substrate; no patient-specific suggestion engine proven | None found |
| Structured output/approval | Not inspectable | Not inspectable | No evidence | Decision-support category/severity and audit/consent models support human review, but no AI approval workflow was found | None found |

## Status classification
- **IMPLEMENTED:** In the available source, no repository has verified speech-to-structured clinical documentation or LLM-assisted prescription/diagnosis functionality.
- **PARTIAL:** TPT Doctor has non-LLM clinical decision-support entities (`DecisionSupportRule`, `DrugInteraction`, severity/category enums), patient history relations, audit, consent, and tenant boundaries. These are foundations, not an AI workflow.
- **DEMO:** None can be confirmed from checked-out source.
- **DOCUMENTED BUT NOT IMPLEMENTED:** Any README or planning language suggesting AI cannot be promoted to implementation without a provider call, prompt/template, structured schema, persistence, and clinician approval path. No such complete path was found in the inspected files.

## Safety implication
The target requirement that AI never silently diagnoses or prescribes is not met by any verified reference implementation. A future design should treat AI output as a draft suggestion with source context, confidence/uncertainty, explicit doctor accept/edit/reject, versioned audit, and no write-through to medication or diagnosis records without approval.
