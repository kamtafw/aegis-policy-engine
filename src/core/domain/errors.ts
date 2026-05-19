// shared domain error types
// placed here to ensure consistent error identity — route handlers
// do a single instanceof check regardless of which service threw
//
// plane: core/domain — no imports from anywhere else

export class DomainError extends Error {
	constructor(message: string) {
		super(message)
		this.name = this.constructor.name
	}
}

/** thrown when a resource does not exist within the given tenant → HTTP 404 */
export class NotFoundError extends DomainError {
	readonly code = "NOT_FOUND" as const
	constructor(message: string) {
		super(message)
	}
}

/** thrown when a create would violate a uniqueness constraint → HTTP 409 */
export class ConflictError extends DomainError {
	readonly code = "CONFLICT" as const
	constructor(message: string) {
		super(message)
	}
}
