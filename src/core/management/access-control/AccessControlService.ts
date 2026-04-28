// AccessControlService — write model for the authorization domain.
//
// VERSION COUNTER OWNERSHIP (AD-P-07):
//   this service is the only place that increments version counters;
//   route handlers never touch them; the rules are:
//
//   create role                → policy_version++ on tenant
//   create permission          → policy_version++ on tenant
//   assign permission to role  → policy_version++ on tenant
//   assign role to principal   → policy_version++ on tenant
//                                principal_version++ on that specific principal
//
//   policy_version invalidates the decision cache for all principals in the tenant;
//   principal_version the decision cache for one specific principal;
//   they are incremented together on role-to-principal assignment because both
//   cached dimensions are affected
//
// PLANE BOUNDARY NOTE:
//   this service imports directly from the adapter types (RoleRepository, etc.);
//   this is a deliberate Day 5-6 shortcut — the full port/adapter split for
//   management-plane repositories is lower priority than for the runtime plane;
//   the runtime plane services (IdentityService, PermissionResolver, EnforcementPipeline)
//   will be strictly port-based from Day 12 onward
//
// responsibilities added later:
//   - Role CRUD (Day 6)
//   - Permission CRUD (Day 6)
//   - Role/permission assignment (Day 6)
//   - policy_version + principal_version counter increments (Day 6)
//   - Decision cache invalidation on version bump (Day 6)
//   - Role graph flattening → permission projection (Day 7)
//
// this service is the write model; the read model (flat permission projection)
// lives in PermissionResolver in the Runtime plane (CQRS-lite, AD-C-07)
// these two never call each other — they communicate only through the database
//
// plane: core/management

import type {
	Permission,
	PermissionId,
	PermissionSlug,
	Principal,
	PrincipalId,
	Role,
	RoleId,
	TenantId,
	ValidAction,
} from "@core/domain"
import type {
	PrincipalRepository,
	CreatePrincipalInput,
} from "../../../adapters/postgres/PrincipalRepository"
import { TenantRepository } from "@adapters/postgres/TenantRepository"
import { RoleRepository } from "@adapters/postgres/RoleRepository"
import { PermissionRepository } from "@adapters/postgres/PermissionRepository"

export interface CreatePrincipalParams {
	externalId: string
	metadata?: Record<string, unknown>
}

export interface CreateRoleParams {
	name: string
}

export interface CreatePermissionParams {
	resource: string
	action: ValidAction
	specificity: string | null
}

export class AccessControlService {
	constructor(
		private readonly principalRepo: PrincipalRepository,
		private readonly tenantRepo: TenantRepository,
		private readonly roleRepo: RoleRepository,
		private readonly permissionRepo: PermissionRepository,
	) {}

	// ---------------------------------------------------------------------------
	// Principals
	// ---------------------------------------------------------------------------
	async createPrincipal(tenantId: TenantId, params: CreatePrincipalParams): Promise<Principal> {
		const id = `pri_${crypto.randomUUID()}` as PrincipalId

		const input: CreatePrincipalInput = {
			id,
			externalId: params.externalId,
			metadata: params.metadata ?? {},
		}

		return this.principalRepo.create(tenantId, input)
	}

	// tenant_id required — no cross-tenant listing exists (AD-S-01)
	async listPrincipals(tenantId: TenantId): Promise<Principal[]> {
		return this.principalRepo.listByTenant(tenantId)
	}

	// ---------------------------------------------------------------------------
	// Roles
	// ---------------------------------------------------------------------------
	async createRole(tenantId: TenantId, params: CreateRoleParams): Promise<Role> {
		const id = `rol_${crypto.randomUUID()}` as RoleId

		const role = await this.roleRepo.create(tenantId, { id, name: params.name })

		// any change to the authorization model invalidates the decision cache (AD-P-07)
		await this.tenantRepo.incrementPolicyVersion(tenantId)

		return role
	}

	// ---------------------------------------------------------------------------
	// Permissions
	// ---------------------------------------------------------------------------
	async createPermission(tenantId: TenantId, params: CreatePermissionParams): Promise<Permission> {
		const id = `per_${crypto.randomUUID()}` as PermissionId

		const permission = await this.permissionRepo.create(tenantId, {
			id,
			resource: params.resource,
			action: params.action,
			specificity: params.specificity,
		})

		// new permission changes the authorization model — invalidate decision cache
		await this.tenantRepo.incrementPolicyVersion(tenantId)

		return permission
	}

	// ---------------------------------------------------------------------------
	// Assignments
	// ---------------------------------------------------------------------------
	async assignPermissionToRole(
		tenantId: TenantId,
		roleId: RoleId,
		permissionId: PermissionId,
	): Promise<void> {
		// verify both exist in this tenant before assigning
		const [role, permission] = await Promise.all([
			this.roleRepo.findById(tenantId, roleId),
			this.permissionRepo.findById(tenantId, permissionId),
		])

		if (!role) {
			throw new NotFoundError(`Role '${roleId}' not found in tenant '${tenantId}'`)
		}

		if (!permission) {
			throw new NotFoundError(`Permission '${permissionId}' not found in tenant '${tenantId}'`)
		}

		await this.roleRepo.assignPermission(tenantId, roleId, permissionId)

		// assigning a permission to a role affects every principal who holds that
		// role — the entire tenant's decision cache must be invalidated
		await this.tenantRepo.incrementPolicyVersion(tenantId)
	}

	async assignRoleToPrincipal(
		tenantId: TenantId,
		principalId: PrincipalId,
		roleId: RoleId,
	): Promise<void> {
		// verify both exist in this tenant before assigning
		const [principal, role] = await Promise.all([
			this.principalRepo.findById(tenantId, principalId),
			this.roleRepo.findById(tenantId, roleId),
		])

		if (!principal) {
			throw new NotFoundError(`Principal '${principal}' not found in tenant '${tenantId}'`)
		}
		if (!role) {
			throw new NotFoundError(`Role '${roleId}' not found in tenant '${tenantId}'`)
		}

		await this.principalRepo.assignRole(tenantId, principalId, roleId)

		// two cache dimension are affected (AD-P-07, AD-P-08):
		//   policy_version — the tenant's decision cache key includes this
		//   principal_version — the principal's specific cache entry is now stale
		// both must be incremented atomically from the perspective of the caller
		await Promise.all([
			this.tenantRepo.incrementPolicyVersion(tenantId),
			this.principalRepo.incrementVersion(tenantId, principalId),
		])
	}

	// returns the flat set of permission slugs held by a principal
	// this is the write-model projection used by the management plane;
	// the runtime plane (PermissionResolver, Day 14) reads the same data
	// through a different path — via cache first, then PrincipalProjectionPort;
	// these two never call each other (AD-C-07, AD-C-08)
	async flattenPermissions(
		principalId: PrincipalId,
		tenantId: TenantId,
	): Promise<Set<PermissionSlug>> {
		const slugs = await this.roleRepo.getFlatPermissionSlugs(tenantId, principalId)
		return new Set(slugs)
	}
}

// ---------------------------------------------------------------------------
// Domain errors — raised by the service, caught by route handlers
// ---------------------------------------------------------------------------
export class NotFoundError extends Error {
	readonly code = "NOT_FOUND" as const
	constructor(message: string) {
		super(message)
		this.name = "NotFoundError"
	}
}
