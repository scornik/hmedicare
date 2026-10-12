import { describe, expect, it } from 'vitest';
import {
  MINIMIZATION_VERSION,
  type MinimizationInput,
  PhiMinimizationService,
  TokenMap,
} from '../../src/public/index';

/**
 * PHI minimization (AIPOL-004, Stage 7 mandatory test T8).
 *
 * The cases that matter are the ones where an identifier survives. A name written in a different
 * script from the stored one, a phone number typed with Bangla digits or spaces, a national ID inside
 * prose, a date the record does not hold. Each of those is a disclosure to a provider that may train
 * on what it receives, so each has a case here.
 *
 * The other half is fail-closed behaviour: the service must refuse rather than send a payload it is
 * unsure about, and the assertions below check that the refusal happens, not merely that the text
 * looks clean.
 */
const service = new PhiMinimizationService();

const input = (over: Partial<MinimizationInput> = {}): MinimizationInput => ({
  patient: { names: ['Rahim Uddin'] },
  encounterAnchorDate: '2026-10-12',
  sections: [{ key: 'note', contentType: 'text', text: 'Patient is well.' }],
  ...over,
});

const minimize = (over: Partial<MinimizationInput> = {}) => service.minimize(input(over));
const text = (over: Partial<MinimizationInput> = {}) => {
  const result = minimize(over);
  if (!result.ok) throw new Error(`minimization failed: ${result.error.reason}`);
  return result.value.sections.map((s) => s.text).join('\n');
};

describe('PhiMinimizationService: names', () => {
  it('replaces the stored Latin name, including a bare surname', () => {
    const out = text({
      sections: [
        { key: 'note', contentType: 'text', text: 'Rahim Uddin returned today. Uddin reports relief.' },
      ],
    });
    expect(out).toBe('⟦PATIENT⟧ returned today. ⟦PATIENT⟧ reports relief.');
  });

  it('replaces a Bangla-script name stored in Bangla', () => {
    const out = text({
      patient: { names: ['রহিম উদ্দিন'] },
      sections: [{ key: 'note', contentType: 'text', text: 'রহিম উদ্দিন আজ এসেছেন।' }],
    });
    // `\b` does not work across Bangla, which is why the replacement uses Unicode letter classes.
    expect(out).toContain('⟦PATIENT⟧');
    expect(out).not.toContain('রহিম');
  });

  it('replaces a Banglish spelling of a name stored in Bangla', () => {
    const out = text({
      patient: { names: ['রহিম'] },
      sections: [{ key: 'note', contentType: 'text', text: 'Rahim came in with a cough.' }],
    });
    // The transliteration variant is the point: half the staff type the Latin form.
    expect(out).toBe('⟦PATIENT⟧ came in with a cough.');
  });

  it('ignores a name fragment shorter than three characters', () => {
    // A two-letter needle matches inside ordinary words and would redact the clinical text itself.
    const out = text({
      patient: { names: ['Md Ali Hossain'] },
      sections: [{ key: 'note', contentType: 'text', text: 'Mild oedema, no admission needed.' }],
    });
    expect(out).toBe('Mild oedema, no admission needed.');
  });

  it('distinguishes related persons from the patient', () => {
    const out = text({
      relatedPersons: [{ names: ['Karim Mia'] }, { names: ['Fatema Begum'] }],
      sections: [
        {
          key: 'note',
          contentType: 'text',
          text: 'Rahim Uddin came with Karim Mia; Fatema Begum waited outside.',
        },
      ],
    });
    expect(out).toBe('⟦PATIENT⟧ came with ⟦RELATED_1⟧; ⟦RELATED_2⟧ waited outside.');
  });

  it('replaces facility and clinician names from the tenant dictionary', () => {
    const out = text({
      tenantDictionary: { facilityNames: ['Shapla Clinic'], clinicianNames: ['Dr Nasrin Akter'] },
      sections: [{ key: 'note', contentType: 'text', text: 'Seen at Shapla Clinic by Dr Nasrin Akter.' }],
    });
    expect(out).toContain('⟦FACILITY⟧');
    expect(out).toContain('⟦CLINICIAN⟧');
    expect(out).not.toContain('Shapla');
  });
});

