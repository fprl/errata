---
title: Plugin system Specification
---

## 1\. Architectural Overview

The plugin system allows developers to extend `errata` with reusable logic bundles. Plugins can:

1.  **Inject Codes:** Add new error codes to the registry types automatically.
2.  **Intercept & Map:** Translate external errors (Stripe, Zod, Backend API) into ErrataErrors via `ensure`.
3.  **Observe:** Listen to error creation for logging/monitoring via `onCreate`.
4.  **Adapt (Client):** Handle custom payload formats on the client via `deserialize`.

The system exists on both the **Server** (Node.js/Edge) and the **Client** (Browser/SPA).

-----

## 2\. Server-Side Plugin Architecture

### Interface: `ErrataPlugin`

A plugin is an object (usually returned by a factory function) with the following signature:

```ts
interface ErrataPlugin<TPluginCodes extends CodeConfigRecord> {
  /** unique name for debugging/deduplication */
  name: string

  /**
   * Dictionary of codes to merge into the main registry.
   * These must be strictly typed so the user gets autocomplete.
   */
  codes?: TPluginCodes

  /**
   * Hook: Unknown Mapping
   * Runs inside `errors.ensure(err)`.
   * @param error - The raw unknown error being ensured.
   * @param ctx - The errata instance (restricted context).
   * @returns ErrataError instance OR { code, details } OR null (to pass).
   */
  onUnknown?: (error: unknown, ctx: ErrataContext) => ErrataError | { code: string, details?: any } | null

  /**
   * Hook: Side Effects
   * Runs synchronously inside `errors.create()`.
   * @param error - The fully formed ErrataError instance.
   * @param ctx - The errata instance.
   */
  onCreate?: (error: ErrataError, ctx: ErrataContext) => void

  /**
   * Hook: Serialization Adaptation
   * Runs inside `errors.serialize(err)`.
   * @param payload - The current serialized payload (mutable).
   * @param error - The original ErrataError instance.
   * @param ctx - The errata instance.
   * @returns A SerializedError (can be the same object or a modified clone).
   */
  onSerialize?: (payload: SerializedError, error: ErrataError, ctx: ErrataContext) => SerializedError
}
```

### The `ErrataContext` (`ctx`)

Plugins need access to the library's tools to create errors or check configs.

  * `ctx.create(code, details)`: To manufacture a valid ErrataError.
  * `ctx.ensure(err, fallbackCode?)`: To normalize unknown errors (useful for wrapping/re-normalizing).
  * `ctx.config`: Access to `env`, `app` name, etc.

### Type Inference Requirements

The `errata` factory must be updated to accept a `plugins` array.

  * **Generics:** It must accept a tuple of plugins `TPlugins`.
  * **Inference:** The returned instance type must include the intersection of `UserCodes & Plugin1Codes & Plugin2Codes`.
  * **Goal:** `errors.create('stripe.card_declined')` should autocomplete if the Stripe plugin is added, without manual type merging.

### Execution Logic

1.  **`errors.ensure(err)` Flow:**

      * Iterate through `plugins` in order.
      * Call `plugin.onUnknown(err, ctx)`.
      * **Stop** at the first plugin that returns a non-null value.
      * Use that value to return the final `ErrataError`.
      * *Fallback:* If no plugin handles it, proceed with standard normalization (check `instanceof Error`, etc.).

2.  **`errors.create(...)` Flow:**

      * Instantiate the `ErrataError`.
      * Iterate through `plugins`.
      * Call `plugin.onCreate(error, ctx)` for **all** plugins (side effects are independent).
      * Wrap each call in try/catch; if an error occurs, `console.error('errata: plugin [name] crashed in onCreate', err)`.

3.  **`errors.serialize(err)` Flow:**

      * Build base payload via `err.toJSON()`.
      * Iterate through `plugins` in order.
      * Call `plugin.onSerialize(payload, error, ctx)` when defined and use its return value as the new payload.

