const zlib = require('zlib')

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const COLOR_DISTANCE_TARGET = 0.52
const COLOR_DISTANCE_FLOOR = 0.34
const COLOR_DISTANCE_STEP = 0.03

class ColorAssigner {
  constructor () {
    this._faviconPaletteCache = new Map()
  }

  assignColors (serverRegistrations) {
    const changedColors = {}
    const assignedColors = []
    const sortedServers = serverRegistrations
      .slice()
      .sort((a, b) => a.serverId - b.serverId)

    const faviconServers = []
    const fallbackServers = []

    for (const serverRegistration of sortedServers) {
      if (serverRegistration.manualColor) {
        const color = normalizeHexColor(serverRegistration.manualColor)

        if (color && serverRegistration.data.color !== color) {
          serverRegistration.data.color = color
          changedColors[serverRegistration.serverId] = color
        }

        if (color) {
          assignedColors.push(hexToHsl(color))
        }
      } else if (this.hasUsableFaviconCandidate(serverRegistration)) {
        faviconServers.push(serverRegistration)
      } else {
        fallbackServers.push(serverRegistration)
      }
    }

    for (const serverRegistration of [...faviconServers, ...fallbackServers]) {
      const color = this.pickColor(serverRegistration, assignedColors)

      if (color && serverRegistration.data.color !== color) {
        serverRegistration.data.color = color
        changedColors[serverRegistration.serverId] = color
      }

      if (color) {
        assignedColors.push(hexToHsl(color))
      }
    }

    return changedColors
  }

  pickColor (serverRegistration, assignedColors) {
    const targetColors = this.getTargetColors(serverRegistration)
    const isFallbackOnly = !this.hasUsableFaviconCandidate(serverRegistration)

    return pickBestGeneratedColor(targetColors, assignedColors, isFallbackOnly)
  }

  hasUsableFaviconCandidate (serverRegistration) {
    return this.getFaviconCandidates(serverRegistration).length > 0
  }

  getTargetColors (serverRegistration) {
    const faviconCandidates = this.getFaviconCandidates(serverRegistration)

    if (faviconCandidates.length > 0) {
      return faviconCandidates
    }

    return generateFallbackCandidates(serverRegistration.data.name)
  }

  getFaviconCandidates (serverRegistration) {
    const favicon = serverRegistration.lastFavicon || serverRegistration.data.favicon

    if (!favicon || !favicon.startsWith('data:image/png;base64,')) {
      return []
    }

    const faviconCacheKey = serverRegistration.faviconHash || favicon

    if (!this._faviconPaletteCache.has(faviconCacheKey)) {
      const palette = extractColorPaletteFromPngDataUri(favicon)
      this._faviconPaletteCache.set(faviconCacheKey, palette)
    }

    const palette = this._faviconPaletteCache.get(faviconCacheKey)

    if (palette.length === 0) {
      return []
    }

    return palette
  }
}

function extractColorPaletteFromPngDataUri (dataUri) {
  try {
    const pngBuffer = Buffer.from(dataUri.replace(/^data:image\/png;base64,/, ''), 'base64')
    const pixels = decodePng(pngBuffer)
    return buildPaletteFromPixels(pixels)
  } catch (err) {
    return []
  }
}

function decodePng (buffer) {
  if (buffer.length < PNG_SIGNATURE.length || !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error('Invalid PNG signature')
  }

  let offset = PNG_SIGNATURE.length
  let width
  let height
  let bitDepth
  let colorType
  let palette
  let transparency
  const idatChunks = []

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    offset += 4

    const type = buffer.toString('ascii', offset, offset + 4)
    offset += 4

    const chunk = buffer.subarray(offset, offset + length)
    offset += length + 4

    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0)
      height = chunk.readUInt32BE(4)
      bitDepth = chunk[8]
      colorType = chunk[9]

      if (bitDepth !== 8) {
        throw new Error('Unsupported PNG bit depth')
      }

      if (chunk[12] !== 0) {
        throw new Error('Unsupported PNG interlace')
      }
    } else if (type === 'PLTE') {
      palette = chunk
    } else if (type === 'tRNS') {
      transparency = chunk
    } else if (type === 'IDAT') {
      idatChunks.push(chunk)
    } else if (type === 'IEND') {
      break
    }
  }

  if (!width || !height || idatChunks.length === 0) {
    throw new Error('Incomplete PNG')
  }

  const channelCount = getChannelCount(colorType)
  const bytesPerPixel = channelCount
  const stride = width * bytesPerPixel
  const inflated = zlib.inflateSync(Buffer.concat(idatChunks))
  const expectedLength = height * (stride + 1)

  if (inflated.length < expectedLength) {
    throw new Error('Invalid PNG data')
  }

  const pixels = []
  const currentScanline = Buffer.alloc(stride)
  const previousScanline = Buffer.alloc(stride)
  let readOffset = 0

  for (let y = 0; y < height; y++) {
    const filterType = inflated[readOffset++]
    const encodedScanline = inflated.subarray(readOffset, readOffset + stride)
    readOffset += stride

    for (let i = 0; i < stride; i++) {
      const left = i >= bytesPerPixel ? currentScanline[i - bytesPerPixel] : 0
      const up = previousScanline[i]
      const upLeft = i >= bytesPerPixel ? previousScanline[i - bytesPerPixel] : 0

      currentScanline[i] = applyPngFilter(filterType, encodedScanline[i], left, up, upLeft)
    }

    for (let x = 0; x < width; x++) {
      const pixelOffset = x * bytesPerPixel
      pixels.push(readPixel(currentScanline, pixelOffset, colorType, palette, transparency))
    }

    currentScanline.copy(previousScanline)
  }

  return pixels
}

