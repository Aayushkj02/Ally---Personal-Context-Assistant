/**
 * OWNER: SHLOK — task S5
 *
 * HTTP client for the laptop bridge: POST /parse and GET /health.
 * Transport at demo time is `adb reverse tcp:11434` over USB, never venue Wi-Fi.
 *
 * EVERY CALL IS OPTIONAL BY CONTRACT (docs/CONTRACTS.md §4). A dead bridge must never
 * produce a spinner, an error dialog, or a blocked UI — it falls back silently.
 */

export {};
