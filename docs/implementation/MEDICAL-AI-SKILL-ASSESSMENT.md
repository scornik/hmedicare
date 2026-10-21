# Medical AI skill and tool assessment

Reviewed 2026-10-21 against [awesome-medical-ai-skills](https://github.com/JuneYaooo/awesome-medical-ai-skills) and HMedicare's current AI implementation. The collection is a directory of third-party skills and MCP servers, not a single clinical component to install into the product. Its grades are a discovery aid, not our validation.

## Best next experiments

| Candidate | HMedicare use | Trial boundary |
| --- | --- | --- |
| [MCP Simple PubMed](https://github.com/andybrandt/mcp-simple-pubmed) | Retrieve public papers for a clinician-facing evidence sidebar, with title, PMID, date and source link. | Research-only queries without patient text. Cache and rate-limit results in our service. Keep evidence separate from AI-generated clinical suggestions and require the clinician to inspect the source. |
| [MOSAICX](https://github.com/DIGIT-X-Lab/MOSAICX) | Evaluate structured extraction from synthetic lab reports after document uploads are complete. | Run as an isolated local worker with synthetic files first. Its OCR/LLM stack has substantial compute needs; do not add it to the current Hostinger API process. Extracted fields remain unverified until a clinician reviews the source excerpt. |
| [Snowstorm MCP Server](https://github.com/IHTSDO/snowstorm-mcp-server) | Explore terminology search and validation for diagnosis entry. | Evaluation only. The server's software licence does not grant SNOMED CT content rights for storing identifiers in a clinical record; product integration needs appropriate terminology rights and a Bangladesh-facing coding strategy. |

## Later, only with a concrete integration partner

- FHIR bridge servers in the collection may help when HMedicare has an EHR or lab partner with a documented FHIR endpoint. There is no value in exposing patient charts to a general-purpose MCP server before a specific workflow, consent model, tenant boundary and audit trail exist.
- Guideline-retrieval tools may inform an evidence feature, but imported content needs source/version provenance, applicable population and locality, licensing, expiry/review, and an explicit clinician-facing citation. Oncology-specific or Chinese-language guideline packs are not a default fit for the current general-clinic Bangladesh workflow.

## Integration rule

Keep the existing HMedicare AI policy, credential vault, PHI minimization, job runner, audit chain and explicit doctor approval as the control plane. A third-party skill can supply public evidence, terminology lookup or document extraction behind a narrow adapter; it does not receive unrestricted database access or write diagnoses, prescriptions or notes. Prototype against synthetic records and prove tenant isolation, source citation, failure handling, data-retention behavior and clinician review before enabling a patient-data path.

Do not install the collection wholesale or treat its quality grades as a clinical safety approval. No third-party medical AI tool was installed or given patient data during this assessment.
