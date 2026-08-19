// The shipped version, read from the one place it is already maintained. Kept in its own module
// so the JSON import has a single entry point rather than being scattered through components.
import pkg from '../package.json'

export const APP_VERSION: string = pkg.version