describe('PhiMinimizationService: contacts and identifiers', () => {
  it('replaces a known phone number and one typed in prose', () => {
    const out = text({
      patient: { names: ['Rahim Uddin'], contacts: ['+8801700000123'] },
      sections: [
        {
          key: 'note',
          contentType: 'text',
          text: 'Call +8801700000123 or the brother on 01700000456.',
        },
      ],
    });
    expect(out).toBe('Call ⟦PHONE⟧ or the brother on ⟦PHONE⟧.');
  });

  it('replaces a phone number written with Bangla digits', () => {
    const out = text({
      sections: [{ key: 'note', contentType: 'text', text: 'মোবাইল ০১৭০০০০০১২৩' }],
    });
    // A Bangla-digit number is a phone number to a reader and invisible to an ASCII pattern, so the
    // scan normalizes first and the replacement matches either script.
    expect(out).toContain('⟦PHONE⟧');
    expect(out).not.toMatch(/[০-৯]/u);
  });

  it('replaces a phone number typed with separators', () => {
    const out = text({
      sections: [{ key: 'note', contentType: 'text', text: 'Reach her on 017-0000 0123 today.' }],
    });
    expect(out).toContain('⟦PHONE⟧');
    expect(out).not.toContain('0123');
  });

  it('replaces an email address', () => {
    const out = text({
      sections: [{ key: 'note', contentType: 'text', text: 'Sent to rahim.uddin@example.net.' }],
    });
    expect(out).toBe('Sent to ⟦EMAIL⟧.');
  });

  it('replaces a national ID digit run and a known MRN', () => {
    const out = text({
      patient: {
        names: ['Rahim Uddin'],
        identifiers: [{ category: 'MRN', value: 'MRN-55012' }],
      },
      sections: [{ key: 'note', contentType: 'text', text: 'NID 1990123456789 on file, chart MRN-55012.' }],
    });
    expect(out).toContain('⟦ID⟧');
    expect(out).toContain('⟦MRN⟧');
    expect(out).not.toContain('1990123456789');
  });

  it('leaves clinical numbers alone', () => {
    const out = text({
      sections: [
        {
          key: 'note',
          contentType: 'text',
          text: 'BP 130/85, pulse 92, metformin 500 mg twice daily, HbA1c 7.8.',
        },
      ],
    });
    // Doses, vitals and lab values are digit runs too. Redacting them would strip the clinical content
    // the payload exists to carry, so only runs that classify as a phone number or an identifier
    // length are replaced.
    expect(out).toBe('BP 130/85, pulse 92, metformin 500 mg twice daily, HbA1c 7.8.');
  });

  it('over-redacts rather than under-redacts a word that shares a name’s skeleton', () => {
    const out = text({
      patient: { names: ['Rahim'] },
      sections: [{ key: 'note', contentType: 'text', text: 'Patient has a rheum complaint.' }],
    });
    // `rheum` and `rahim` reduce to the same skeleton. The context lost here is the price of catching
    // the Banglish spelling of a name; the other direction would send the name to a provider that may
    // train on it. Recorded as a test so the trade-off is visible rather than discovered later.
    expect(out).toBe('Patient has a ⟦PATIENT⟧ complaint.');
  });

  it('replaces known address lines', () => {
    const out = text({
      patient: { names: ['Rahim Uddin'], addressLines: ['House 12, Road 4, Dhanmondi'] },
      sections: [{ key: 'note', contentType: 'text', text: 'Lives at House 12, Road 4, Dhanmondi now.' }],
    });
    expect(out).toContain('⟦ADDRESS⟧');
    expect(out).not.toContain('Dhanmondi');
  });
});

describe('PhiMinimizationService: dates', () => {
  it('converts structured history dates to relative days', () => {
    const out = text({
      sections: [
        {
          key: 'history',
          contentType: 'history_items',
          items: [
            { occurredOn: '2026-10-12', text: 'Consultation' },
            { occurredOn: '2026-10-05', text: 'Blood test' },
          ],
        },
      ],
    });
    expect(out).toBe('⟦DAY0⟧: Consultation\n⟦DAY−7⟧: Blood test');
  });

  it.each([
    ['2026-09-12', 30],
    ['12/09/2026', 30],
    ['12 Sep 2026', 30],
    ['12 September 2026', 30],
  ])('converts the free-text date %s', (written, days) => {
    const out = text({
      sections: [{ key: 'note', contentType: 'text', text: `Symptoms began ${written}.` }],
    });
    expect(out).toBe(`Symptoms began ⟦DAY−${days}⟧.`);
  });

  it('converts a Bangla month name', () => {
    const out = text({
      sections: [{ key: 'note', contentType: 'text', text: 'শুরু ১২ সেপ্টেম্বর ২০২৬ তারিখে।' }],
    });
    // Digits are normalized before the date pattern runs, so the Bangla form reaches it as `12 … 2026`.
    expect(out).toContain('⟦DAY−30⟧');
    expect(out).not.toContain('২০২৬');
  });

  it('reads an ambiguous slash date day-first, as written in Bangladesh', () => {
    const out = text({
      encounterAnchorDate: '2026-04-10',
      sections: [{ key: 'note', contentType: 'text', text: 'Since 03/04/2026.' }],
    });
    // 3 April, seven days before the anchor. Reading it as 3 March would shift the relative day, and
    // nothing in the text says which was meant.
    expect(out).toBe('Since ⟦DAY−7⟧.');
  });

  it('turns a date of birth into an age and never sends the date', () => {
    const result = minimize({ patient: { names: ['Rahim Uddin'], dateOfBirth: '1990-06-01' } });
    expect(result.ok && result.value.patientAge).toBe('36');
    expect(JSON.stringify(result.ok && result.value.sections)).not.toContain('1990');
  });

  it('collapses an age of 90 or more', () => {
    const result = minimize({ patient: { names: ['Rahim Uddin'], dateOfBirth: '1930-01-01' } });
    // An exact age that high identifies a person on its own in a small population.
    expect(result.ok && result.value.patientAge).toBe('90+');
  });
});

