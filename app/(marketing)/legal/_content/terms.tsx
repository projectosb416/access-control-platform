import { LegalDocument } from '../_components/legal-document'
import type { Section } from '../_components/legal-document'
import { LEGAL_EFFECTIVE_DATE } from '@/lib/legal/version'

/**
 * Terms of Service — draft v1, 2026-10-13.
 *
 * Draft pending review by a qualified Nigerian lawyer. Sections 11
 * (Limitation of liability), 12 (Indemnity), and 15 (Governing law)
 * are intentionally stubbed for the lawyer to draft — they are the
 * three clauses a non-lawyer should not author.
 *
 * [DATE] placeholders to fill after lawyer review:
 *   - Effective date (via LEGAL_EFFECTIVE_DATE)
 *   - Registered entity name
 *   - CAC registration number
 *   - Grace-period numbers in Section 5 (30 / 14)
 *   - Registered office address
 */

const SECTIONS: Section[] = [
  {
    type: 'p',
    text: (
      <>
        These Terms govern your use of e-shomer, the physical access
        control platform for residential estates
        (&ldquo;Service&rdquo;). By creating an account, accepting an
        invitation, or using the Service, you agree to these Terms.
      </>
    ),
  },
  {
    type: 'p',
    text: (
      <>
        <strong>Operator.</strong> The Service is operated by
        [REGISTERED ENTITY NAME] (&ldquo;we&rdquo;,
        &ldquo;us&rdquo;, &ldquo;our&rdquo;), registered in Nigeria
        under [CAC REGISTRATION NUMBER].
      </>
    ),
  },

  { type: 'h2', text: '1. Definitions' },
  {
    type: 'list',
    items: [
      <><strong>&ldquo;Estate&rdquo;</strong> — the residential or commercial property subscribing to the Service.</>,
      <><strong>&ldquo;Estate Admin&rdquo;</strong> — the individual authorised by an Estate to administer its account on e-shomer.</>,
      <><strong>&ldquo;Resident&rdquo;</strong> — a person occupying a unit in an Estate.</>,
      <><strong>&ldquo;Guard&rdquo;</strong> — a person operating a gate on behalf of an Estate.</>,
      <><strong>&ldquo;Visitor&rdquo;</strong> — a person receiving a PIN credential to enter an Estate.</>,
      <><strong>&ldquo;Credential&rdquo;</strong> — a six-digit PIN issued to a Resident, Visitor, or Vendor for the purpose of gate access.</>,
      <><strong>&ldquo;Access Event&rdquo;</strong> — a record of an entry or exit attempt at a gate.</>,
    ],
  },

  { type: 'h2', text: '2. The Service' },
  {
    type: 'p',
    text: (
      <>
        e-shomer provides server-authoritative physical access control.
        Guards process gate traffic using six-digit PIN credentials.
        Every attempt is logged. Exits are recorded as discrete events;
        sessions without a recorded exit remain open until resolved.
      </>
    ),
  },
  {
    type: 'p',
    text: (
      <>
        The Service is provided on a subscription basis to Estates.
        Individual users — Residents, Guards, Visitors — access the
        Service by invitation or credential and do not pay for it
        directly.
      </>
    ),
  },

  { type: 'h2', text: '3. Accounts and eligibility' },
  {
    type: 'p',
    text: (
      <>
        You must be at least 18 years old and legally competent to
        enter into these Terms.
      </>
    ),
  },
  {
    type: 'p',
    text: (
      <>
        <strong>Estate Admin accounts.</strong> By creating an Estate
        Admin account, you represent that you are authorised to bind
        the Estate to these Terms and to the subscription plan
        selected.
      </>
    ),
  },
  {
    type: 'p',
    text: (
      <>
        <strong>Credential holders.</strong> By using a PIN credential,
        you represent that you are the person to whom the credential
        was issued, or that you are acting with that person&rsquo;s
        consent.
      </>
    ),
  },
  {
    type: 'p',
    text: (
      <>
        You are responsible for maintaining the confidentiality of your
        credentials and account password. Notify us immediately at{' '}
        <a
          href="mailto:support@e-shomer.com"
          className="underline underline-offset-4"
        >
          support@e-shomer.com
        </a>{' '}
        if you suspect unauthorised access.
      </>
    ),
  },

  { type: 'h2', text: '4. Acceptable use' },
  {
    type: 'p',
    text: 'You agree not to:',
  },
  {
    type: 'list',
    items: [
      'Use the Service to gain unauthorised access to any property.',
      'Issue credentials to persons you know or suspect intend harm to persons or property at an Estate.',
      'Attempt to interfere with the Service\u2019s operation, security, or integrity.',
      'Reverse engineer, decompile, or attempt to derive the source code of the Service.',
      'Use the Service to violate any applicable law, including the Nigeria Data Protection Act 2023.',
      'Resell or sublicense the Service without our written permission.',
    ],
  },
  {
    type: 'p',
    text: (
      <>
        We reserve the right to suspend or terminate any account that
        violates this section.
      </>
    ),
  },

  { type: 'h2', text: '5. Subscriptions and billing' },
  {
    type: 'p',
    text: (
      <>
        <strong>Plans.</strong> Estate subscriptions are billed
        annually in advance. Current plans, features, and prices are
        shown on our pricing page.
      </>
    ),
  },
  {
    type: 'p',
    text: (
      <>
        <strong>Payment methods.</strong> We accept bank transfer
        (manual confirmation) and card payments via Paystack. Card
        details are handled by Paystack; we do not store full card
        numbers.
      </>
    ),
  },
  {
    type: 'p',
    text: (
      <>
        <strong>VAT.</strong> Prices are shown exclusive of VAT. VAT at
        the prevailing Nigerian rate is added at the point of invoice.
      </>
    ),
  },
  {
    type: 'p',
    text: (
      <>
        <strong>Renewal.</strong> Subscriptions renew automatically at
        the end of each billing cycle unless cancelled before the
        renewal date. Card-billed subscriptions renew automatically;
        manually-confirmed subscriptions require a new payment each
        cycle.
      </>
    ),
  },
  {
    type: 'p',
    text: (
      <>
        <strong>Non-payment.</strong> If payment for a renewal is not
        received within [30] days of the renewal date, the
        Estate&rsquo;s subscription becomes <strong>past due</strong>.
        If not settled within [14] further days, the subscription
        enters <strong>grace period</strong>. If still unpaid after
        grace period, the subscription becomes{' '}
        <strong>suspended</strong>: new activity (shifts, credentials,
        authorisations) cannot be created, but existing valid
        credentials and open shifts continue to function until they
        naturally end.
      </>
    ),
  },
  {
    type: 'p',
    text: (
      <>
        <strong>Cancellation.</strong> An Estate Admin may cancel at
        any time from the billing page. Cancellation is effective
        immediately and no refund is issued for the remaining period
        except as described in the Refund Policy. Existing shifts,
        valid credentials, and open sessions continue to function
        until naturally completed, per the &ldquo;no visitor trapped
        inside&rdquo; principle described in Section 7.
      </>
    ),
  },

  { type: 'h2', text: '6. Refunds' },
  {
    type: 'p',
    text: (
      <>
        Refunds are governed by our Refund Policy, which forms part of
        these Terms. The Refund Policy is available at /legal/refunds.
      </>
    ),
  },

  { type: 'h2', text: '7. Service availability and no-trapping principle' },
  {
    type: 'p',
    text: (
      <>
        We aim to keep the Service available continuously but do not
        guarantee uninterrupted operation. Outages may occur for
        maintenance, upstream provider failures, or events outside our
        control.
      </>
    ),
  },
  {
    type: 'p',
    text: (
      <>
        The Service is designed so that a network outage at a gate does
        not trap a Visitor inside a property. Guards retain physical
        control of gates at all times. When the Service is unreachable,
        gate operations continue manually; the corresponding Access
        Events are recorded as <strong>unresolved sessions</strong> and
        must be reconciled by the Estate Admin. We are not liable for
        operational delays caused by such outages, but we will assist
        with reconciliation.
      </>
    ),
  },

  { type: 'h2', text: '8. Data protection' },
  {
    type: 'p',
    text: (
      <>
        We process personal data in accordance with our Privacy Policy,
        available at /legal/privacy, and the Nigeria Data Protection
        Act 2023.
      </>
    ),
  },
  {
    type: 'p',
    text: (
      <>
        Where an Estate subscribes to the Service, the Estate is the
        data controller for personal data of its Residents, Guards, and
        Visitors. e-shomer is a data processor acting on the
        Estate&rsquo;s instructions.
      </>
    ),
  },

  { type: 'h2', text: '9. Intellectual property' },
  {
    type: 'p',
    text: (
      <>
        The Service, including its source code, design, and
        documentation, is owned by us and protected by Nigerian and
        international intellectual property laws. Nothing in these
        Terms grants you ownership of any part of the Service.
      </>
    ),
  },
  {
    type: 'p',
    text: (
      <>
        Estate data — organisations, properties, units, people,
        credentials, access events — belongs to the Estate. On
        termination, we will make Estate data available for export and
        retain it per the Privacy Policy.
      </>
    ),
  },

  { type: 'h2', text: '10. Warranties and disclaimers' },
  {
    type: 'p',
    text: (
      <>
        The Service is provided on an &ldquo;as is&rdquo; and
        &ldquo;as available&rdquo; basis. To the fullest extent
        permitted by Nigerian law, we disclaim all warranties, express
        or implied, including warranties of merchantability, fitness
        for a particular purpose, and non-infringement.
      </>
    ),
  },
  {
    type: 'p',
    text: (
      <>
        We do not warrant that the Service will be error-free,
        uninterrupted, or that all security incidents will be
        prevented. <strong>Physical security at an Estate is
        ultimately the responsibility of the Estate and its
        personnel.</strong>
      </>
    ),
  },
  {
    type: 'p',
    text: (
      <>
        Nothing in these Terms excludes or limits liability for death
        or personal injury caused by our negligence, fraud, or any
        other liability that cannot lawfully be excluded.
      </>
    ),
  },

  { type: 'h2', text: '11. Limitation of liability' },
  {
    type: 'p',
    text: (
      <>
        <em>
          [LAWYER TO DRAFT — recommended structure: total aggregate
          liability capped at fees paid by the Estate in the 12 months
          preceding the claim; exclusion of indirect, consequential,
          and special damages. Nigerian law review required.]
        </em>
      </>
    ),
  },

  { type: 'h2', text: '12. Indemnity' },
  {
    type: 'p',
    text: (
      <>
        <em>
          [LAWYER TO DRAFT — recommended structure: you agree to
          indemnify us against claims arising from your misuse of the
          Service, your violation of these Terms, or your violation of
          any third party&rsquo;s rights.]
        </em>
      </>
    ),
  },

  { type: 'h2', text: '13. Termination' },
  {
    type: 'p',
    text: (
      <>
        We may suspend or terminate your access at any time for
        material breach of these Terms, non-payment per Section 5, or
        where required by law.
      </>
    ),
  },
  {
    type: 'p',
    text: 'You may terminate by cancelling your subscription per Section 5.',
  },
  {
    type: 'p',
    text: (
      <>
        On termination, your right to access the Service ends.
        Sections 8 through 15 survive termination.
      </>
    ),
  },

  { type: 'h2', text: '14. Changes to these Terms' },
  {
    type: 'p',
    text: (
      <>
        If we make material changes, we will notify Estate Admins
        in-product before the change takes effect. Continued use after
        the effective date constitutes acceptance.
      </>
    ),
  },

  { type: 'h2', text: '15. Governing law and jurisdiction' },
  {
    type: 'p',
    text: (
      <>
        <em>
          [LAWYER TO DRAFT — recommended: these Terms are governed by
          the laws of the Federal Republic of Nigeria. Disputes are
          subject to the exclusive jurisdiction of the courts of
          [Lagos State / Federal Capital Territory / other]. The lawyer
          may recommend arbitration under the Arbitration and
          Mediation Act 2023 for commercial disputes.]
        </em>
      </>
    ),
  },

  { type: 'h2', text: '16. Contact' },
  {
    type: 'list',
    items: [
      <>Legal notices: legal@e-shomer.com</>,
      <>Support: support@e-shomer.com</>,
      <>Registered address: [REGISTERED OFFICE ADDRESS]</>,
    ],
  },
]

export function TermsContent() {
  return (
    <LegalDocument
      title="Terms of Service"
      effectiveDate={LEGAL_EFFECTIVE_DATE}
      sections={SECTIONS}
    />
  )
}
