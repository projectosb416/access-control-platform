/**
 * Legal documents — version and draft flags.
 *
 * LEGAL_CONSENT_VERSION is stamped into signup metadata so that a
 * future dispute can identify which version of the terms a given
 * account accepted. Bump this string when the terms or privacy
 * policy materially change.
 *
 * LEGAL_DRAFT controls a visible banner on the /legal pages. Set to
 * false after a qualified lawyer reviews and approves the copy. One
 * line change removes the banner everywhere.
 */

export const LEGAL_CONSENT_VERSION = 'v1-draft-2026-10-13'

export const LEGAL_DRAFT = true

export const LEGAL_EFFECTIVE_DATE = '2026-10-13'
