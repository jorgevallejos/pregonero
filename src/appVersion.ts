// The shipped version, read from the one place it is already maintained.
//
// **Nothing in the renderer reads this today** (2026-09-05). Standby's masthead was its only
// consumer and the masthead came off in `v0.68.0`. It is kept rather than deleted because the
// design names its next reader rather than hoping for one: **standalone, the player keeps its name
// and its version**, the way Bombista does on `--no-header`, and that arrives with the extraction.
//
// **What the version is read from meanwhile is the bundle itself** — `Tramoya → About Tramoya`,
// which is Electron's default macOS menu over `CFBundleShortVersionString`. No custom application
// menu is installed, so that item is present by construction.
//
// The NAMED import matters. `import pkg from '../package.json'` pulls the whole manifest into the
// renderer bundle — scripts, dependencies and every pinned devDependency version — because Vite
// cannot tree-shake a default JSON import. Importing the single field lets it emit just the
// string, which is all a masthead needs and all a distributed app should carry.
import { version } from '../package.json'

export const APP_VERSION: string = version
