// Zod schemas for the pipeline context types
//
// BOUNDARY RULE: this file lives in adapters/ — it is never imported by core/
// Core types are plain TypeScript interfaces (structural typing, zero runtime cost)
// these schemas add runtime validation at the points where data crosses an
// infrastructure boundary:
//
//   HttpAdapter (Day 18)
//     → parses incoming HTTP request into RouteContext
//     → RouteContextSchema validates the assembled object before the pipeline starts
//
//   RedisCacheAdapter (Day 12)
//     → deserializes PermissionContext from Redis JSON
//     → PermissionContextSchema validates and converts permissions array → Set
//
//   RedisAuditBufferAdapter (Day 17)
//     → serializes AuditRecord to JSON for the Redis stream
//     → AuditRecordSchema validates before write
//
// WHY ZOD HERE AND NOT IN CORE:
//   Zod is a runtime dependency. Core types are compile-time only (interfaces).
//   Keeping Zod in adapters enforces that core logic never depends on validation
//   infrastructure. If you swap Zod for another library, only this file changes.
//
// BRANDED TYPES:
//   Zod validates structure and content. Branded types (TenantId, PrincipalId, etc.)
//   are applied via `as` casts after parsing — Zod does not know about TypeScript brands.
//   The cast is safe because the schema has already verified the value is a non-empty string.
//
// PERMISSIONCONTEXT SPECIAL CASE:
//   `permissions` is stored in Redis as a JSON array (Sets are not JSON-serializable).
//   The schema transforms the parsed array into a Set<PermissionSlug> so the rest
//   of the pipeline receives the correct type.

import { z } from "zod"
import type {
	AuditRecord,
	Decision,
	IdentityContext,
	PermissionContext,
	RouteContext,
} from "@core/runtime/context"
import {
	ActionSlug,
	PermissionSlug,
	PolicyId,
	PrincipalId,
	ResourceSlug,
	RouteId,
	TenantId,
} from "@core/domain"

// ---------------------------------------------------------------------------
// Primitives — reused across schemas
// ---------------------------------------------------------------------------
const NonEmptyString = z.string().min(1)

const HttpMethod = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])

const PositiveInt = z.number().int().positive()

// ---------------------------------------------------------------------------
// RoutContext
//
// used by: HttpAdapter — validates the RouteContext it assembles from the
// incoming HTTP request before passing it to EnforcementPipeline
// ---------------------------------------------------------------------------
export const RouteContextSchema = z
	.object({
		routeId: NonEmptyString,
		method: HttpMethod,
		action: NonEmptyString,
		resourceType: NonEmptyString,
		requestMetadata: z.record(z.string()),
	})
	.transform(
		(data): RouteContext => ({
			routeId: data.routeId as RouteId,
			method: data.method,
			action: data.action as ActionSlug,
			resourceType: data.resourceType as ResourceSlug,
			requestMetadata: data.requestMetadata,
		}),
	)

// ---------------------------------------------------------------------------
// IdentityContext
//
// used by: IdentityService unit tests (Day 13) and any adapter that needs
// to validate an identity context object at a boundary
// ---------------------------------------------------------------------------
export const IdentityContextSchema = z
	.object({
		tenantId: NonEmptyString,
		principalId: NonEmptyString,
		keyVersion: PositiveInt,
		principalVersion: PositiveInt,
	})
	.transform(
		(data): IdentityContext => ({
			tenantId: data.tenantId as TenantId,
			principalId: data.principalId as PrincipalId,
			keyVersion: data.keyVersion,
			principalVersion: data.principalVersion,
		}),
	)

// ---------------------------------------------------------------------------
// PermissionContext
//
// used by: RedisCacheAdapter — deserializes a cached PermissionContext from
// Redis Json; the key transformation here is permissions: string[] → Set
//
// serialization (writing to Redis):
//   JSON.stringify({...ctx, permissions: [...ctx.permissions]})
//
// deserialization (reading from Redis):
//   PermissionContextSchema.parse(JSON.parse(cached))
//   → permissions array becomes Set<PermissionSlug> automatically
// ---------------------------------------------------------------------------
export const PermissionContextSchema = z
	.object({
		tenantId: NonEmptyString,
		principalId: NonEmptyString,
		permissions: z.array(NonEmptyString), // JSON arrays are the wire format — transform to Set on parse
		policyVersion: PositiveInt,
		principalVersion: PositiveInt,
	})
	.transform(
		(data): PermissionContext => ({
			tenantId: data.tenantId as TenantId,
			principalId: data.principalId as PrincipalId,
			permissions: new Set(data.permissions as PermissionSlug[]),
			policyVersion: data.policyVersion,
			principalVersion: data.principalVersion,
		}),
	)

// helper: serialize PermissionContext to JSON-safe object for Redis
// call this before JSON.stringify — the inverse of PermissionContextSchema.parse
export function serializePermissionContext(ctx: PermissionContext): object {
	return {
		tenantId: ctx.tenantId,
		principalId: ctx.principalId,
		permissions: [...ctx.permissions], // Set → Array
		policyVersion: ctx.policyVersion,
		principalVersion: ctx.principalVersion,
	}
}

// ---------------------------------------------------------------------------
// Decision
//
// used by: adapter-level tests and any boundary where a Decision object
// needs runtime validation (e.g. reading from a message queue in future)
// ---------------------------------------------------------------------------
export const DecisionSchema = z
	.object({
		allowed: z.boolean(),
		reason: NonEmptyString,
		evaluatedPolicyVersion: z.number().int().nonnegative(),
		evaluatedPrincipalVersion: z.number().int().nonnegative(),
	})
	.transform((data): Decision => data)

// ---------------------------------------------------------------------------
// AuditRecord
//
// used by: RedisAuditBufferAdapter — validates the AuditRecord before
// writing it to the Redis stream; also used by AuditDrainWorker when
// reading records back from the stream for Postgres insertion
//
// timestamp is serialized as an ISO 8601 string in Redis (JSON has no Date
// type); the schema accepts both Date objects and ISO strings, normalising
// to Date on parse
// ---------------------------------------------------------------------------
export const AuditRecordSchema = z
	.object({
		tenantId: NonEmptyString,
		principalId: NonEmptyString,
		routeId: NonEmptyString,
		policyId: NonEmptyString,
		action: NonEmptyString,
		decision: DecisionSchema,
		timestamp: z.union([
			z.date(),
			z
				.string()
				.datetime()
				.transform((s) => new Date(s)),
		]),
	})
	.transform(
		(data): AuditRecord => ({
			tenantId: data.tenantId as TenantId,
			principalId: data.principalId as PrincipalId,
			routeId: data.routeId as RouteId,
			policyId: data.policyId as PolicyId,
			action: data.action as ActionSlug,
			decision: data.decision,
			timestamp: data.timestamp,
		}),
	)

// helper: serialize AuditRecord to a JSON-safe object for the Redis stream
export function serializedAuditRecord(record: AuditRecord): object {
	return {
		tenant: record.tenantId,
		principalId: record.principalId,
		routeId: record.routeId,
		policyId: record.policyId,
		action: record.action,
		decision: record.decision,
		timestamp: record.timestamp.toISOString(),
	}
}