describe('PhiMinimizationService: fail-closed', () => {
  it('refuses an unknown section content type', () => {
    const result = service.minimize({
      ...input(),
      // Retrieval produced something this service has not been taught to read.
      sections: [{ key: 'scan', contentType: 'image', text: 'x' } as never],
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatchObject({
      errorClass: 'PHI_MINIMIZATION_FAILED',
      reason: 'UNKNOWN_CONTENT_TYPE',
    });
  });

  it('refuses an unusable anchor date', () => {
    const result = minimize({ encounterAnchorDate: 'last Tuesday' });
    expect(!result.ok && result.error.reason).toBe('INVALID_ANCHOR_DATE');
  });

  it('refuses a payload over the template budget', () => {
    const result = minimize({
      sections: [{ key: 'note', contentType: 'text', text: 'a'.repeat(500) }],
      maxInputCharacters: 100,
    });
    // Checked after replacement: placeholders can be longer than what they replaced.
    expect(!result.ok && result.error.reason).toBe('INPUT_BUDGET_EXCEEDED');
  });

  it('never reports the text that failed', () => {
    const result = minimize({ encounterAnchorDate: 'nonsense' });
    // The reason is a rule name. An error body quoting the clinical text would put it wherever the
    // error goes.
    expect(JSON.stringify(!result.ok && result.error)).not.toContain('nonsense');
  });

  it('reports the categories and counts it replaced, and nothing else', () => {
    const result = minimize({
      patient: { names: ['Rahim Uddin'], contacts: ['+8801700000123'] },
      sections: [
        {
          key: 'note',
          contentType: 'text',
          text: 'Rahim Uddin on +8801700000123; Rahim Uddin again.',
        },
      ],
    });
    expect(result.ok && result.value.report).toEqual({
      categories: [
        { category: 'PATIENT_NAME', count: 2 },
        { category: 'PHONE', count: 1 },
      ],
      residualScanPassed: true,
      version: MINIMIZATION_VERSION,
    });
    // Counts and categories only (§5.1): a report holding the values would be a second copy of them.
    expect(JSON.stringify(result.ok && result.value.report)).not.toContain('Rahim');
  });
});

describe('PhiMinimizationService: the token map', () => {
  it('withholds itself from serialization', () => {
    const result = minimize();
    // Never persisted, logged or queued. This is what makes a mistake elsewhere harmless.
    expect(JSON.stringify(result.ok && result.value.tokenMap)).toBe('"[token map withheld]"');
  });

  it('maps a placeholder that stood for exactly one value', () => {
    const result = minimize();
    expect(result.ok && result.value.tokenMap.get('⟦PATIENT⟧')).toBe('Rahim Uddin');
  });

  it('leaves a placeholder unmapped where it covered several values', () => {
    const result = minimize({
      tenantDictionary: { clinicianNames: ['Dr Nasrin Akter', 'Dr Imran Hossain'] },
    });
    // Restoring one of two clinicians would put the wrong name into a clinical draft.
    expect(result.ok && result.value.tokenMap.has('⟦CLINICIAN⟧')).toBe(false);
  });
});

describe('PhiMinimizationService: restore', () => {
  it('restores mapped tokens and converts relative days back to dates', () => {
    const map = new TokenMap().set('⟦PATIENT⟧', 'Rahim Uddin');
    const restored = service.restoreText(
      '⟦PATIENT⟧ improved by ⟦DAY−7⟧ and was seen on ⟦DAY0⟧.',
      map,
      '2026-10-12',
    );
    expect(restored.text).toBe('Rahim Uddin improved by 2026-10-05 and was seen on 2026-10-12.');
    expect(restored.unresolved).toEqual([]);
  });

  it('leaves a hallucinated token visible and reports it', () => {
    const restored = service.restoreText('Discussed with ⟦RELATED_9⟧.', new TokenMap(), '2026-10-12');
    // The caller turns this into confidence='LOW'. Guessing at what the model meant would be worse
    // than showing the placeholder.
    expect(restored.text).toBe('Discussed with ⟦RELATED_9⟧.');
    expect(restored.unresolved).toEqual(['⟦RELATED_9⟧']);
  });

  it('round-trips Bangla note text unchanged', () => {
    const out = text({
      patient: { names: ['রহিম'] },
      sections: [{ key: 'note', contentType: 'text', text: 'রহিম এর জ্বর কমেছে।' }],
    });
    const restored = service.restoreText(out, new TokenMap().set('⟦PATIENT⟧', 'রহিম'), '2026-10-12');
    expect(restored.text).toBe('রহিম এর জ্বর কমেছে।');
  });
});
