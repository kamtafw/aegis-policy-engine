// ServiceRegistryService — manages upstream services and routes per tenant
//
// each route carries a policy_id reference; routes are the unit the prefix
// trie is built from at gateway startup (AD-P-05)
//
// no version counter increments here — service/route changes do not affect
// the decision cache (policy assignments are on routes, not in the cache key);
// the cache key is: tenant_id + policy_version + principal_id + principal_version;
// changing which policy a route points to does not change any of those values;
// the gateway reads the route's policy_id fresh on every request via PolicyPort
//
// plane: core/management

import type {
	HttpMethod,
	Route,
	Service,
	ServiceRepository,
} from "@adapters/postgres/ServiceRepository"
import type { PolicyId, RouteId, ServiceId, TenantId } from "@core/domain"

export interface CreateServiceParams {
	name: string
	upstreamUrl: string
}

export interface CreateRouteParams {
	method: HttpMethod
	pathPattern: string
	policyId: PolicyId | null
}

export class NotFoundError extends Error {
	readonly code = "NOT_FOUND" as const
	constructor(message: string) {
		super(message)
		this.name = "NotFoundError"
	}
}

export class ServiceRegistryService {
	constructor(private readonly serviceRepo: ServiceRepository) {}

	async createService(tenantId: TenantId, params: CreateServiceParams): Promise<Service> {
		const id = `svc_${crypto.randomUUID()}` as ServiceId
		return this.serviceRepo.createService(tenantId, {
			id,
			name: params.name,
			upstreamUrl: params.upstreamUrl,
		})
	}

	async createRoute(
		tenantId: TenantId,
		serviceId: ServiceId,
		params: CreateRouteParams,
	): Promise<Route> {
		// verify the service exists and belongs to this tenant before adding a route
		const service = await this.serviceRepo.findServiceById(tenantId, serviceId)
		if (!service) {
			throw new NotFoundError(`Service '${serviceId}' not found in tenant '${tenantId}'`)
		}

		const id = `rte_${crypto.randomUUID()}` as RouteId
		return this.serviceRepo.createRoute(tenantId, serviceId, {
			id,
			method: params.method,
			pathPattern: params.pathPattern,
			policyId: params.policyId,
		})
	}

	async listRoutes(tenantId: TenantId, serviceId: ServiceId): Promise<Route[]> {
		const service = await this.serviceRepo.findServiceById(tenantId, serviceId)
		if (!service) {
			throw new NotFoundError(`Service '${serviceId}' not found in tenant '${tenantId}'`)
		}
		return this.serviceRepo.listRoutesByService(tenantId, serviceId)
	}

	// used by EnforcementPipeline at startup to build the route trie (Day 18)
	async getAllRoutes(tenantId: TenantId): Promise<Route[]> {
		return this.serviceRepo.listAllRoutesByTenant(tenantId)
	}
}
