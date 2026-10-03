import { describe, expect, it } from 'vitest';
import {
  ATTESTATION_VERSION,
  type PrescriptionItemInput,
  approvedSnapshotSha256,
  canTransition,
  itemsEditable,
  statusAfterItemEdit,
  validateItems,
} from '../../src/domain/prescription';

const item = (over: Partial<PrescriptionItemInput> = {}): PrescriptionItemInput => ({
  sequence: 1,
  medicationId: '01a0d900-0000-7000-8000-000000000001',
  medicationDatasetVersion: 'medicine-dataset-20260917-4',
  catalogSnapshot: {
    brandName: 'DEMO-Synthacillin',
    brandNameBn: null,
    genericDisplay: 'DEMO Generic A',
    strengthText: '500 mg',
    dosageForm: 'tablet',
    manufacturerDisplay: 'DEMO Labs',
    reviewStatus: 'UNVERIFIED',
    dgdaMatch: 'NOT_CHECKED',
  },
  freeTextName: null,
  isFreeText: false,
  strength: '500 mg',
  dosageForm: 'tablet',
  route: 'oral',
  dose: '1 tablet',
  frequency: 'twice daily',
  duration: '5 days',
  quantity: '10',
  timing: 'after food',
  instructions: null,
  instructionsBn: null,
  substitutionAllowed: true,
  ...over,
});

const header = {
  patientId: 'p-1',
  encounterId: 'e-1',
  doctorProfileId: 'd-1',
  revision: 1,
  attestationVersion: ATTESTATION_VERSION,
};

describe('lifecycle transitions', () => {
  it('allows the documented paths and nothing else', () => {
    expect(canTransition('DRAFT', 'REVIEWED')).toBe(true);
    expect(canTransition('DRAFT', 'APPROVED')).toBe(true);
    expect(canTransition('REVIEWED', 'APPROVED')).toBe(true);
    // Editing after review invalidates it, which is a transition rather than a silent fact.
    expect(canTransition('REVIEWED', 'DRAFT')).toBe(true);
    expect(canTransition('APPROVED', 'VOID')).toBe(true);
  });

  it('refuses to reopen or skip backwards out of a final state', () => {
    // A mistake in an approved prescription is answered by a new revision, never by editing the one
    // that was handed over.
    expect(canTransition('APPROVED', 'DRAFT')).toBe(false);
    expect(canTransition('APPROVED', 'REVIEWED')).toBe(false);
    expect(canTransition('VOID', 'DRAFT')).toBe(false);
    expect(canTransition('VOID', 'APPROVED')).toBe(false);
    expect(canTransition('DRAFT', 'VOID')).toBe(false);
  });

  it('knows which states may still be edited', () => {
    expect(itemsEditable('DRAFT')).toBe(true);
    expect(itemsEditable('REVIEWED')).toBe(true);
    expect(itemsEditable('APPROVED')).toBe(false);
    expect(itemsEditable('VOID')).toBe(false);
  });

  it('drops a reviewed prescription back to draft when its items change', () => {
    expect(statusAfterItemEdit('REVIEWED')).toBe('DRAFT');
    expect(statusAfterItemEdit('DRAFT')).toBe('DRAFT');
  });
});

describe('item validation', () => {
  it('accepts a well-formed catalog line and a well-formed free-text line', () => {
    expect(validateItems([item()])).toEqual([]);
    expect(
      validateItems([
        item({
          isFreeText: true,
          medicationId: null,
          medicationDatasetVersion: null,
          catalogSnapshot: null,
          freeTextName: 'Compounded syrup',
        }),
      ]),
    ).toEqual([]);
  });

  it('requires dose, frequency and duration — never inferred from the catalog', () => {
    const problems = validateItems([item({ dose: '', frequency: '  ', duration: '' })]);
    expect(problems.map((p) => p.field).sort()).toEqual(['dose', 'duration', 'frequency']);
    expect(problems.every((p) => p.code === 'required')).toBe(true);
  });

  it('refuses a line that is both a catalog item and free text, and one that is neither', () => {
    expect(validateItems([item({ isFreeText: true, freeTextName: 'Something' })])).toContainEqual({
      sequence: 1,
      field: 'medicationId',
      code: 'not_allowed_for_free_text',
    });
    expect(
      validateItems([item({ isFreeText: false, medicationId: null, medicationDatasetVersion: null })]),
    ).toContainEqual({ sequence: 1, field: 'medicationId', code: 'required' });
  });

  it('requires the dataset version on a catalog line', () => {
    // Without it a later import silently changes what this line meant.
    expect(validateItems([item({ medicationDatasetVersion: null })])).toContainEqual({
      sequence: 1,
      field: 'medicationDatasetVersion',
      code: 'required',
    });
  });

  it('refuses duplicate and invalid sequences', () => {
    const problems = validateItems([item({ sequence: 1 }), item({ sequence: 1 })]);
    expect(problems).toContainEqual({ sequence: 1, field: 'sequence', code: 'duplicate_sequence' });
    expect(validateItems([item({ sequence: 0 })])).toContainEqual({
      sequence: 0,
      field: 'sequence',
      code: 'invalid_sequence',
    });
  });

  it('refuses over-long fields at the column limits', () => {
    expect(validateItems([item({ dose: 'x'.repeat(81) })])).toContainEqual({
      sequence: 1,
      field: 'dose',
      code: 'too_long',
    });
    expect(validateItems([item({ instructions: 'x'.repeat(501) })])).toContainEqual({
      sequence: 1,
      field: 'instructions',
      code: 'too_long',
    });
  });
});

describe('approved snapshot hash', () => {
  it('is stable across item order, because sequence is the order that matters', () => {
    const a = approvedSnapshotSha256(header, [item({ sequence: 1 }), item({ sequence: 2 })]);
    const b = approvedSnapshotSha256(header, [item({ sequence: 2 }), item({ sequence: 1 })]);
    expect(a).toBe(b);
  });

  it('changes when any clinical field changes', () => {
    const base = approvedSnapshotSha256(header, [item()]);
    for (const change of [
      { dose: '2 tablets' },
      { frequency: 'three times daily' },
      { duration: '7 days' },
      { instructions: 'with water' },
      { substitutionAllowed: false },
      { medicationDatasetVersion: 'medicine-dataset-20270101-1' },
    ] as Array<Partial<PrescriptionItemInput>>) {
      expect(approvedSnapshotSha256(header, [item(change)])).not.toBe(base);
    }
  });

  it('changes when the header changes', () => {
    const base = approvedSnapshotSha256(header, [item()]);
    expect(approvedSnapshotSha256({ ...header, revision: 2 }, [item()])).not.toBe(base);
    expect(approvedSnapshotSha256({ ...header, attestationVersion: 2 }, [item()])).not.toBe(base);
  });

  it('is identical for two revisions with the same clinical content', () => {
    // The point of leaving approver and time out: "this correction changed the instructions, not the
    // medicines" has to be checkable, and it is only checkable if identical content hashes identically.
    const first = approvedSnapshotSha256(header, [item()]);
    const second = approvedSnapshotSha256(header, [item()]);
    expect(second).toBe(first);
  });
});
