import styles from 'ansi-styles'
import { toByteArray } from 'base64-js'
import { getCpuTime, getTicks } from 'game/utils'
import log from 'loglevel'
import { unpack as utf8Unpack } from 'utf8-buffer'

const levelColors = new Map<string, string>([
  ['TRACE', `${styles.magenta.open}TRACE${styles.magenta.close}`],
  ['DEBUG', `${styles.blue.open}DEBUG${styles.blue.close}`],
  ['INFO', `${styles.cyan.open}INFO ${styles.cyan.close}`],
  ['WARN', `${styles.yellow.open}WARN ${styles.yellow.close}`],
  ['ERROR', `${styles.red.open}ERROR${styles.red.close}`],
])

let previousLogTime = 0

function logTimeFormatter(time: number) {
  const sec = Math.floor(time / 1_000_000_000).toFixed(0)
  const ms = Math.floor((time / 1_000_000) % 1000)
    .toFixed(0)
    .padStart(3, '0')
  const us = Math.floor((time / 1000) % 1000)
    .toFixed(0)
    .padStart(3, '0')
  const ns = Math.floor(time % 1000)
    .toFixed(0)
    .padStart(3, '0')
  return `${sec}.${ms}_${us}_${ns}`
}

const errorTicks: number[] = []

// Using loglevel-plugin-prefix would be simpler, but new Date() is removed in the Screeps runtime,
// so this is implemented by overriding methodFactory instead.
const originalFactory = log.methodFactory
log.methodFactory = (methodName, level, loggerName) => {
  const raw = originalFactory(methodName, level, loggerName)
  return (...args: any[]) => {
    // Build the formatted message.
    const levelString = levelColors.get(methodName.toUpperCase()) ?? methodName
    const nameLength = 16
    const loggerNameStr = String(loggerName)
    const nameString = `${styles.green.open}${loggerNameStr ? (loggerNameStr.length <= nameLength ? loggerNameStr.padEnd(nameLength) : `${loggerNameStr.slice(0, nameLength - 2)}..`) : 'default'}${styles.green.close}`
    const cpuTime = getCpuTime()
    const timeString = logTimeFormatter(cpuTime)

    if (cpuTime < previousLogTime) {
      previousLogTime = 0 // Reset when the tick has changed.
    }
    const duration = cpuTime - previousLogTime
    const timeStyle = duration > 1_000_000 ? styles.magenta : styles.gray
    previousLogTime = cpuTime
    const durationString = `${(duration / 1_000_000).toFixed(3)}ms`

    const prefix = `${timeStyle.open}[${timeString}] (${durationString})${timeStyle.close} ${levelString} ${nameString}:`

    // Build suffix content to append at the end (for example, file name).
    const callerFile = getCallerFileName()
    const fileString = callerFile ? ` ${styles.gray.open}[${callerFile}]${styles.gray.close}` : ''

    // Add the prefix as the first argument.
    raw(prefix, ...args, fileString)
  }
}

export class Logger {
  logEnabled: boolean
  name: string
  logger: log.Logger

  constructor(name: string, logEnabled: boolean = true) {
    this.logEnabled = logEnabled
    this.name = name
    this.logger = log.getLogger(name)
    if (logEnabled) {
      this.logger.setLevel('info')
    } else {
      this.logger.setLevel('warn')
    }
  }

  debug(...data: any[]) {
    this.logger.debug(...data)
  }

  warn(...data: any[]) {
    this.logger.warn(...data)
  }

  error(...data: any[]) {
    this.logger.error(...data)
    errorTicks.push(getTicks())
  }

  info(...data: any[]) {
    if (this.logEnabled) {
      this.logger.info(...data)
    }
  }

  log(...data: any[]) {
    if (this.logEnabled) {
      this.logger.log(...data)
    }
  }