function readPixel (scanline, offset, colorType, palette, transparency) {
  if (colorType === 6) {
    return {
      r: scanline[offset],
      g: scanline[offset + 1],
      b: scanline[offset + 2],
      a: scanline[offset + 3]
    }
  }

  if (colorType === 2) {
    return {
      r: scanline[offset],
      g: scanline[offset + 1],
      b: scanline[offset + 2],
      a: 255
    }
  }

  if (colorType === 3 && palette) {
    const paletteIndex = scanline[offset]
    const paletteOffset = paletteIndex * 3

    return {
      r: palette[paletteOffset],
      g: palette[paletteOffset + 1],
      b: palette[paletteOffset + 2],
      a: transparency && typeof transparency[paletteIndex] !== 'undefined' ? transparency[paletteIndex] : 255
    }
  }

  throw new Error('Unsupported PNG color type')
}

function applyPngFilter (filterType, value, left, up, upLeft) {
  switch (filterType) {
    case 0:
      return value
    case 1:
      return (value + left) & 0xFF
    case 2:
      return (value + up) & 0xFF
    case 3:
      return (value + Math.floor((left + up) / 2)) & 0xFF
    case 4:
      return (value + paethPredictor(left, up, upLeft)) & 0xFF
    default:
      throw new Error('Unsupported PNG filter type')
  }
}

function paethPredictor (left, up, upLeft) {
  const predictor = left + up - upLeft
  const leftDistance = Math.abs(predictor - left)
  const upDistance = Math.abs(predictor - up)
  const upLeftDistance = Math.abs(predictor - upLeft)

  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) {
    return left
  }

  if (upDistance <= upLeftDistance) {
    return up
  }

  return upLeft
}

function getChannelCount (colorType) {
  switch (colorType) {
    case 2:
      return 3
    case 3:
      return 1
    case 6:
      return 4
    default:
      throw new Error('Unsupported PNG color type')
  }
}

function buildPaletteFromPixels (pixels) {
  const buckets = new Map()

  for (const pixel of pixels) {
    if (pixel.a < 96) {
      continue
    }

    const hsl = rgbToHsl(pixel.r, pixel.g, pixel.b)

    if (hsl.l <= 0.12 || hsl.l >= 0.94 || hsl.s <= 0.18) {
      continue
    }

    const key = [
      Math.round(hsl.h / 15) * 15,
      Math.round(hsl.s * 5),
      Math.round(hsl.l * 5)
    ].join(':')

    let bucket = buckets.get(key)

    if (!bucket) {
      bucket = {
        count: 0,
        r: 0,
        g: 0,
        b: 0,
        saturation: 0,
        lightness: 0
      }
      buckets.set(key, bucket)
    }

    bucket.count++
    bucket.r += pixel.r
    bucket.g += pixel.g
    bucket.b += pixel.b
    bucket.saturation += hsl.s
    bucket.lightness += hsl.l
  }

  return [...buckets.values()]
    .sort((a, b) => scoreBucket(b) - scoreBucket(a))
    .slice(0, 5)
    .map(bucket => normalizeRgbColor({
      r: Math.round(bucket.r / bucket.count),
      g: Math.round(bucket.g / bucket.count),
      b: Math.round(bucket.b / bucket.count)
    }))
}

function scoreBucket (bucket) {
  const averageSaturation = bucket.saturation / bucket.count
  const averageLightness = bucket.lightness / bucket.count
  const lightnessBonus = 1 - Math.abs(averageLightness - 0.55)

  return bucket.count * (1 + averageSaturation) * (0.75 + lightnessBonus)
}

