import type { TenantId, RoleId } from "./ids"

export interface Role {
	readonly id: RoleId
	readonly tenantId: TenantId
	readonly name: string
	readonly createdAt: Date
}