  showError(e: unknown, message?: string, context?: string) {
    // Automatically capture caller information as context.
    let autoContext = context
    const extraMessage = message
    if (!autoContext) {
      // Identify caller information from the Error stack.
      const err = new Error()
      if (err.stack) {
        const stackLines = err.stack.split('\n')
        // 0: Error, 1: this function, 2: caller
        if (stackLines.length >= 3) {
          const caller = stackLines[2].trim()
          // Example: at loop (file:///user/main:1047:12)
          const match = caller.match(/^(at\s+)?([^(\s]+) \((.+):(\d+):(\d+)\)$/)
          if (match) {
            const funcName = match[2]
            const file = match[3]
            const lineNum = Number(match[4])
            const colNum = Number(match[5])
            let mapped = null
            // Apply source map conversion only for main.mjs or file:///user/main.
            if (/main\.mjs|file:\/\/\/user\/main/i.test(file)) {
              const mapInfo = getEmbeddedSourceMap()
              if (mapInfo) {
                const { map: embeddedMap, lineOffset } = mapInfo
                try {
                  const adjustedLine = lineNum - lineOffset
                  const originalPos = decodeSourceMap(embeddedMap, adjustedLine, colNum)
                  if (originalPos) {
                    const cleanSource = originalPos.source.replace(/^(\.\.\/)*src\//, 'src/')
                    mapped = `${funcName} (${cleanSource}:${originalPos.line}:${originalPos.column})`
                  }
                } catch {}
              }
            }
            autoContext = mapped || caller.replace(/^at\s+/, '')
          } else {
            autoContext = caller.replace(/^at\s+/, '')
          }
        }
      }
    }
    if (!(e && typeof e === 'object')) {
      this.error(`[${autoContext}] ${extraMessage ? `${extraMessage}: ` : ''}${String(e)}`)
      return
    }
    const err = e as any
    const stack: string | undefined = err.stack
    const msg = extraMessage || err?.message || 'Unknown error'

    // Parse stack trace lines and map them with source maps.
    if (stack) {
      const mapInfo = getEmbeddedSourceMap()

      const lines = String(stack).split('\n')
      const mappedLines: string[] = []

      for (const line of lines) {
        // Find lines that include main.mjs or file:///user/main.
        const match = line.match(/^(\s*at\s+.+?\s+)?(.+?):(\d+):(\d+)\)?$/)
        if (match && /main\.mjs|file:\/\/\/user\/main/i.test(line) && mapInfo) {
          const prefix = match[1] || ''
          const lineNum = Number(match[3])
          const colNum = Number(match[4])

          try {
            const { map: embeddedMap, lineOffset } = mapInfo
            const adjustedLine = lineNum - lineOffset
            const originalPos = decodeSourceMap(embeddedMap, adjustedLine, colNum)
            if (originalPos) {
              // Replace with original source info (shorten ../../src/ to src/).
              const cleanSource = originalPos.source.replace(/^\.\.\/\.\.\/src\//, 'src/')
              mappedLines.push(`${prefix}${cleanSource}:${originalPos.line}:${originalPos.column})`)
              continue
            }
          } catch {
            // If mapping fails, keep the original line.
          }
        }
        // Keep unmapped lines as-is.
        mappedLines.push(line)
      }

      // Show the full stack trace (preserving the Error: message format).
      this.error(`[${autoContext}] ${msg}\n${mappedLines.join('\n')}`)
    } else {
      // If there is no stack trace, output only the message.
      this.error(`[${autoContext}] ${msg}`)
    }
  }
}

export function getErrorTicks() {
  return errorTicks
}

type EmbeddedSourceMapInfo = {
  map: any
  lineOffset: number
}

type SourcePositionState = {
  sourceIndex: number
  sourceLine: number
  sourceColumn: number
}

type DecodedSegment = SourcePositionState & {
  genColumn: number
}

type DecodedLineInfo = {
  segments: DecodedSegment[]
  lastState: SourcePositionState | null
}

function getEmbeddedSourceMap(): EmbeddedSourceMapInfo | null {
  let embeddedMap = (globalThis as any).__EMBEDDED_SOURCEMAP
  if (!embeddedMap) {
    return null
  }

  const lineOffset = embeddedMap.__lineOffset || 0

  if (embeddedMap.__base64 && !embeddedMap.mappings) {
    try {
      const jsonText = utf8Unpack(toByteArray(embeddedMap.__base64), 0)
      const decoded = JSON.parse(jsonText)
      decoded.__lineOffset = lineOffset
      ;(globalThis as any).__EMBEDDED_SOURCEMAP = decoded
      embeddedMap = decoded
    } catch {
      return null
    }
  }

  ensureDecodedMappings(embeddedMap)

  return {
    map: embeddedMap,
    lineOffset: embeddedMap.__lineOffset || lineOffset,
  }
}

function ensureDecodedMappings(map: any): DecodedLineInfo[] | null {
  if (!map || typeof map !== 'object') {
    return null
  }

  if (Array.isArray(map.__decodedMappings)) {
    return map.__decodedMappings as DecodedLineInfo[]
  }

  if (!map.mappings || !map.sources) {
    return null
  }

  const mappings = String(map.mappings).split(';')
  const decodedLines: DecodedLineInfo[] = []
  let sourceIndex = 0
  let sourceLine = 0
  let sourceColumn = 0
  let currentState: SourcePositionState | null = null

  for (const lineMapping of mappings) {
    const segments: DecodedSegment[] = []
    if (lineMapping) {
      const segmentStrings = lineMapping.split(',')
      let genColumn = 0

      for (const segment of segmentStrings) {
        if (!segment) {
          continue
        }

        const decoded = decodeVLQ(segment)
        if (decoded.length === 0) {
          continue
        }

        genColumn += decoded[0]

        if (decoded.length >= 4) {
          sourceIndex += decoded[1]
          sourceLine += decoded[2]
          sourceColumn += decoded[3]
          currentState = {
            sourceIndex,
            sourceLine,
            sourceColumn,
          }
        }

        if (currentState) {
          segments.push({
            genColumn,
            sourceIndex: currentState.sourceIndex,
            sourceLine: currentState.sourceLine,
            sourceColumn: currentState.sourceColumn,
          })
        }
      }
    }

    decodedLines.push({
      segments,
      lastState: currentState,
    })
  }

  map.__decodedMappings = decodedLines
  return decodedLines
}

export function getCallerFileName(options?: { ignore?: RegExp[] }): string | null {
  const err = new Error()
  if (!err.stack) {
    return null
  }

  const ignorePatterns = [...(options?.ignore ?? []), /logger\.ts$/i, /loglevel/i]
  const shouldIgnore = (target: string) => ignorePatterns.some(pattern => pattern.test(target))

  const mapInfo = getEmbeddedSourceMap()
  const lines = err.stack.split('\n')

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line === 'Error') {
      continue
    }

    const match = line.match(/^at\s+(?:.+?\s+)?\(?(.+):(\d+):(\d+)\)?$/)
    if (!match) {
      continue
    }

    const file = match[1]
    const lineNum = Number(match[2])
    const colNum = Number(match[3])

    if (mapInfo && /main\.mjs|file:\/\/\/user\/main/i.test(file)) {
      try {
        const { map, lineOffset } = mapInfo
        const adjustedLine = lineNum - lineOffset
        const originalPos = decodeSourceMap(map, adjustedLine, colNum)
        if (originalPos) {
          const fileName = originalPos.source.replace(/^(\.\.\/)*src\//, 'src/')
          if (fileName && !shouldIgnore(fileName)) {
            return `${fileName}:${originalPos.line}`
          }
          continue
        }
      } catch {
        // ignore and fallback to unmapped info
      }
    }

    if (file && !shouldIgnore(file)) {
      return `${file}:${lineNum}`
    }
  }

  return null
}

// Simple sourcemap decoder - VLQ (Variable-Length Quantity) decoding
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const sourceMapCache = new WeakMap<any, Map<string, { source: string; line: number; column: number } | null>>()

function decodeVLQ(encoded: string): number[] {
  const result: number[] = []
  let shift = 0
  let value = 0

  for (let i = 0; i < encoded.length; i++) {
    let digit = BASE64_CHARS.indexOf(encoded[i])
    if (digit === -1) {
      continue
    }

    const continuation = digit & 0x20
    digit &= 0x1f
    value += digit << shift

    if (continuation) {
      shift += 5
    } else {
      const shouldNegate = value & 1
      value >>>= 1
      result.push(shouldNegate ? -value : value)
      value = 0
      shift = 0
    }
  }

  return result
}

function decodeSourceMap(map: any, line: number, column: number): { source: string; line: number; column: number } | null {
  if (!map || typeof map !== 'object' || !map.mappings || !map.sources) {
    return null
  }

  const decodedLines = ensureDecodedMappings(map)
  if (!decodedLines) {
    return null
  }

  let mapCache = sourceMapCache.get(map)
  if (!mapCache) {
    mapCache = new Map()
    sourceMapCache.set(map, mapCache)
  }

  const cacheKey = `${line}:${column}`
  if (mapCache.has(cacheKey)) {
    return mapCache.get(cacheKey) ?? null
  }

  try {
    if (line < 1 || line > decodedLines.length) {
      mapCache.set(cacheKey, null)
      return null
    }

    const lineInfo = decodedLines[line - 1]
    for (const segment of lineInfo.segments) {
      if (segment.genColumn >= column) {
        const source = map.sources[segment.sourceIndex]
        if (source) {
          const result = {
            source,
            line: segment.sourceLine + 1,
            column: segment.sourceColumn,
          }
          mapCache.set(cacheKey, result)
          return result
        }
      }
    }

    if (lineInfo.lastState) {
      const source = map.sources[lineInfo.lastState.sourceIndex]
      if (source) {
        const result = {
          source,
          line: lineInfo.lastState.sourceLine + 1,
          column: lineInfo.lastState.sourceColumn,
        }
        mapCache.set(cacheKey, result)
        return result
      }
    }
  } catch {
    // Silently fail if decoding fails
  }

  mapCache.set(cacheKey, null)
  return null
}
