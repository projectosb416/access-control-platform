import { LegalDocument } from '../_components/legal-document'
import type { Section } from '../_components/legal-document'
import { LEGAL_EFFECTIVE_DATE } from '@/lib/legal/version'

/**
 * Refund Policy — draft v1, 2026-10-13.
 *
 * Draft pending review by a qualified Nigerian lawyer. The refund
 * conditions reflect the platform's shipped refund capability
 * (migration 0064 refund_payment) — refunds are issued at the
 * platform owner's discretion within the eligibility categories
 * below.
 *
 * [DATE] placeholders to fill after lawyer review:
 *   - Business-day windows in Section 4 (3 / 14)
 */

const SECTIONS: Section[] = [
  {
    type: 'p',
    text: (
      <>
        This Refund Policy forms part of the e-shomer Terms of Service.
        It describes when refunds are available for subscription
        payments made to e-shomer.
      </>
    ),
  },

  { type: 'h2', text: '1. Scope' },
  {
    type: 'p',
    text: (
      <>
        This policy applies to payments made by Estates (or prospective
        Estates) to e-shomer for subscription plans. It does not apply
        to refunds issued by an Estate to its own Residents or tenants
        — those are governed by the Estate&rsquo;s own policies.
      </>
    ),
  },

  { type: 'h2', text: '2. Eligibility for a refund' },
  {
    type: 'p',
    text: (
      <>
        Refunds may be issued in the following circumstances, at
        e-shomer&rsquo;s reasonable discretion:
      </>
    ),
  },
  {
    type: 'h3',
    text: '2.1 Non-delivery',
  },
  {
    type: 'p',
    text: (
      <>
        The subscription was paid for but the Service was not made
        available to the Estate for a material period, for reasons
        within our control.
      </>
    ),
  },
  {
    type: 'h3',
    text: '2.2 Duplicate charge',
  },
  {
    type: 'p',
    text: (
      <>
        The Estate was charged twice for the same subscription cycle
        due to a processing error.
      </>
    ),
  },
  {
    type: 'h3',
    text: '2.3 Billing error',
  },
  {
    type: 'p',
    text: 'The charge amount was incorrect due to an error on our part.',
  },
  {
    type: 'h3',
    text: '2.4 Unauthorised charge',
  },
  {
    type: 'p',
    text: (
      <>
        A payment was made without the Estate Admin&rsquo;s
        authorisation, and this is confirmed by investigation.
      </>
    ),
  },
  {
    type: 'h3',
    text: '2.5 Cancellation within a trial period',
  },
  {
    type: 'p',
    text: (
      <>
        Where the Estate cancels during an advertised free-trial
        period, and the trial was converted to a paid subscription in
        error, we will refund the misapplied charge.
      </>
    ),
  },
  {
    type: 'h3',
    text: '2.6 Required by law',
  },
  {
    type: 'p',
    text: (
      <>
        Where Nigerian law, a regulator, or a court requires a refund.
      </>
    ),
  },

  { type: 'h2', text: '3. Refunds not available for' },
  {
    type: 'list',
    items: [
      'Services already rendered in full. A subscription period that has run its course is not refundable.',
      'Partial months or partial annual periods, except where required by Section 2.',
      'Cancellation initiated by the Estate partway through a paid period, outside the circumstances in Section 2.',
      'Suspension or termination for material breach of the Terms of Service.',
    ],
  },

  { type: 'h2', text: '4. How to request a refund' },
  {
    type: 'p',
    text: (
      <>
        Contact{' '}
        <a
          href="mailto:billing@e-shomer.com"
          className="underline underline-offset-4"
        >
          billing@e-shomer.com
        </a>{' '}
        with:
      </>
    ),
  },
  {
    type: 'list',
    items: [
      'The Estate name and Estate Admin email.',
      <>
        The payment reference (the format is{' '}
        <code>PSK-XXXXXX</code> for card payments,{' '}
        <code>BT-XXXXXX</code> for bank transfers).
      </>,
      'The amount being disputed.',
      'A brief description of the circumstances.',
    ],
  },
  {
    type: 'p',
    text: (
      <>
        We will acknowledge the request within [3] business days and
        respond with a decision within [14] business days.
      </>
    ),
  },

  { type: 'h2', text: '5. How refunds are issued' },
  {
    type: 'p',
    text: (
      <>
        <strong>Card payments (Paystack).</strong> Refunds are issued
        back to the original card via Paystack. The refund amount is
        limited to the original charge. Timing depends on the card
        issuer; typically 5&ndash;10 business days.
      </>
    ),
  },
  {
    type: 'p',
    text: (
      <>
        <strong>Bank transfer payments.</strong> Refunds are issued by
        bank transfer to the account from which the original payment
        was received, unless otherwise agreed in writing. Timing
        depends on the receiving bank; typically 3&ndash;7 business
        days.
      </>
    ),
  },
  {
    type: 'p',
    text: (
      <>
        <strong>Partial refunds.</strong> Where the circumstances
        justify a partial refund, the amount is limited to the portion
        of the subscription fee corresponding to the period for which
        the Service was not delivered or was materially deficient.
      </>
    ),
  },

  { type: 'h2', text: '6. Refund limits' },
  {
    type: 'p',
    text: (
      <>
        The total amount refunded against any single payment will never
        exceed the amount originally received for that payment. We do
        not issue refunds in excess of the original charge.
      </>
    ),
  },

  { type: 'h2', text: '7. Right to decline' },
  {
    type: 'p',
    text: (
      <>
        We reserve the right to decline a refund request where the
        circumstances do not fall within Section 2, or where we
        reasonably believe the request is fraudulent or abusive. If we
        decline, we will explain our reasoning in writing.
      </>
    ),
  },

  { type: 'h2', text: '8. Consumer rights' },
  {
    type: 'p',
    text: (
      <>
        Nothing in this policy limits any right you have under Nigerian
        consumer protection law or under the Nigeria Data Protection
        Act 2023.
      </>
    ),
  },

  { type: 'h2', text: '9. Changes to this policy' },
  {
    type: 'p',
    text: (
      <>
        We may update this policy from time to time. Material changes
        will be announced in-product before they take effect.
      </>
    ),
  },

  { type: 'h2', text: '10. Contact' },
  {
    type: 'p',
    text: (
      <>
        Refund requests and questions:{' '}
        <a
          href="mailto:billing@e-shomer.com"
          className="underline underline-offset-4"
        >
          billing@e-shomer.com
        </a>
      </>
    ),
  },
]

export function RefundsContent() {
  return (
    <LegalDocument
      title="Refund Policy"
      effectiveDate={LEGAL_EFFECTIVE_DATE}
      sections={SECTIONS}
    />
  )
}
