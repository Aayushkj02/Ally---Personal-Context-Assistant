/**
 * OWNER: DHREY
 *
 * Policy resolution. Pure TypeScript, zero I/O, so it unit-tests in Node with no device
 * and no database.
 *
 * PolicyEngine.resolve() (precedence: command > override > profile > default) is still to
 * come. Priority resolution is implemented.
 */

export * from './priorityResolver';
