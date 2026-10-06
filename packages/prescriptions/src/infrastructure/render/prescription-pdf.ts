import { createHash } from 'node:crypto';
import { FONT_FAMILY, pdfmakeFonts } from './fonts';

/**
 * Prescription PDF rendering (RX-005, PRESCRIPTION-IMPLEMENTATION.md §3).
 *
 * Two properties matter more than the layout.
 *
 * **It renders what was approved, not what the database says today.** The caller passes the approved
 * snapshot and its hash; the job verifies the hash before calling in here. Nothing in this file reads a
 * medication row or a catalog entry, so a later import cannot change a PDF that was already handed over.
 *
 * **The same input renders to the same bytes.** PDF normally carries a creation date and a document id
 * derived from the clock, which would make two renders of one prescription differ and make
 * `last_render_sha256` meaningless. Both are pinned: the creation date is the approval time, and the
 * producer string is the template version. So a re-render is byte-identical and can be compared rather
 * than merely regenerated.
 *
 * No dosing text is ever invented. Every field printed comes from the prescription; where a doctor left
 * something empty, the PDF shows it empty (ADR-020 §4 forbids dosing guidance from catalog data).
 */
export const RX_TEMPLATE_VERSION = 'rx-pdf-v1';

export interface RenderItem {
  sequence: number;
  /** The brand or free-text name as recorded at approval. */
  name: string;
  isFreeText: boolean;
  strength: string | null;
  dosageForm: string | null;
  route: string | null;
  dose: string;
  frequency: string;
  duration: string;
  quantity: string | null;
  timing: string | null;
  instructions: string | null;
  instructionsBn: string | null;
  substitutionAllowed: boolean;
}

export interface RenderInput {
  prescriptionId: string;
  revision: number;
  /** `APPROVED` prints plainly; `VOID` prints with a watermark for an audit re-render. */
  clinicalStatus: 'APPROVED' | 'VOID';
  approvedAt: Date;
  approvedSnapshotSha256: string;
  clinicName: string;
  doctorName: string;
  doctorRegistration: string | null;
  patientName: string;
  patientCode: string;
  items: readonly RenderItem[];
}

const DATE = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Dhaka',
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** The line under a medication: everything the doctor wrote, nothing it did not. */
function directions(item: RenderItem): string {
  const parts = [item.dose, item.frequency, item.duration, item.timing, item.quantity].filter(
    (p): p is string => typeof p === 'string' && p.trim().length > 0,
  );
  return parts.join(' · ');
}

export function documentDefinition(input: RenderInput): Record<string, unknown> {
  const voided = input.clinicalStatus === 'VOID';
  const rows = input.items
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .flatMap((item) => {
      const heading = [item.name, item.strength, item.dosageForm]
        .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
        .join(' ');
      const notes = [
        item.route ? `Route: ${item.route}` : null,
        item.instructions,
        item.instructionsBn,
        // Printed either way: "substitution not allowed" is a clinical instruction to the pharmacist,
        // and its absence must not be read as permission.
        item.substitutionAllowed ? 'Substitution allowed' : 'Do not substitute',
        // A free-text line is marked on the page, not only in the database. A pharmacist has to be able
        // to see that a name was typed rather than chosen from the catalog.
        item.isFreeText ? 'Free text (not from the medication catalog)' : null,
      ].filter((n): n is string => typeof n === 'string' && n.trim().length > 0);

      return [
        [
          { text: String(item.sequence), alignment: 'right' },
          [
            { text: heading, bold: true },
            { text: directions(item), margin: [0, 2, 0, 0] },
            ...notes.map((n) => ({ text: n, fontSize: 9, color: '#444444' })),
          ],
        ],
      ];
    });

  return {
    pageSize: 'A4',
    pageMargins: [40, 48, 40, 56],
    defaultStyle: { font: FONT_FAMILY, fontSize: 11 },
    info: {
      title: `Prescription ${input.prescriptionId}`,
      author: input.clinicName,
      // Pinned, not `new Date()`: a PDF whose bytes change on every render cannot be compared with the
      // hash recorded for the last one.
      creationDate: input.approvedAt,
      producer: RX_TEMPLATE_VERSION,
      creator: RX_TEMPLATE_VERSION,
    },
    ...(voided ? { watermark: { text: 'VOID', color: '#cc0000', opacity: 0.25, bold: true } } : {}),
    content: [
      { text: input.clinicName, bold: true, fontSize: 15 },
      {
        columns: [
          [
            { text: input.doctorName, bold: true },
            ...(input.doctorRegistration ? [{ text: `Reg: ${input.doctorRegistration}` }] : []),
          ],
          [
            { text: `Patient: ${input.patientName}`, alignment: 'right' },
            { text: `ID: ${input.patientCode}`, alignment: 'right' },
            { text: DATE.format(input.approvedAt), alignment: 'right', fontSize: 9 },
          ],
        ],
        margin: [0, 8, 0, 12],
      },
      {
        text: voided ? 'Prescription (VOID — superseded or withdrawn)' : 'Prescription',
        bold: true,
        margin: [0, 0, 0, 6],
      },
      rows.length > 0
        ? { table: { widths: [16, '*'], body: rows }, layout: 'lightHorizontalLines' }
        : // Cannot happen through the service, which refuses to approve an empty prescription. Printed
          // rather than thrown, because a PDF that explains itself is more use to whoever is holding it
          // than a render that failed for a reason they cannot see.
          { text: 'This prescription has no items.', italics: true },
      {
        text: [
          `Revision ${input.revision} · approved ${DATE.format(input.approvedAt)} · `,
          `snapshot ${input.approvedSnapshotSha256.slice(0, 16)}`,
        ],
        fontSize: 8,
        color: '#666666',
        margin: [0, 16, 0, 0],
      },
    ],
    footer: (page: number, pages: number) => ({
      text: `Page ${page} of ${pages} · template ${RX_TEMPLATE_VERSION}`,
      alignment: 'center',
      fontSize: 8,
      color: '#666666',
      margin: [0, 12, 0, 0],
    }),
  };
}

export interface RenderedPdf {
  bytes: Buffer;
  sha256: string;
  templateVersion: string;
}

/**
 * Renders to a buffer. Prescriptions are a page or two, so the whole document is held in memory on
 * purpose: the alternative is streaming into storage without knowing the checksum until the end, and
 * the checksum is what the `documents` row is for.
 */
export async function renderPrescriptionPdf(input: RenderInput, fontDir?: string): Promise<RenderedPdf> {
  // Required lazily so that importing this module — which the API does, for the route's types — does not
  // pull pdfmake and its font machinery into a process that never renders anything.
  const { default: PdfPrinter } = (await import('pdfmake')) as unknown as {
    default: new (fonts: Record<string, { normal: string; bold: string }>) => {
      createPdfKitDocument: (def: unknown) => NodeJS.ReadableStream & { end: () => void };
    };
  };
  const printer = new PdfPrinter(pdfmakeFonts(fontDir));
  const doc = printer.createPdfKitDocument(documentDefinition(input));

  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve());
    doc.on('error', (e: Error) => reject(e));
    doc.end();
  });
  const bytes = Buffer.concat(chunks);
  return {
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    templateVersion: RX_TEMPLATE_VERSION,
  };
}
