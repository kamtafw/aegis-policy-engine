// repository adapter for the services and routes tables
// routes are tightly coupled to services — they are always queried in that
// context, so both live in the same adapter
//
// all queries are tenant-scoped — tenant_id is non-optional (AD-S-01)
//
// plane: adapters/postgres

import type { Sql } from "./client"
import type { PolicyId, RouteId, ServiceId, TenantId } from "@core/domain"

export interface Service {
	id: ServiceId
	tenantId: TenantId
	name: string
	upstreamUrl: string
	isActive: boolean
	createdAt: Date
}

export interface CreateServiceInput {
	id: ServiceId
	name: string
	upstreamUrl: string
}

interface ServiceRow {
	id: string
	tenantId: string
	name: string
	upstreamUrl: string
	isActive: boolean
	createdAt: Date
}

function rowToService(row: ServiceRow): Service {
	return {
		id: row.id as ServiceId,
		tenantId: row.tenantId as TenantId,
		name: row.name,
		upstreamUrl: row.upstreamUrl,
		isActive: row.isActive,
		createdAt: row.createdAt,
	}
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS"

export interface Route {
	id: RouteId
	serviceId: ServiceId
	tenantId: TenantId
	method: HttpMethod
	pathPattern: string
	policyId: PolicyId | null // nullable — a route with no policy always denies (AD-S-07)
	policyName: string | null // joined from policies table for human-readable inspection
	createdAt: Date
}

export interface CreateRouteInput {
	id: RouteId
	method: HttpMethod
	pathPattern: string
	policyId: PolicyId | null
}

// raw row from the JOIN query — policy fields may be null
interface RouteRow {
	id: string
	serviceId: string
	tenantId: string
	method: string
	pathPattern: string
	policyId: string | null
	policyName: string | null
	createdAt: Date
}

function rowToRoute(row: RouteRow): Route {
	return {
		id: row.id as RouteId,
		serviceId: row.serviceId as ServiceId,
		tenantId: row.tenantId as TenantId,
		method: row.method as HttpMethod,
		pathPattern: row.pathPattern,
		policyId: row.policyId as PolicyId | null,
		policyName: row.policyName,
		createdAt: row.createdAt,
	}
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class ServiceRepository {
	constructor(private readonly sql: Sql) {}

	// -------------------------------------------------------------------------
	// Services
	// -------------------------------------------------------------------------

	async createService(tenantId: TenantId, input: CreateServiceInput): Promise<Service> {
		const [row] = await this.sql<ServiceRow[]>`
      INSERT INTO services (id, tenant_id, name, upstream_url)
      VALUES (${input.id}, ${tenantId}, ${input.name}, ${input.upstreamUrl})
      RETURNING *
    `
		return rowToService(row!)
	}

	async findServiceById(tenantId: TenantId, id: ServiceId): Promise<Service | null> {
		const [row] = await this.sql<Service[]>`
      SELECT * FROM services
      WHERE tenant_id = ${tenantId}
        AND id        = ${id}
    `
		return row ? rowToService(row) : null
	}

	// -------------------------------------------------------------------------
	// Routes
	// -------------------------------------------------------------------------

	async createRoute(
		tenantId: TenantId,
		serviceId: ServiceId,
		input: CreateRouteInput,
	): Promise<Route> {
		// insert without policyName — it's a joined field, not a column
		const [row] = await this.sql<RouteRow[]>`
      INSERT INTO routes (id, service_id, tenant_id, method, path_pattern, policy_id)
      VALUES (
        ${input.id},
        ${serviceId},
        ${tenantId},
        ${input.method},
        ${input.pathPattern},
        ${input.policyId}
      )
      RETURNING
        id,
        service_id,
        tenant_id,
        method,
        path_pattern,
        policy_id,
        NULL::text as policy_name,
        created_at
    `
		return rowToRoute(row!)
	}

	// returns routes with policy name joined — used by the admin API for
	// human readable inspection (AD-P-05)
	async listRoutesByService(tenantId: TenantId, serviceId: ServiceId): Promise<Route[]> {
		const rows = await this.sql<RouteRow[]>`
      SELECT
        r.id,
        r.service_id,
        r.tenant_id,
        r.method,
        r.path_pattern,
        r.policy_id,
        p.name AS policy_name,
        r.created_at
      FROM   routes   r
      LEFT JOIN policies p
        ON  p.id        = r.policy_id
        AND p.tenant_id = ${tenantId}
      WHERE  r.tenant_id  = ${tenantId}
        AND  r.service_id = ${serviceId}
      ORDER BY r.path_pattern ASC, r.method ASC
    `
		return rows.map(rowToRoute)
	}

	// returns all routes for a tenant — used by buildTrie at gateway startup;
	// this is the only cross-service query and it is intentionally tenant-scoped
	async listAllRoutesByTenant(tenantId: TenantId): Promise<Route[]> {
		const rows = await this.sql<RouteRow[]>`
      SELECT
        r.id,
        r.service_id,
        r.tenant_id,
        r.method,
        r.path_pattern,
        r.policy_id,
        p.name AS policy_name,
        r.created_at
      FROM   routes   r
      LEFT JOIN policies p
        ON  p.id        = r.policy_id
        AND p.tenant_id = ${tenantId}
      WHERE  r.tenant_id = ${tenantId}
      ORDER BY r.path_pattern ASC, r.method ASC
    `
		return rows.map(rowToRoute)
	}
}
