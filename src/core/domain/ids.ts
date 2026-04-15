// these are nominal types — they carry the same runtime representation (string)
// but are structurally incompatible at compile time; you cannot pass a TenantId
// where a PrincipalId is expected, even though both are strings underneath.
//
// the brand is enforced only by TypeScript; at runtime they are plain strings.
// this is intentional — no wrapping, no boxing, no allocation cost.
//
// usage:
//   const tenantId = "t_abc123" as TenantId
//   const principalId = "p_xyz789" as PrincipalId
//
// casting from unknown input happens at adapter boundaries (Zod schemas),
// never inside core; core always receives already-typed IDs.

declare const __brand: unique symbol
type Brand<T, B> = T & { readonly [__brand]: B }

// primary domain identifiers
export type TenantId = Brand<string, "TenantId">
export type PrincipalId = Brand<string, "PrincipalId">
export type RouteId = Brand<string, "RouteId">
export type ServiceId = Brand<string, "ServiceId">
export type RoleId = Brand<string, "RoleId">
export type PermissionId = Brand<string, "PermissionId">
export type PolicyId = Brand<string, "PolicyId">

// RawToken is opaque outside the Identity boundary.
// it is consumed inside IdentityService and never returned, never logged
// defined here so the type exists at the HttpAdapter boundary —
// but only IdentityService is permitted to inspect its contents
export type RawToken = Brand<string, "RawToken">

// PermissionSlug: resource:action[:specificity] (AD-T-01)
// validated structurally at write time (PolicyRegistry, AccessControl)
// at runtime the evaluator receives pre-validated slugs — no re-validation
export type PermissionSlug = Brand<string, "PermissionSlug">

// ActionSlug — one of the closed vocabulary verbs (AD-T-02)
export type ActionSlug = Brand<string, "ActionSlug">

// ResourceSlug — the resource portion of a permission slug
export type ResourceSlug = Brand<string, "ResourceSlug">

// helper: unsafe cast from the string — use only at validate adapter boundaries
export const unsafeCast = <T extends Brand<string, string>>(value: string): T => value as T
