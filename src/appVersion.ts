// The shipped version, read from the one place it is already maintained.
//
// The NAMED import matters. `import pkg from '../package.json'` pulls the whole manifest into the
// renderer bundle — scripts, dependencies and every pinned devDependency version — because Vite
// cannot tree-shake a default JSON import. Importing the single field lets it emit just the
// string, which is all a masthead needs and all a distributed app should carry.
import { version } from '../package.json'

export const APP_VERSION: string = version
