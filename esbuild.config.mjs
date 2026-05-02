import * as esbuild from 'esbuild'
import { glob } from 'glob'
import chokidar from 'chokidar'
import c from 'ansi-colors'
import columns from 'cli-columns'
import logUpdate from 'log-update'
import cliCursor from 'cli-cursor'
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { spawn } from 'node:child_process'

const formatSize = bytes => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

const formatTime = ms => {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

// Watch mode status display
let statusDisplay = {
  buildDev: null,    // { status: 'success'|'error', message: string, timestamp: string, errors?: string[] }
  buildProd: null,   // { status: 'success'|'error', message: string, timestamp: string, errors?: string[] }
  typecheck: null,   // { status: 'success'|'error', message: string, errors?: string[] }
}

let lastLineCount = 0

const renderStatus = () => {
  const lines = []
  
  // Build Dev status
  if (statusDisplay.buildDev) {
    const icon = statusDisplay.buildDev.status === 'success' ? c.green('✓') : c.red('✗')
    const statusColor = statusDisplay.buildDev.status === 'success' ? c.green : c.red
    lines.push(`${c.dim('[')}${c.cyan('build-dev')}${c.dim(']')} ${icon} ${c.dim(statusDisplay.buildDev.timestamp)} - ${statusColor(statusDisplay.buildDev.message)}`)
    if (statusDisplay.buildDev.errors && statusDisplay.buildDev.errors.length > 0) {
      lines.push(...statusDisplay.buildDev.errors.map(e => `${c.dim('[')}${c.cyan('build-dev')}${c.dim(']')}   ${e}`))
    }
  }
  
  // Build Prod status
  if (statusDisplay.buildProd) {
    const icon = statusDisplay.buildProd.status === 'success' ? c.green('✓') : c.red('✗')
    const statusColor = statusDisplay.buildProd.status === 'success' ? c.green : c.red
    lines.push(`${c.dim('[')}${c.cyan('build-prod')}${c.dim(']')} ${icon} ${c.dim(statusDisplay.buildProd.timestamp)} - ${statusColor(statusDisplay.buildProd.message)}`)
    if (statusDisplay.buildProd.errors && statusDisplay.buildProd.errors.length > 0) {
      lines.push(...statusDisplay.buildProd.errors.map(e => `${c.dim('[')}${c.cyan('build-prod')}${c.dim(']')}   ${e}`))
    }
  }
  
  // Typecheck status
  if (statusDisplay.typecheck) {
    let icon, statusColor
    if (statusDisplay.typecheck.status === 'checking') {
      icon = c.yellow('⟳')  // spinning/checking icon
      statusColor = c.yellow
    } else if (statusDisplay.typecheck.status === 'success') {
      icon = c.green('✓')
      statusColor = c.green
    } else {
      icon = c.red('✗')
      statusColor = c.red
    }
    lines.push(`${c.dim('[')}${c.yellow('typecheck')}${c.dim(']')} ${icon} ${statusColor(statusDisplay.typecheck.message)}`)
    if (statusDisplay.typecheck.errors && statusDisplay.typecheck.errors.length > 0) {
      lines.push(...statusDisplay.typecheck.errors.map(e => `${c.dim('[')}${c.yellow('typecheck')}${c.dim(']')}   ${e}`))
    }
  }
  
  // If output is shorter than before, clear first to avoid stray lines
  if (lines.length < lastLineCount) {
    logUpdate.clear()
  }
  
  const output = lines.join('\n')
  logUpdate(output)
  lastLineCount = lines.length
}

const updateBuildDevStatus = (status, message, errors = null) => {
  statusDisplay.buildDev = {
    status,
    message,
    timestamp: new Date().toLocaleTimeString(),
    errors: errors
  }
  renderStatus()
}

const updateBuildProdStatus = (status, message, errors = null) => {
  statusDisplay.buildProd = {
    status,
    message,
    timestamp: new Date().toLocaleTimeString(),
    errors: errors
  }
  renderStatus()
}

const updateTypecheckStatus = (status, message, errors = null) => {
  statusDisplay.typecheck = {
    status,
    message,
    errors: errors
  }
  renderStatus()
}

// Persistent log (for non-status messages)
const persistentLog = (message) => {
  logUpdate.clear()
  console.log(message)
  renderStatus()
}

// Type checker process manager
let typeCheckerProcess = null
const startTypeChecker = () => {
  if (typeCheckerProcess) {
    typeCheckerProcess.kill()
  }

  console.log(`${c.dim('Starting type checker...')}`)
  
  typeCheckerProcess = spawn('npx', ['tsgo', '-p', 'tsconfig.json', '--watch', '--noEmit'], {
    stdio: 'pipe',
    shell: true,
  })

  let buffer = ''
  let typecheckErrorLines = []
  let isInBuild = false
  
  const processOutput = (data) => {
    buffer += data.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop() // Keep incomplete line in buffer

    for (const line of lines) {
      if (line.trim()) {
        // tsgo output patterns
        if (line.includes('build starting')) {
          // New build started, show checking status
          typecheckErrorLines = []
          isInBuild = true
          updateTypecheckStatus('checking', 'Type checking in progress...')
        } else if (line.includes('build finished')) {
          // Build completed
          isInBuild = false
          if (typecheckErrorLines.length > 0) {
            updateTypecheckStatus('error', `Found ${typecheckErrorLines.length} error(s)`, typecheckErrorLines)
          } else {
            updateTypecheckStatus('success', 'No type errors')
          }
        } else if (line.includes('error TS')) {
          // Type error line
          typecheckErrorLines.push(c.red(line.trim()))
        } else if (isInBuild && line.match(/^\s+at /)) {
          // Error context (indented)
          typecheckErrorLines.push(c.dim(line.trim()))
        }
      }
    }
  }

  typeCheckerProcess.stdout.on('data', processOutput)
  typeCheckerProcess.stderr.on('data', processOutput)

  typeCheckerProcess.on('exit', (code) => {
    if (code !== null && code !== 0) {
      console.log(`${c.dim('[')}${c.yellow('typecheck')}${c.dim(']')} ${c.red('Type checker exited with code')} ${code}`)
    }
  })
}

const stopTypeChecker = () => {
  if (typeCheckerProcess) {
    typeCheckerProcess.kill()
    typeCheckerProcess = null
  }
}

const shutdownHandlers = []
let isShuttingDown = false

const addShutdownHandler = handler => {
  shutdownHandlers.push(handler)
}

const runShutdownHandlers = async () => {
  while (shutdownHandlers.length > 0) {
    const handler = shutdownHandlers.pop()
    try {
      await handler()
    } catch {}
  }
}

const shutdown = async () => {
  if (isShuttingDown) return
  isShuttingDown = true
  await runShutdownHandlers()
  cliCursor.show()
  stopTypeChecker()
  process.exit(0)
}

// Cleanup on exit
process.on('SIGINT', () => {
  void shutdown()
})

process.on('SIGTERM', () => {
  void shutdown()
})

const commonConfig = {
  bundle: true,
  outbase: 'src',
  outdir: 'dist',
  format: 'esm',
  platform: 'node',
  entryNames: '[dir]/[name]/main',
  outExtension: { '.js': '.mjs' },
  external: ['game', 'arena'],
  tsconfig: 'tsconfig.json',
  logLevel: 'silent', // We'll handle logging ourselves
}

// Expand glob patterns
const expandGlobs = async patterns => {
  const files = await Promise.all(patterns.map(p => glob(p, { nodir: true })))
  return [...new Set(files.flat())].sort()
}

const configPatterns = {
  default: ['src/**/main/*.ts',],
}



// Parse command line arguments
const args = process.argv.slice(2)
const watch = args.includes('--watch')
const prod = args.includes('--prod') || process.env.NODE_ENV === 'production'
const target = args.find(arg => !arg.startsWith('--')) || 'default'

const patterns = configPatterns[target]
if (!patterns) {
  console.error(`Unknown target: ${target}. Available: default`)
  process.exit(1)
}

// Get entry points
let entryPoints = await expandGlobs(patterns)

const toOutputKey = (entryPoint, mode) =>
  entryPoint
    .replace(/^src\//, '')
    .replace('/main/', '/')
    .replace(/\.ts$/, `/${mode}/main`)

const INLINE_SOURCEMAP_REGEX = /\/\/\#\s*sourceMappingURL=data:application\/json(?:;charset=[^;,]+)?;base64,([^\s]+)/m

const sanitizeSourceMap = mapObj => {
  if (mapObj.sourcesContent) delete mapObj.sourcesContent
  if (mapObj.names && mapObj.names.length > 0) delete mapObj.names
  return mapObj
}

const createEmbeddedSourcemapHeader = mapBase64 =>
  `// Embedded sourcemap for runtime error mapping\n` +
  `globalThis.__EMBEDDED_SOURCEMAP = { __base64: "${mapBase64}", __lineOffset: 3 };\n\n`


// sourcemap埋め込みプラグイン（dev専用）
const embedInlineSourcemapPlugin = (watchMode) => ({
  name: 'embed-inline-sourcemap',
  setup(build) {
    const sourcemapCache = new Map()
    const outCache = new Map()
    build.onEnd(async result => {
      if (!result.metafile) return
      const outputs = Object.keys(result.metafile.outputs).filter(p => p.endsWith('.mjs'))

      // 変更出力のみ処理
      const changedOutputs = []
      if (watchMode) {
        for (const outPath of outputs) {
          try {
            if (!existsSync(outPath)) continue
            const st = statSync(outPath)
            const prev = outCache.get(outPath)
            if (prev && prev.mtimeMs === st.mtimeMs && prev.size === st.size) continue
            outCache.set(outPath, { mtimeMs: st.mtimeMs, size: st.size })
            changedOutputs.push(outPath)
          } catch {}
        }
      } else {
        changedOutputs.push(...outputs)
      }

      await Promise.all(changedOutputs.map(async outPath => {
        try {
          if (!existsSync(outPath)) return
          let js = readFileSync(outPath, 'utf-8')
          const mapPath = `${outPath}.map`
          let mapBase64 = null

          if (existsSync(mapPath)) {
            const st = statSync(mapPath)
            const cacheKey = `${mapPath}:${st.mtimeMs}:${st.size}`
            mapBase64 = sourcemapCache.get(cacheKey) ?? null

            if (!mapBase64) {
              const compactJson = JSON.stringify(sanitizeSourceMap(JSON.parse(readFileSync(mapPath, 'utf-8'))))
              mapBase64 = Buffer.from(compactJson, 'utf-8').toString('base64')
              sourcemapCache.set(cacheKey, mapBase64)
            }
          } else {
            const inlineMatch = js.match(INLINE_SOURCEMAP_REGEX)
            if (!inlineMatch) return
            const inlineBase64 = inlineMatch[1]
            const cacheKey = `${outPath}:inline:${inlineBase64.length}:${inlineBase64.slice(0, 64)}`
            mapBase64 = sourcemapCache.get(cacheKey) ?? null

            if (!mapBase64) {
              const compactJson = JSON.stringify(sanitizeSourceMap(JSON.parse(Buffer.from(inlineBase64, 'base64').toString('utf-8'))))
              mapBase64 = Buffer.from(compactJson, 'utf-8').toString('base64')
              sourcemapCache.set(cacheKey, mapBase64)
            }
          }

          if (!mapBase64) return

          js = js.replace(/\n?\/\/\#\s*sourceMappingURL=.+$/m, '')
          writeFileSync(outPath, createEmbeddedSourcemapHeader(mapBase64) + js, 'utf-8')
        } catch (err) {
          console.error(`[sourcemap] Error processing ${outPath}:`, err)
        }
      }))
    })
  },
})

const buildConfigForMode = (mode) => {
  const isProd = mode === 'prod'
  return {
    ...commonConfig,
    entryPoints: Object.fromEntries(
      entryPoints.map(entryPoint => [toOutputKey(entryPoint, mode), entryPoint]),
    ),
    outdir: 'dist',
    entryNames: '[dir]/[name]',
    metafile: true,
    minify: isProd,
    legalComments: isProd ? 'none' : 'eof',
    define: { 'process.env.NODE_ENV': isProd ? '"production"' : '"development"' },
    drop: ['debugger'],
    keepNames: !isProd,
    sourcemap: isProd ? false : 'inline',
    sourcesContent: false,
    plugins: [!isProd && embedInlineSourcemapPlugin(false)].filter(Boolean),
  }
}

if (watch) {
  cliCursor.hide()
  console.log(`\n${c.cyan.bold('👀 Watch Mode - Screeps Arena (dev & prod)')}`)
  console.log(c.dim('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'))
  console.log(`${c.dim('Target:')} ${c.yellow(target)}  ${c.dim('Entries:')} ${c.blue(entryPoints.length)} files`)
  console.log(c.dim('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'))
  console.log(c.dim('Starting initial build (dev → prod) ...'))

  // Start type checker in parallel
  startTypeChecker()
  // Initialize typecheck status to prevent it from disappearing
  updateTypecheckStatus('checking', 'Type checking in progress...')

  // 初回は順序を固定して dev → prod の順で同期ビルド
  try {
    const devStart = Date.now()
    const devResult = await esbuild.build(buildConfigForMode('dev'))
    const devTime = Date.now() - devStart
    const outputs = devResult.metafile 
      ? Object.entries(devResult.metafile.outputs).filter(([path]) => path.endsWith('.mjs'))
      : []
    if (outputs.length > 0) {
      const byDir = {}
      for (const [path, info] of outputs) {
        const dir = path.replace(/\/main\.mjs$/, '').replace(/^dist\//, '')
        try { byDir[dir] = statSync(path).size } catch { byDir[dir] = info.bytes }
      }
      const entries = Object.entries(byDir).sort().map(([dir, size]) => `${c.magenta('›')} ${dir} ${c.dim(`(${formatSize(size)})`)}`)
      console.log(c.dim('Initial output (dev):'))
      console.log(columns(entries, { width: process.stdout.columns || 100 }))
      const totalSize = outputs.reduce((sum, [p, info]) => { try { return sum + statSync(p).size } catch { return sum + info.bytes } }, 0)
      console.log(`\n  ${c.dim('Total:')} ${c.magenta(outputs.length)} files ${c.dim(`(${formatSize(totalSize)})`)}  ${c.dim('Time:')} ${c.green(formatTime(devTime))}`)
    }
  } catch (error) {
    console.log(c.dim('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'))
    console.error(`${c.bold('❌ Initial build failed (dev)')}`)
    if (error.errors && error.errors.length > 0) {
      for (const err of error.errors.slice(0, 3)) {
        console.error(c.dim(`${err.location?.file}:${err.location?.line}:${err.location?.column}`))
        console.error(`  ${err.text}`)
      }
      if (error.errors.length > 3) console.error(c.dim(`  ... and ${error.errors.length - 3} more errors`))
    } else {
      console.error(error.message || error)
    }
    process.exit(1)
  }

  try {
    const prodStart = Date.now()
    const prodResult = await esbuild.build(buildConfigForMode('prod'))
    const prodTime = Date.now() - prodStart
    const outputs = prodResult.metafile 
      ? Object.entries(prodResult.metafile.outputs).filter(([path]) => path.endsWith('.mjs'))
      : []
    if (outputs.length > 0) {
      const byDir = {}
      for (const [path, info] of outputs) {
        const dir = path.replace(/\/main\.mjs$/, '').replace(/^dist\//, '')
        try { byDir[dir] = statSync(path).size } catch { byDir[dir] = info.bytes }
      }
      const entries = Object.entries(byDir).sort().map(([dir, size]) => `${c.magenta('›')} ${dir} ${c.dim(`(${formatSize(size)})`)}`)
      console.log(c.dim('Initial output (prod):'))
      console.log(columns(entries, { width: process.stdout.columns || 100 }))
      const totalSize = outputs.reduce((sum, [p, info]) => { try { return sum + statSync(p).size } catch { return sum + info.bytes } }, 0)
      console.log(`\n  ${c.dim('Total:')} ${c.magenta(outputs.length)} files ${c.dim(`(${formatSize(totalSize)})`)}  ${c.dim('Time:')} ${c.green(formatTime(prodTime))}`)
    }
  } catch (error) {
    console.log(c.dim('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'))
    console.error(`${c.bold('❌ Initial build failed (prod)')}`)
    if (error.errors && error.errors.length > 0) {
      for (const err of error.errors.slice(0, 3)) {
        console.error(c.dim(`${err.location?.file}:${err.location?.line}:${err.location?.column}`))
        console.error(`  ${err.text}`)
      }
      if (error.errors.length > 3) console.error(c.dim(`  ... and ${error.errors.length - 3} more errors`))
    } else {
      console.error(error.message || error)
    }
    process.exit(1)
  }

  console.log(c.dim('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'))
  console.log(`${c.dim('Watching for changes...')}`)
  console.log(`${c.dim('Status will be displayed below:')}\n`)

  // Initialize status display
  renderStatus()

  let ctxDev = null
  let ctxProd = null
  let entryWatcher = null
  let refreshTimer = null
  let isRefreshingEntries = false

  const createWatchPlugin = mode => ({
    name: `watch-plugin-${mode}`,
    setup(build) {
      // 初回は上で同期ビルド済みなので抑制
      let isFirstBuild = false
      build.onEnd(result => {
        if (result.errors.length > 0) {
          const errorLines = []
          for (const err of result.errors.slice(0, 3)) {
            errorLines.push(c.dim(`${err.location?.file}:${err.location?.line}:${err.location?.column}`))
            errorLines.push(err.text)
          }
          if (result.errors.length > 3) {
            errorLines.push(c.dim(`... and ${result.errors.length - 3} more errors`))
          }
          if (mode === 'dev') {
            updateBuildDevStatus('error', 'Build failed', errorLines)
          } else {
            updateBuildProdStatus('error', 'Build failed', errorLines)
          }
        } else {
          if (isFirstBuild) {
            const outputs = result.metafile
              ? Object.entries(result.metafile.outputs).filter(([path]) => path.endsWith('.mjs'))
              : []
            if (outputs.length > 0) {
              const byDir = {}
              for (const [path, info] of outputs) {
                const dir = path.replace(/\/main\.mjs$/, '').replace(/^dist\//, '')
                try {
                  const st = statSync(path)
                  byDir[dir] = st.size
                } catch {
                  byDir[dir] = info.bytes
                }
              }
              const entries = Object.entries(byDir)
                .sort()
                .map(([dir, size]) => `${c.magenta('›')} ${dir} ${c.dim(`(${formatSize(size)})`)}`)
              persistentLog(c.dim(mode === 'dev' ? 'Initial build output:' : 'Initial build output (prod):'))
              persistentLog(columns(entries, { width: process.stdout.columns || 100 }))
              const totalSize = outputs.reduce((sum, [p, info]) => {
                try { return sum + statSync(p).size } catch { return sum + info.bytes }
              }, 0)
              persistentLog(`\n  ${c.dim('Total:')} ${c.magenta(outputs.length)} files ${c.dim(`(${formatSize(totalSize)})`)}`)
              persistentLog(c.dim('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'))
            }
            isFirstBuild = false
          }
          if (mode === 'dev') {
            updateBuildDevStatus('success', 'Build succeeded')
          } else {
            updateBuildProdStatus('success', 'Build succeeded')
          }
        }
      })
    },
  })

  const startWatchContexts = async () => {
    const devWatchConfig = {
      ...buildConfigForMode('dev'),
      plugins: [embedInlineSourcemapPlugin(true)],
    }
    ctxDev = await esbuild.context({
      ...devWatchConfig,
      plugins: [
        ...(devWatchConfig.plugins || []),
        createWatchPlugin('dev'),
      ],
    })
    await ctxDev.watch()

    const prodWatchConfig = {
      ...buildConfigForMode('prod'),
    }
    ctxProd = await esbuild.context({
      ...prodWatchConfig,
      plugins: [
        ...(prodWatchConfig.plugins || []),
        createWatchPlugin('prod'),
      ],
    })
    await ctxProd.watch()
  }

  const refreshEntryPoints = async reason => {
    if (isRefreshingEntries) return
    isRefreshingEntries = true
    try {
      const nextEntryPoints = await expandGlobs(patterns)
      const hasChanges =
        nextEntryPoints.length !== entryPoints.length ||
        nextEntryPoints.some((entry, index) => entry !== entryPoints[index])

      if (!hasChanges) return

      const prevCount = entryPoints.length
      entryPoints = nextEntryPoints
      persistentLog(`${c.dim('Entry points changed:')} ${c.yellow(reason)} ${c.dim(`(${prevCount} -> ${entryPoints.length})`)}`)

      await ctxDev?.dispose()
      await ctxProd?.dispose()
      ctxDev = null
      ctxProd = null
      await startWatchContexts()
      persistentLog(c.dim('Watch contexts refreshed with updated entry points'))
    } catch (error) {
      const message = error?.message || String(error)
      updateBuildDevStatus('error', 'Failed to refresh watch contexts', [message])
      updateBuildProdStatus('error', 'Failed to refresh watch contexts', [message])
    } finally {
      isRefreshingEntries = false
    }
  }

  const scheduleEntryRefresh = reason => {
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      void refreshEntryPoints(reason)
    }, 120)
  }

  await startWatchContexts()

  entryWatcher = chokidar.watch(['src/**/main', ...patterns], {
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 120,
      pollInterval: 20,
    },
  })

  const onEntryEvent = (eventName, changedPath) => {
    const isTsFile = changedPath.endsWith('.ts')
    const isMainDir = /(^|[/\\])main$/.test(changedPath)
    if (!isTsFile && !isMainDir) return
    scheduleEntryRefresh(`${eventName}: ${changedPath}`)
  }

  entryWatcher.on('add', path => onEntryEvent('add', path))
  entryWatcher.on('unlink', path => onEntryEvent('unlink', path))
  entryWatcher.on('addDir', path => onEntryEvent('addDir', path))
  entryWatcher.on('unlinkDir', path => onEntryEvent('unlinkDir', path))
  entryWatcher.on('error', error => {
    const message = error?.message || String(error)
    updateBuildDevStatus('error', 'Entry watcher error', [message])
    updateBuildProdStatus('error', 'Entry watcher error', [message])
  })

  addShutdownHandler(async () => {
    if (refreshTimer) {
      clearTimeout(refreshTimer)
      refreshTimer = null
    }
    await entryWatcher?.close()
    await ctxDev?.dispose()
    await ctxProd?.dispose()
  })
} else {
  // dev → prod の順にビルド（エラー即時表示・中断）
  console.log(`\n${c.cyan.bold('⚡ Building Screeps Arena (dev)')}`)
  console.log(c.dim('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'))
  const devStart = Date.now()
  try {
    const devResult = await esbuild.build(buildConfigForMode('dev'))
    const devTime = Date.now() - devStart
    const outputs = devResult.metafile 
      ? Object.entries(devResult.metafile.outputs).filter(([path]) => path.endsWith('.mjs'))
      : []
    if (outputs.length > 0) {
      const byDir = {}
      for (const [path, info] of outputs) {
        const dir = path.replace(/\/main\.mjs$/, '').replace(/^dist\//, '')
        try { byDir[dir] = statSync(path).size } catch { byDir[dir] = info.bytes }
      }
      const entries = Object.entries(byDir).sort().map(([dir, size]) => `${c.magenta('›')} ${dir} ${c.dim(`(${formatSize(size)})`)}`)
      console.log(c.dim('Output (dev):'))
      console.log(columns(entries, { width: process.stdout.columns || 100 }))
      const totalSize = outputs.reduce((sum, [p, info]) => { try { return sum + statSync(p).size } catch { return sum + info.bytes } }, 0)
      console.log(`\n  ${c.dim('Total:')} ${c.magenta(outputs.length)} files ${c.dim(`(${formatSize(totalSize)})`)}  ${c.dim('Time:')} ${c.green(formatTime(devTime))}`)
    }
  } catch (error) {
    console.log(c.dim('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'))
    console.error(`${c.bold('❌ Build failed (dev)')}`)
    if (error.errors && error.errors.length > 0) {
      for (const err of error.errors.slice(0, 3)) {
        console.error(c.dim(`${err.location?.file}:${err.location?.line}:${err.location?.column}`))
        console.error(`  ${err.text}\n`)
      }
      if (error.errors.length > 3) console.error(c.dim(`... and ${error.errors.length - 3} more errors\n`))
    } else {
      console.error(error.message || error)
    }
    process.exit(1)
  }

  console.log(`\n${c.cyan.bold('⚡ Building Screeps Arena (prod)')}`)
  console.log(c.dim('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'))
  const prodStart = Date.now()
  try {
    const prodResult = await esbuild.build(buildConfigForMode('prod'))
    const prodTime = Date.now() - prodStart
    const outputs = prodResult.metafile 
      ? Object.entries(prodResult.metafile.outputs).filter(([path]) => path.endsWith('.mjs'))
      : []
    if (outputs.length > 0) {
      const byDir = {}
      for (const [path, info] of outputs) {
        const dir = path.replace(/\/main\.mjs$/, '').replace(/^dist\//, '')
        try { byDir[dir] = statSync(path).size } catch { byDir[dir] = info.bytes }
      }
      const entries = Object.entries(byDir).sort().map(([dir, size]) => `${c.magenta('›')} ${dir} ${c.dim(`(${formatSize(size)})`)}`)
      console.log(c.dim('Output (prod):'))
      console.log(columns(entries, { width: process.stdout.columns || 100 }))
      const totalSize = outputs.reduce((sum, [p, info]) => { try { return sum + statSync(p).size } catch { return sum + info.bytes } }, 0)
      console.log(`\n  ${c.dim('Total:')} ${c.magenta(outputs.length)} files ${c.dim(`(${formatSize(totalSize)})`)}  ${c.dim('Time:')} ${c.green(formatTime(prodTime))}`)
    }
    console.log(c.dim('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'))
    console.log(`${c.green.bold('✓ Build successful!')}\n`)
  } catch (error) {
    console.log(c.dim('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'))
    console.error(`${c.bold('❌ Build failed (prod)')}`)
    if (error.errors && error.errors.length > 0) {
      for (const err of error.errors.slice(0, 3)) {
        console.error(c.dim(`${err.location?.file}:${err.location?.line}:${err.location?.column}`))
        console.error(`  ${err.text}\n`)
      }
      if (error.errors.length > 3) console.error(c.dim(`... and ${error.errors.length - 3} more errors\n`))
    } else {
      console.error(error.message || error)
    }
    process.exit(1)
  }
}