function normalizeRgbColor (rgb) {
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b)
  const normalized = hslToRgb({
    h: hsl.h,
    s: Math.max(hsl.s, 0.45),
    l: clamp(hsl.l, 0.38, 0.68)
  })

  return rgbToHex(normalized.r, normalized.g, normalized.b)
}

function generateFallbackCandidates (name) {
  const hash = hashString(name)
  const baseHue = mod(hash, 360)
  const candidates = []

  for (let i = 0; i < 8; i++) {
    const hue = mod(baseHue + (i * 137.508), 360)
    const saturation = 0.56 + ((hash >> (i % 8)) & 1) * 0.16
    const lightness = 0.46 + ((hash >> ((i + 3) % 8)) & 1) * 0.14
    const rgb = hslToRgb({
      h: hue,
      s: clamp(saturation, 0.45, 0.78),
      l: clamp(lightness, 0.38, 0.66)
    })

    candidates.push(rgbToHex(rgb.r, rgb.g, rgb.b))
  }

  return candidates
}

function pickBestGeneratedColor (targetColors, assignedColors, isFallbackOnly) {
  const candidates = generateAdjustedCandidates(targetColors, isFallbackOnly)
  let minimumDistance = COLOR_DISTANCE_TARGET

  while (minimumDistance >= COLOR_DISTANCE_FLOOR) {
    const bestCandidate = findBestCandidate(candidates, targetColors, assignedColors, minimumDistance, isFallbackOnly)

    if (bestCandidate) {
      return bestCandidate
    }

    minimumDistance -= COLOR_DISTANCE_STEP
  }

  return findLeastBadCandidate(candidates, targetColors, assignedColors, isFallbackOnly)
}

function generateAdjustedCandidates (targetColors, isFallbackOnly) {
  const dedupedCandidates = []
  const seenColors = new Set()
  const hueOffsets = isFallbackOnly
    ? [0, 38, -38, 76, -76, 114, -114, 152, -152, 180]
    : [0, 16, -16, 32, -32, 48, -48, 72, -72, 96, -96, 128, -128, 160, -160, 180]
  const saturationOffsets = isFallbackOnly ? [0.08, 0, -0.08, 0.16, -0.16] : [0, 0.08, -0.08, 0.16, -0.16]
  const lightnessOffsets = isFallbackOnly ? [0, 0.08, -0.08, 0.14, -0.14] : [0, 0.06, -0.06, 0.12, -0.12]

  targetColors.slice(0, 5).forEach(targetColor => {
    const targetHsl = normalizeTargetHsl(hexToHsl(targetColor), isFallbackOnly)

    hueOffsets.forEach(hueOffset => {
      saturationOffsets.forEach(saturationOffset => {
        lightnessOffsets.forEach(lightnessOffset => {
          const candidateColor = hslToHex({
            h: mod(targetHsl.h + hueOffset, 360),
            s: clamp(targetHsl.s + saturationOffset, 0.52, 0.9),
            l: clamp(targetHsl.l + lightnessOffset, 0.38, 0.7)
          })

          if (!seenColors.has(candidateColor)) {
            seenColors.add(candidateColor)
            dedupedCandidates.push(candidateColor)
          }
        })
      })
    })
  })

  return dedupedCandidates
}

function normalizeTargetHsl (hsl, isFallbackOnly) {
  return {
    h: hsl.h,
    s: clamp(Math.max(hsl.s, isFallbackOnly ? 0.62 : 0.55), 0.52, 0.9),
    l: clamp(hsl.l, 0.4, 0.66)
  }
}

function findBestCandidate (candidates, targetColors, assignedColors, minimumDistance, isFallbackOnly) {
  let bestCandidate
  let bestScore = -Infinity

  for (const candidate of candidates) {
    const minDistance = getMinimumAssignedDistance(candidate, assignedColors)

    if (minDistance < minimumDistance) {
      continue
    }

    const score = scoreCandidate(candidate, targetColors, assignedColors, isFallbackOnly)

    if (score > bestScore) {
      bestScore = score
      bestCandidate = candidate
    }
  }

  return bestCandidate
}

function findLeastBadCandidate (candidates, targetColors, assignedColors, isFallbackOnly) {
  let bestCandidate = candidates[0]
  let bestScore = -Infinity

  for (const candidate of candidates) {
    const score = scoreCandidate(candidate, targetColors, assignedColors, isFallbackOnly)

    if (score > bestScore) {
      bestScore = score
      bestCandidate = candidate
    }
  }

  return bestCandidate
}

