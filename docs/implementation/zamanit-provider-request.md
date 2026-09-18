# Zaman IT — technical and security request (email template)

**Use:** send from the Hakeemify account owner's registered email to Zaman IT support. Fill the `<…>` placeholders. **Never include the API key**, only the account username. Record the answers in `ZAMANIT-VERIFICATION.md` §3.

---

**Subject:** API security and technical questions for account `<ACCOUNT_USERNAME>`

Dear Zaman IT Support Team,

We are integrating your SMS API into Hakeemify, a healthcare appointment and patient communication platform, for one-time passwords and appointment notifications. Before going live, we need to confirm a few security and technical details.

**1. HTTPS endpoint.** The API base URL shown in our dashboard is `http://103.89.240.228/api/`. Is an HTTPS endpoint with a valid certificate available, preferably on a hostname? Because our messages include login codes, we cannot send the API key and message text over plain HTTP in production without a documented risk acceptance.

**2. IP allow-listing.** Can our account restrict API use to a fixed list of server IP addresses? Our sending server's public IP is `<HOSTINGER_EGRESS_IP>`.

**3. POST requests.** We will call the API only with POST and a form-encoded body (`application/x-www-form-urlencoded`), so the key never appears in URLs. Please confirm that `sendsms` and `checkbalance` accept this.

**4. Response format.** Please share the exact success and error response formats (body and content type) for `sendsms` and `checkbalance`. In particular:
- Is a message ID returned for each accepted message?
- How are error codes 1001–1007 returned?

**5. Delivery reports.** Do you provide delivery reports (a callback/webhook or a report API)? If so, please share the format and how callbacks are authenticated.

**6. Rate limits.** What are the rate limits per account (messages per second or minute)? What response do we get when we exceed them?

**7. Segments and billing.** What are the character limits per segment for `text` and `unicode` (Bangla) messages? Is billing per segment, and are we charged for undelivered messages?

**8. Sender ID.** What are the rules and approval time for a masking sender ID (for example "HMedic") versus non-masking? What is the status of our sender ID request `<SENDER_ID_REQUEST_REF>`?

**9. Routes.** Is our account on a transactional/OTP route? Are there sending-hour or DND restrictions for OTP and appointment reminders?

**10. Duplicates.** Is there any way to prevent duplicate sends if we retry after a timeout (for example a client reference or idempotency key)?

**11. Multiple recipients.** If a request contains several numbers joined by `+` and some are invalid, what happens to the valid ones? (We plan to send one recipient per request.)

**12. Key handling.** Is the API key stored in your request logs or shown in dashboard reports? Is there an audit log of key regenerations?

We will not send any medical information in SMS text.

Thank you,
`<NAME>`
`<ROLE>`, Hakeemify
`<CONTACT_PHONE>`
