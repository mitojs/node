import { isFunction } from './is'

export const WRAPPED = '__wrapped__'
export const UNWRAP = '__unwrap__'
export const ORIGINAL = '__original__'

export interface AnyObject {
	[key: string]: any
}

// Default to complaining loudly when things don't go according to plan.
const logger = console.error.bind(console)

export function defineProperty(obj: AnyObject, name: string | symbol, value: unknown, descriptor?: PropertyDescriptor) {
	try {
		Object.defineProperty(obj, name, {
			configurable: descriptor?.configurable ?? true,
			enumerable: descriptor?.enumerable ?? true,
			writable: descriptor?.writable ?? true,
			value,
		})
	} catch (error) {
		logger(error)
	}
}

export function wrap<T extends AnyObject, K extends keyof T>(
	nodule: T,
	name: K,
	wrapper: (origin: T[K], name: K) => T[K]
) {
	if (!nodule || !nodule[name]) {
		logger(`no original function ${name as string} to wrap`)
		return
	}

	if (!wrapper) {
		logger('no wrapper function')
		logger(new Error().stack)
		return
	}

	if (!isFunction(nodule[name]) || !isFunction(wrapper)) {
		logger('original object and wrapper must be functions')
		return
	}

	const original = nodule[name]
	const wrapped = wrapper(original, name)

	// assign own properties
	for (const ownKey of Reflect.ownKeys(original)) {
		if (ownKey === 'prototype') continue
		defineProperty(wrapped, ownKey, original[ownKey], Object.getOwnPropertyDescriptor(original, ownKey))
	}

	const descriptorWithNonEnumerable = {
		enumerable: false,
	}
	defineProperty(wrapped, ORIGINAL, original, descriptorWithNonEnumerable)
	// prepare for unwrapping
	defineProperty(
		wrapped,
		UNWRAP,
		() => {
			// If no one else wrap it again, it can be "unwrap" when call unwrap function
			if (nodule[name] === wrapped) {
				defineProperty(nodule, name as string, original)
			}
		},
		descriptorWithNonEnumerable
	)
	defineProperty(wrapped, WRAPPED, true, descriptorWithNonEnumerable)

	// hook original function
	defineProperty(nodule, name as string, wrapped)
	return wrapped
}

export function unwrap(nodule: AnyObject, name: string) {
	if (!nodule || !nodule[name]) {
		logger('no function to unwrap.')
		logger(new Error().stack)
		return
	}

	if (!nodule[name][UNWRAP]) {
		logger(`no original to unwrap to -- has ${name} already been unwrapped?`)
	} else {
		return nodule[name][UNWRAP]()
	}
}
