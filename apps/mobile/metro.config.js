// Metro config for the bun-workspace monorepo (Expo "Work with monorepos").
// Watch the repo root so Metro bundles packages/core straight from source, and
// resolve modules from both the app's and the root's node_modules.
const { getDefaultConfig } = require('expo/metro-config')
const path = require('node:path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)
config.watchFolders = [workspaceRoot]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]
// bun's isolated store symlinks workspace packages; @tg/core ships .ts via package
// exports, both of which Metro needs told about explicitly.
config.resolver.unstable_enableSymlinks = true
config.resolver.unstable_enablePackageExports = true

module.exports = config
