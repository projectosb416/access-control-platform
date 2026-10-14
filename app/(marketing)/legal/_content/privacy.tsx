import { LegalDocument } from '../_components/legal-document'
import type { Section } from '../_components/legal-document'
import { LEGAL_EFFECTIVE_DATE } from '@/lib/legal/version'

/**
 * Privacy Policy — draft v1, 2026-10-13.
 *
 * This copy is a draft pending review by a qualified Nigerian lawyer.
 * It describes what the platform does today. Categories of data not
 * yet collected are listed explicitly under "Data we do not currently
 * collect" so the policy stays truthful as features ship.
 *
 * When this document changes materially, bump LEGAL_CONSENT_VERSION
 * in lib/legal/version.ts.
 *
 * [DATE] placeholders to fill after lawyer review:
 *   - Effective date
 *   - Registered office address (appears twice)
 *   - DPO name or "not yet appointed"
 */

const SECTIONS: Section[] = [
  {
    type: 'p',
    text: (
      <>
        e-shomer (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;)
        provides physical access control software for residential
        estates, apartment buildings, and similar properties. This
        policy explains what personal data we collect, why we collect
        it, how long we keep it, who we share it with, and your rights
        under the Nigeria Data Protection Act 2023
        (&ldquo;NDPA&rdquo;).
      </>
    ),
  },
  {
    type: 'p',
    text: (
      <>
        <strong>Controller.</strong> e-shomer is the data controller
        for the personal data described in this policy. Contact:{' '}
        <a
          href="mailto:privacy@e-shomer.com"
          className="underline underline-offset-4"
        >
          privacy@e-shomer.com
        </a>
        . Address: [REGISTERED OFFICE ADDRESS].
      </>
    ),
  },

  { type: 'h2', text: '1. Who this policy covers' },
  {
    type: 'p',
    text: 'This policy covers:',
  },
  {
    type: 'list',
    items: [
      <>
        <strong>Estate administrators and their staff</strong> who
        create and manage an account on e-shomer.
      </>,
      <>
        <strong>Residents</strong> of estates using e-shomer.
      </>,
      <>
        <strong>Guards and other gate operators</strong> whose activity
        is recorded at estate gates.
      </>,
      <>
        <strong>Visitors, vendors, and contractors</strong> who receive
        a PIN credential to enter an estate.
      </>,
      <>
        <strong>Platform owners</strong> of e-shomer itself.
      </>,
    ],
  },
  {
    type: 'p',
    text: (
      <>
        If you are a resident or a visitor at an estate using e-shomer,
        the estate is the data controller for your data. e-shomer is a
        data processor acting on the estate&rsquo;s instructions.
        Requests about your data should be directed to the estate in
        the first instance; we will assist the estate in responding.
      </>
    ),
  },

  { type: 'h2', text: '2. What we collect' },
  {
    type: 'p',
    text: (
      <>
        <strong>Account data.</strong> Name, email address, phone
        number (optional), password hash, account status, signup
        timestamp, and — for estate administrators — the estate&rsquo;s
        name and organisation type.
      </>
    ),
  },
  {
    type: 'p',
    text: (
      <>
        <strong>Estate and property data.</strong> Property names, unit
        numbers, gate names, guard shift records. This data identifies
        physical places, not people, but may be combined with access
        events to identify who entered where.
      </>
    ),
  },
  {
    type: 'p',
    text: (
      <>
        <strong>Access credentials.</strong> Six-digit PIN credentials
        issued to residents, visitors, and vendors. Credentials are
        stored hashed; the underlying PIN is never stored in plain
        text.
      </>
    ),
  },
  {
    type: 'p',
    text: (
      <>
        <strong>Access events.</strong> Every entry attempt, exit
        attempt, and gate operator action. This includes the credential
        used, the gate, the guard on shift, the timestamp, the result
        (granted, denied, unresolved), and any reason recorded.
      </>
    ),
  },
  {
    type: 'p',
    text: (
      <>
        <strong>Payment data.</strong> When an estate pays for a
        subscription: the amount, currency, status, provider reference,
        and — for card payments — a tokenised record held by our
        payment processor (Paystack).{' '}
        <strong>
          We do not store full card numbers, CVVs, or bank account
          credentials.
        </strong>{' '}
        Those are held by Paystack and their banking partners.
      </>
    ),
  },
  {
    type: 'p',
    text: (
      <>
        <strong>Technical data.</strong> IP address, user-agent string,
        request path, and timestamp, logged by our infrastructure
        provider (Cloudflare) when you access the service.
      </>
    ),
  },
  {
    type: 'p',
    text: (
      <>
        <strong>Error data.</strong> When the software encounters an
        unexpected error, we capture a stack trace, the account ID
        associated with the request, and the environment name, via our
        error-tracking provider (Sentry).
      </>
    ),
  },

  { type: 'h2', text: '3. Data we do not currently collect' },
  {
    type: 'p',
    text: (
      <>
        To be explicit about the scope of this policy: e-shomer does{' '}
        <strong>not</strong> currently collect:
      </>
    ),
  },
  {
    type: 'list',
    items: [
      'Product usage telemetry (feature clicks, session recordings, page-view analytics).',
      'Marketing or advertising identifiers.',
      'Data from cookies set for advertising or cross-site tracking.',
      'Customer relationship management (CRM) or sales pipeline data about prospective customers.',
      'Biometric data of any kind.',
    ],
  },
  {
    type: 'p',
    text: (
      <>
        If we begin collecting any of the above in future, this policy
        will be updated, the update will be announced in-product, and
        existing users will be asked to review the change.
      </>
    ),
  },

  { type: 'h2', text: '4. Why we process your data' },
  {
    type: 'p',
    text: (
      <>
        We process personal data on the following lawful bases under
        Section 25 of the NDPA:
      </>
    ),
  },
  {
    type: 'table',
    headers: ['Purpose', 'Lawful basis'],
    rows: [
      ['Creating and administering your account', 'Performance of a contract'],
      ['Processing subscription payments', 'Performance of a contract'],
      ['Recording gate access events', 'Performance of a contract (with the estate)'],
      ['Preventing unauthorised access, fraud, and abuse', 'Legitimate interest'],
      ['Maintaining security logs and responding to incidents', 'Legitimate interest'],
      ['Complying with tax, accounting, and legal obligations', 'Legal obligation'],
      ['Internal analytics on operational data (MRR, active estates)', 'Legitimate interest'],
      ['Responding to your data-subject requests', 'Legal obligation'],
    ],
  },
  {
    type: 'p',
    text: (
      <>
        Where we rely on legitimate interest, we have carried out a
        Legitimate Interest Assessment (LIA) and can provide a summary
        on request.
      </>
    ),
  },

  { type: 'h2', text: '5. Who we share data with' },
  {
    type: 'p',
    text: (
      <>
        We share personal data with the following service providers,
        each of whom processes data on our behalf under written
        contract:
      </>
    ),
  },
  {
    type: 'list',
    items: [
      <><strong>Supabase</strong> — database hosting, authentication. Data stored in the EU (eu-west-1).</>,
      <><strong>Cloudflare</strong> — web application hosting, edge network, request logging.</>,
      <><strong>Paystack</strong> — payment processing (Nigeria).</>,
      <><strong>Sentry</strong> — error tracking.</>,
      <><strong>Brevo</strong> (planned) — transactional email delivery.</>,
    ],
  },
  {
    type: 'p',
    text: (
      <>
        We also disclose data where required by Nigerian law, court
        order, or a lawful request from a regulator.
      </>
    ),
  },
  {
    type: 'p',
    text: (
      <>
        <strong>We do not sell personal data. We do not share personal
        data with advertisers.</strong>
      </>
    ),
  },

  { type: 'h2', text: '6. Cross-border transfers' },
  {
    type: 'p',
    text: (
      <>
        Some of our service providers store data outside Nigeria —
        currently in the European Union (Supabase&rsquo;s eu-west-1
        region) and in Cloudflare&rsquo;s global edge network. Where
        data is transferred outside Nigeria, we rely on the NDPA&rsquo;s
        cross-border transfer provisions and ensure that the receiving
        jurisdiction offers an adequate level of protection, or that
        appropriate safeguards are in place.
      </>
    ),
  },

  { type: 'h2', text: '7. How long we keep data' },
  {
    type: 'list',
    items: [
      <><strong>Account data:</strong> for the lifetime of the account, plus 90 days after account closure.</>,
      <><strong>Access events:</strong> for as long as the estate&rsquo;s subscription is active, plus 12 months. Estates may configure a shorter retention period.</>,
      <><strong>Payment records:</strong> 7 years, to comply with Nigerian tax and accounting requirements.</>,
      <><strong>Technical logs (IP, user-agent):</strong> 30 days.</>,
      <><strong>Error events:</strong> 90 days.</>,
    ],
  },

  { type: 'h2', text: '8. Your rights' },
  {
    type: 'p',
    text: 'Under Sections 34–38 of the NDPA you have the right to:',
  },
  {
    type: 'list',
    items: [
      'Be informed about how your data is processed.',
      'Access a copy of the personal data we hold about you.',
      'Request correction of inaccurate data.',
      'Request deletion of your data, where no lawful basis requires us to keep it.',
      'Restrict or object to certain processing.',
      'Receive your data in a portable, structured format.',
      'Lodge a complaint with the Nigeria Data Protection Commission.',
    ],
  },
  {
    type: 'p',
    text: (
      <>
        To exercise any of these rights, contact{' '}
        <a
          href="mailto:privacy@e-shomer.com"
          className="underline underline-offset-4"
        >
          privacy@e-shomer.com
        </a>
        . We will respond within 30 days.
      </>
    ),
  },
  {
    type: 'p',
    text: (
      <>
        <strong>Residents and visitors:</strong> your data is held by
        the estate as controller. Requests should be directed to the
        estate in the first instance. Where the estate requires our
        assistance, we will cooperate.
      </>
    ),
  },

  { type: 'h2', text: '9. Cookies' },
  {
    type: 'p',
    text: (
      <>
        e-shomer uses cookies strictly necessary for authentication and
        session management. We do not use advertising or tracking
        cookies. If we begin using analytics cookies in future, we will
        ask for your consent before setting them and update this
        section.
      </>
    ),
  },

  { type: 'h2', text: '10. Security' },
  {
    type: 'p',
    text: (
      <>
        We apply industry-standard security measures, including:
        encryption in transit (HTTPS/TLS), hashed storage of
        credentials, access controls scoped by role, append-only audit
        logs, and signature-verified payment webhooks. No system is
        perfectly secure; if we become aware of a breach affecting your
        data, we will notify you and the Nigeria Data Protection
        Commission as required by the NDPA.
      </>
    ),
  },

  { type: 'h2', text: '11. Changes to this policy' },
  {
    type: 'p',
    text: (
      <>
        If we change this policy in a way that materially affects your
        rights, we will notify you in-product and update the
        &ldquo;Last updated&rdquo; date above. Continued use of the
        service after the effective date of a change constitutes
        acceptance of the updated policy.
      </>
    ),
  },

  { type: 'h2', text: '12. Contact' },
  {
    type: 'list',
    items: [
      <>Questions or requests: privacy@e-shomer.com</>,
      <>Registered address: [REGISTERED OFFICE ADDRESS]</>,
      <>Data Protection Officer: [DPO NAME OR &ldquo;not yet appointed — contact via the address above&rdquo;]</>,
    ],
  },
]

export function PrivacyContent() {
  return (
    <LegalDocument
      title="Privacy Policy"
      effectiveDate={LEGAL_EFFECTIVE_DATE}
      sections={SECTIONS}
    />
  )
}
