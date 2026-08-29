/**
 * OWNER: DHREY — task D2
 *
 * Precedence rules, expressed as data where possible so they can be unit-tested
 * without a device or a database (SRS FR-11):
 *
 *   current command  >  temporary override  >  persistent profile  >  mode default
 *
 * Expired overrides are filtered AT RESOLVE TIME, not by a background job — the
 * correct policy must be computable even if the app was killed while one was live.
 */

export {};
