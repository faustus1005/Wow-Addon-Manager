/**
 * Icon setup helper.
 *
 * Usage:
 *   node scripts/setup-icon.js path/to/your-logo.png
 *
 * Copies the supplied PNG to:
 *   resources/icon.png  – runtime window/tray icon (dev + packaged)
 *   build/icon.png      – electron-builder source for ICO / ICNS generation
 *
 * electron-builder converts build/icon.png to the appropriate format for each
 * target platform automatically (requires ImageMagick on Linux/macOS, or
 * runs natively on Windows).
 */

const fs   = require('fs')
const path = require('path')

const [,, src] = process.argv
if (!src) {
  console.error('Usage: node scripts/setup-icon.js <path-to-icon.png>')
  process.exit(1)
}

const srcResolved = path.resolve(src)
if (!fs.existsSync(srcResolved)) {
  console.error(`File not found: ${srcResolved}`)
  process.exit(1)
}

const root = path.resolve(__dirname, '..')
const destinations = [
  path.join(root, 'resources', 'icon.png'),
  path.join(root, 'build',     'icon.png'),
]

for (const dest of destinations) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(srcResolved, dest)
  console.log(`✓  Copied → ${path.relative(root, dest)}`)
}

console.log('\nDone. Run `npm run package:win` to build.')
