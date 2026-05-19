// repository port for service and route persistence; consumed by:
//   - ServiceRegistryService
//
// implemented by: adapters/postgres/ServiceRepository.ts
//
// all methods are tenant-scoped — tenant_id is non-optional (AD-S-01)
//
// plane: core/ports

import type { PolicyId, RouteId, ServiceId, TenantId } from "@core/domain"

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS"

export interface Service {
	id: ServiceId
	tenantId: TenantId
	name: string
	upstreamUrl: string
	isActive: boolean
	createdAt: Date
}

export interface Route {
	id: RouteId
	serviceId: ServiceId
	tenantId: TenantId
	method: HttpMethod
	pathPattern: string
	policyId: PolicyId | null
	policyName: string | null
	createdAt: Date
}

export interface CreateServiceInput {
	id: ServiceId
	name: string
	upstreamUrl: string
}

export interface CreateRouteInput {
	id: RouteId
	method: HttpMethod
	pathPattern: string
	policyId: PolicyId | null
}

export interface ServiceRepositoryPort {
	createService(tenantId: TenantId, input: CreateServiceInput): Promise<Service>
	findServiceById(tenantId: TenantId, id: ServiceId): Promise<Service | null>
	createRoute(tenantId: TenantId, serviceId: ServiceId, input: CreateRouteInput): Promise<Route>
	listRoutesByService(tenantId: TenantId, serviceId: ServiceId): Promise<Route[]>
	listAllRoutesByTenant(tenantId: TenantId): Promise<Route[]>
}