function scoreCandidate (hexColor, targetColors, assignedColors, isFallbackOnly) {
  const closestTargetDistance = getClosestTargetDistance(hexColor, targetColors)
  const minimumAssignedDistance = getMinimumAssignedDistance(hexColor, assignedColors)
  const candidateHsl = hexToHsl(hexColor)
  const saturationBonus = candidateHsl.s
  const lightnessCenterBonus = 1 - Math.abs(candidateHsl.l - 0.54)
  const fallbackDistanceWeight = isFallbackOnly ? 1.45 : 1.2
  const targetWeight = isFallbackOnly ? 0.45 : 0.95

  return (minimumAssignedDistance * fallbackDistanceWeight) -
    (closestTargetDistance * targetWeight) +
    (saturationBonus * 0.18) +
    (lightnessCenterBonus * 0.12)
}

function getClosestTargetDistance (hexColor, targetColors) {
  const candidateHsl = hexToHsl(hexColor)

  return Math.min(...targetColors.map(targetColor => getColorDistance(candidateHsl, hexToHsl(targetColor))))
}

function getMinimumAssignedDistance (hexColor, assignedColors) {
  if (assignedColors.length === 0) {
    return Number.MAX_VALUE
  }

  const colorHsl = hexToHsl(hexColor)

  return Math.min(...assignedColors.map(assignedColor => getColorDistance(colorHsl, assignedColor)))
}

function getColorDistance (a, b) {
  const hueDistance = Math.min(Math.abs(a.h - b.h), 360 - Math.abs(a.h - b.h)) / 180
  const saturationDistance = Math.abs(a.s - b.s)
  const lightnessDistance = Math.abs(a.l - b.l)

  return Math.sqrt(
    Math.pow(hueDistance * 1.7, 2) +
    Math.pow(saturationDistance * 0.8, 2) +
    Math.pow(lightnessDistance, 2)
  )
}

function normalizeHexColor (hexColor) {
  if (typeof hexColor !== 'string') {
    return
  }

  const normalized = hexColor.trim().match(/^#?([0-9a-f]{6})$/i)

  if (!normalized) {
    return
  }

  return `#${normalized[1].toUpperCase()}`
}

function hashString (value) {
  let hash = 0

  for (let i = value.length - 1; i >= 0; i--) {
    hash = value.charCodeAt(i) + ((hash << 5) - hash)
  }

  return Math.abs(hash)
}

function hexToHsl (hexColor) {
  const normalizedColor = normalizeHexColor(hexColor)
  const r = parseInt(normalizedColor.slice(1, 3), 16)
  const g = parseInt(normalizedColor.slice(3, 5), 16)
  const b = parseInt(normalizedColor.slice(5, 7), 16)

  return rgbToHsl(r, g, b)
}

function hslToHex (hsl) {
  const rgb = hslToRgb(hsl)
  return rgbToHex(rgb.r, rgb.g, rgb.b)
}

function rgbToHex (r, g, b) {
  return `#${[r, g, b].map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase()}`
}

function rgbToHsl (r, g, b) {
  const red = r / 255
  const green = g / 255
  const blue = b / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const delta = max - min
  const lightness = (max + min) / 2
  let hue = 0
  let saturation = 0

  if (delta !== 0) {
    saturation = delta / (1 - Math.abs((2 * lightness) - 1))

    switch (max) {
      case red:
        hue = 60 * mod((green - blue) / delta, 6)
        break
      case green:
        hue = 60 * (((blue - red) / delta) + 2)
        break
      default:
        hue = 60 * (((red - green) / delta) + 4)
        break
    }
  }

  return {
    h: hue,
    s: saturation,
    l: lightness
  }
}

function hslToRgb (hsl) {
  const chroma = (1 - Math.abs((2 * hsl.l) - 1)) * hsl.s
  const hueSection = hsl.h / 60
  const secondary = chroma * (1 - Math.abs((hueSection % 2) - 1))
  let red = 0
  let green = 0
  let blue = 0

  if (hueSection >= 0 && hueSection < 1) {
    red = chroma
    green = secondary
  } else if (hueSection < 2) {
    red = secondary
    green = chroma
  } else if (hueSection < 3) {
    green = chroma
    blue = secondary
  } else if (hueSection < 4) {
    green = secondary
    blue = chroma
  } else if (hueSection < 5) {
    red = secondary
    blue = chroma
  } else {
    red = chroma
    blue = secondary
  }

  const match = hsl.l - (chroma / 2)

  return {
    r: Math.round((red + match) * 255),
    g: Math.round((green + match) * 255),
    b: Math.round((blue + match) * 255)
  }
}

function clamp (value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function mod (value, divisor) {
  return ((value % divisor) + divisor) % divisor
}

module.exports = ColorAssigner
