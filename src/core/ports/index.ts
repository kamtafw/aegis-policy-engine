// barrel export for all port interfaces
//
// import from here rather than individual files so that if a port is moved
// or renamed, only this file and the adapter that implements it need updating
//
// REMINDER:
//   - Adapters implement these interfaces and import from here
//   - Core runtime services consume these interfaces and import from here
//   - nothing in core/ports imports from adapters/ or infrastructure
//   - server.ts is the only place where ports and adapters meet

// runtime ports (consumed by EnforcementPipeline and its stages)
export type { CachePort } from "./CachePort"
export type { JwtClaims, JwtValidatorPort } from "./JwtValidatorPort"
export type { PolicyPort, Policy } from "./PolicyPort"
export type { PrincipalProjectionPort, PermissionProjection } from "./PrincipalProjectionPort"
export type { AuditPort, AuditRecord } from "./AuditPort"

// management repository ports (consumed by management plane services)
export type { TenantRepositoryPort, CreateTenantInput } from "./TenantRepositoryPort"
export type { PrincipalRepositoryPort, CreatePrincipalInput } from "./PrincipalRepositoryPort"
export type { RoleRepositoryPort, Role, CreateRoleInput } from "./RoleRepositoryPort"
export type {
	PermissionRepositoryPort,
	Permission as PermissionRecord,
	CreatePermissionInput,
} from "./PermissionRepositoryPort"
export type { PolicyRepositoryPort, CreatePolicyInput } from "./PolicyRepositoryPort"
export type {
	ServiceRepositoryPort,
	Service,
	Route,
	HttpMethod,
	CreateServiceInput,
	CreateRouteInput,
} from "./ServiceRepositoryPort"