### Plugin Validation (at initialization)

When `errata({ plugins: [] })` initializes:

  * Check for duplicate `plugin.name` values and warn.
  * Check if any plugin codes overlap with each other or the user's base codes and warn.

-----

## 3\. Client-Side Plugin Architecture

### Interface: `ErrataClientPlugin`

The client needs a lighter plugin system, primarily for adapting network payloads.

```ts
interface ErrataClientPlugin {
  name: string

  /**
   * Hook: Payload Adaptation
   * Runs inside `client.deserialize(payload)`.
   * @param payload - The raw input (usually JSON).
   * @param ctx - Client context.
   * @returns ErrataClientError instance OR null.
   */
  onDeserialize?: (payload: unknown, ctx: ClientContext) => ErrataClientError | null

  /**
   * Hook: Side Effects
   * Runs inside `client.create()` or when `deserialize` succeeds.
   */
  onCreate?: (error: ErrataClientError, ctx: ClientContext) => void
}
```

### Execution Logic

1.  **`client.deserialize(payload)` Flow:**
      * Iterate through `plugins`.
      * Call `plugin.onDeserialize(payload, ctx)`.
      * **Stop** at the first non-null return.
      * *Fallback:* If no plugin handles it, use the standard logic (check for `.code`, validation, `be.unknown_error`).

-----

## 4\. Testing Strategy (`plugins.test.ts`)

Since you know the internal logic, here is the list of test cases required to validate this architecture.

### A. Server Plugin Tests

1.  **Code Injection & Inference:**

      * Define a plugin with a unique code (e.g., `plugin.test_error`).
      * Initialize `errata` with that plugin.
      * **Runtime:** Assert `errors.create('plugin.test_error')` works.
      * **Types:** (Verified via TS compilation) Assert that the code appears in the union.

2.  **`onEnsure` Mapping (The "Stripe" Case):**

      * Mock a "Third Party Error" class (e.g., `class StripeError extends Error { code = 'card_declined' }`).
      * Create a plugin that detects `StripeError` in `onEnsure` and maps it to `billing.declined`.
      * Call `errors.ensure(new StripeError())`.
      * **Assert:** The returned object is an `ErrataError` with code `billing.declined` and correct details.

3.  **`onEnsure` Priority/Chain:**

      * Register two plugins. Plugin A returns `null`. Plugin B returns an error.
      * Call `ensure`.
      * **Assert:** Plugin B's result is used.
      * *Reverse:* Plugin A returns an error. Plugin B is **not** called (short-circuit).

4.  **`onCreate` Side Effects (The "Sentry" Case):**

      * Create a mock spy function `logSpy`.
      * Create a plugin that calls `logSpy` in `onCreate`.
      * Call `errors.create(...)`.
      * **Assert:** `logSpy` was called with the created error.

### B. Client Plugin Tests

5.  **`onDeserialize` Adaptation (The "RFC 7807" Case):**

      * Create a payload that **fails** standard validation (e.g., missing `code`, but has `type` and `title`).
      * Create a client plugin that detects `type`, and maps it to a `ErrataClientError`.
      * Call `client.deserialize(customPayload)`.
      * **Assert:** It returns a valid `ErrataClientError` instead of `be.deserialization_failed`.

6.  **`onCreate` Client Logging:**

      * Create a client plugin with `onCreate`.
      * Deserialize a payload.
      * **Assert:** The hook fired.

-----

## 5\. Implementation Notes for the AI

  * **Recursion Safety:** Be careful that `ctx.create()` inside a plugin doesn't trigger an infinite loop of `onCreate` hooks if not handled carefully (though usually `onCreate` logic like logging doesn't call `create` again).
  * **Dependency Injection:** Ensure `ctx` passed to plugins is robust. It's often easiest to pass the fully constructed `errors` instance, but be aware of circular reference issues during initialization. A lazy getter or passing a restricted API surface is preferred.
