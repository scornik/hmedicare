# License Matrix

## Repository licenses

| Repository | Exact evidence | Commercial use | Modification/redistribution | Copyleft/network effect | Required action |
|---|---|---|---|---|---|
| Medigo | No LICENSE file found in parent or fetched `MedigoAdmin`, `MedigoDoctor`, `MedigoUser` submodules | Unknown | Unknown | Unknown | Treat as reference-only until copyright/license provenance is confirmed; legal review required |
| OpenEMR | Exact `LICENSE`: GNU General Public License v3; `composer.json` says `GPL-3.0-or-later` | Commercial use is permitted by GPL subject to GPL conditions | Modification and redistribution are permitted; source/license and notices must be provided as required by GPL | Strong copyleft; combined/distributed derivative work obligations require legal review; network-use treatment is not automatically the same as AGPL | Do not embed/fork into a proprietary SaaS without legal analysis of linking, modification, distribution, modules, and service model |
| HCW@Home | No repository-level LICENSE found | Unknown | Unknown | Unknown | Do not copy code until license and contributor provenance are verified |
| TPT Doctor | `LICENSE`, MIT, copyright 2024 TPT Doctor | MIT permits commercial use | Modification, distribution, sublicense, sale permitted subject to notice/disclaimer | Permissive; no copyleft requirement in repository license | Preserve MIT notice for copied substantial code; audit dependencies |
| DocPilot | `LICENSE`, MIT, copyright 2025 Ayan Gupta; duplicate `MIT License`, copyright 2025 DocPilot | MIT permits commercial use | Modification, distribution, sublicense, sale permitted subject to notice/disclaimer | Permissive | Resolve duplicate notice attribution and audit dependencies/assets |

## Dependency/license facts
The repository manifests and lockfiles were inspected for dependency names and versions, but a complete transitive license report was not generated. Major declared dependencies requiring license review include:
- HCW@Home: NestJS ecosystem, Prisma, mediasoup, Socket.IO, Passport, Twilio, Stripe, Cloudinary, Angular.
- TPT Doctor: NestJS/Prisma/PostgreSQL stack, Socket.IO, Auth0-related integration, AWS/deployment tooling, and all workspace packages.
- OpenEMR: Composer PHP packages including Doctrine, Dompdf, Guzzle, PHPMailer, PhpSpreadsheet, Symfony/Laminas, plus npm/Webpack/Jest and custom modules.
- DocPilot: Flutter SDK, `go_router 16.2.5`, `flutter_svg 2.2.1`, `solar_icons 0.0.5`, `build_runner 2.9.0`, and generated/assets/fonts.

No license conclusion is made for an individual dependency without its package metadata. Before commercial SaaS distribution, produce an SBOM/license report from the exact lockfiles, inspect NOTICE files and asset/font licenses, confirm transitive copyleft terms, and retain attribution notices. Network-use implications must be reviewed dependency by dependency; repository MIT terms alone do not settle dependency obligations.

OpenEMR’s GPL-3.0-or-later status is the principal licensing constraint in this comparison. The repository may be studied as an architectural reference, but whether a particular module, API integration, separate service, or modified distribution triggers obligations is a legal-review question.

## Reuse posture
- TPT Doctor and DocPilot repository licenses are permissive, but code reuse would still require preserving notices and reviewing third-party terms, contributor provenance, security, and architectural suitability.
- Unlicensed/unknown repositories should be treated as reference-only until legal review confirms rights.
- This teardown does not grant permission, provide legal advice, or recommend copying source code.
