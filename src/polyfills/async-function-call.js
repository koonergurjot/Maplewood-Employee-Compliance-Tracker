/**
 * Browser compatibility audit
 * ---------------------------
 *
 * We previously monkey patched `Function.prototype.call` because we thought
 * WebKit returned `undefined` when invoking async functions via `.call()`.
 * Manual verification (including the Playwright WebKit regression test added
 * in tests/function-call.spec.ts) shows modern WebKit already follows the
 * ECMAScript specification: async functions invoked with `.call()` return a
 * Promise and synchronous functions continue to return their direct values.
 *
 * The only compatibility requirement we now track is to ensure `.call()` keeps
 * those native semantics so synchronous utilities (for example the
 * object-hasOwnProperty pattern used in the importer) do not become
 * accidentally asynchronous.  No runtime shim is required anymore, and this
 * module remains as documentation for that decision.
 */

export {};
