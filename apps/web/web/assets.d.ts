// `import x from './y.wasm' with { type: 'file' }` gives the URL the bundler emitted the
// asset at (Bun's `file` loader). TypeScript has no idea, so declare the shape once.
declare module '*.wasm' {
  const url: string
  export default url
}
