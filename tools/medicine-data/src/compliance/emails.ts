import type { SourceConfig } from '../config.js';
import type { Review } from './gate.js';

/** Data-licensing request (English and Bangla). {{CONTACT_EMAIL}} and {{SENDER_NAME}} are filled in by the sender. */
export function permissionRequest(source: SourceConfig, review: Review): string {
  const isApp = source.type === 'app';
  const owner = isApp ? 'IT Medicus Solutions (DIMS)' : source.name;
  const what = isApp
    ? 'a licensed data feed (for example a periodic CSV/JSON export) of DIMS brand, generic, strength, dosage form, manufacturer and pack/price facts'
    : `permission to use factual product attributes published on ${source.origin} (brand name, generic name, strength, dosage form, manufacturer, pack size and listed price), or a licensed data feed`;
  const whatBn = isApp
    ? 'DIMS-এর ব্র্যান্ড, জেনেরিক, স্ট্রেন্থ, ডোজেস ফর্ম, প্রস্তুতকারক এবং প্যাক/মূল্য সংক্রান্ত তথ্যের একটি লাইসেন্সকৃত ডেটা ফিড (যেমন নিয়মিত CSV/JSON এক্সপোর্ট)'
    : `${source.origin}-এ প্রকাশিত ওষুধের তথ্যভিত্তিক বৈশিষ্ট্য (ব্র্যান্ড নাম, জেনেরিক নাম, স্ট্রেন্থ, ডোজেস ফর্ম, প্রস্তুতকারক, প্যাক সাইজ ও তালিকাভুক্ত মূল্য) ব্যবহারের অনুমতি, অথবা একটি লাইসেন্সকৃত ডেটা ফিড`;
  return `# Data-licensing request: ${source.id}

- To: ${review.permission_contact ?? 'verify official contact before sending'}
- From: Hakeemify ({{CONTACT_EMAIL}})
- Status: DRAFT, not sent. Review, fill placeholders, and send manually.
- Why: compliance verdict for this source prohibits automated access or reuse without permission (see \`${source.id}.md\`).

---

## English

**Subject:** Data licensing request from Hakeemify: medicine catalogue facts

Dear ${owner} team,

My name is {{SENDER_NAME}} and I am writing on behalf of Hakeemify, a Bangladeshi health-technology team building a prescription-writing tool for doctors.

To help doctors find medicines accurately, we would like to request ${what}.

We have read your terms of use and we have **not** collected data from your ${isApp ? 'app' : 'website'}. We would like to work with your permission. In particular:

- We would use only factual catalogue attributes. We would not use monograph text (indications, dosage, side effects), images, reviews or any personal data.
- ${source.name} would be credited as a catalogue source inside the product, wherever you prefer.
- We can sign a data-licensing agreement and agree on update frequency, attribution and any fees.
- Any data we receive would be reviewed by a pharmacist before clinical use. It would never be shown as dosing guidance.

Could you let us know whether this is possible, and who the right person is to discuss terms?

Thank you for your time.

Kind regards,
{{SENDER_NAME}}
Hakeemify · {{CONTACT_EMAIL}}

---

## বাংলা

**বিষয়:** Hakeemify-এর পক্ষ থেকে ওষুধের ক্যাটালগ তথ্য ব্যবহারের লাইসেন্সের অনুরোধ

প্রিয় ${owner} টিম,

আমি {{SENDER_NAME}}, Hakeemify-এর পক্ষ থেকে লিখছি। আমরা বাংলাদেশের একটি স্বাস্থ্য-প্রযুক্তি দল, চিকিৎসকদের জন্য একটি প্রেসক্রিপশন লেখার টুল তৈরি করছি।

চিকিৎসকরা যাতে সঠিকভাবে ওষুধ খুঁজে পান, সেজন্য আমরা ${whatBn} চাইছি।

আমরা আপনাদের ব্যবহারের শর্তাবলী পড়েছি এবং আপনাদের ${isApp ? 'অ্যাপ' : 'ওয়েবসাইট'} থেকে কোনো তথ্য সংগ্রহ **করিনি**। আমরা আপনাদের অনুমতি নিয়েই কাজ করতে চাই। বিশেষভাবে:

- আমরা শুধু তথ্যভিত্তিক ক্যাটালগ বৈশিষ্ট্য ব্যবহার করব। মনোগ্রাফের লেখা (নির্দেশনা, ডোজ, পার্শ্বপ্রতিক্রিয়া), ছবি, রিভিউ বা কোনো ব্যক্তিগত তথ্য ব্যবহার করব না।
- প্রোডাক্টের ভেতরে আপনাদের পছন্দমতো স্থানে ${source.name}-কে ক্যাটালগ উৎস হিসেবে উল্লেখ করা হবে।
- আমরা ডেটা লাইসেন্স চুক্তিতে স্বাক্ষর করতে এবং হালনাগাদের সময়সূচি, কৃতজ্ঞতা স্বীকার ও প্রযোজ্য ফি নিয়ে আলোচনা করতে প্রস্তুত।
- প্রাপ্ত যেকোনো তথ্য ক্লিনিক্যাল ব্যবহারের আগে একজন ফার্মাসিস্ট যাচাই করবেন। এটি কখনো ডোজ নির্দেশনা হিসেবে দেখানো হবে না।

এটি সম্ভব কি না এবং বিষয়টি নিয়ে কার সাথে আলোচনা করা উচিত, অনুগ্রহ করে জানাবেন।

আপনার সময়ের জন্য ধন্যবাদ।

শুভেচ্ছান্তে,
{{SENDER_NAME}}
Hakeemify · {{CONTACT_EMAIL}}
`;
}
