const VERSION_DATA_URL = 'https://raw.githubusercontent.com/misode/mcmeta/summary/versions/data.min.json'

// Misode starts at 1.14
const LEGACY_JAVA_VERSIONS = [
  { name: '1.7.2', protocolId: 4 },
  { name: '1.7.10', protocolId: 5 },
  { name: '1.8', protocolId: 47 },
  { name: '1.9', protocolId: 107 },
  { name: '1.9.1', protocolId: 108 },
  { name: '1.9.2', protocolId: 109 },
  { name: '1.9.4', protocolId: 110 },
  { name: '1.10', protocolId: 210 },
  { name: '1.11', protocolId: 315 },
  { name: '1.11.2', protocolId: 316 },
  { name: '1.12', protocolId: 335 },
  { name: '1.12.1', protocolId: 338 },
  { name: '1.12.2', protocolId: 340 },
  { name: '1.13', protocolId: 393 },
  { name: '1.13.1', protocolId: 401 },
  { name: '1.13.2', protocolId: 404 },
  { name: '1.14', protocolId: 477 },
  { name: '1.14.1', protocolId: 480 }
]

async function loadMinecraftVersions () {
  const response = await fetch(VERSION_DATA_URL, {
    signal: AbortSignal.timeout(10000)
  })

  if (!response.ok) {
    throw new Error(`Misode version data request failed with HTTP ${response.status}`)
  }

  const data = await response.json()

  if (!Array.isArray(data)) {
    throw new Error('Misode version data is not an array')
  }

  // The feed is newest-first. Keep the newest release name for each protocol,
  // then reverse it so protocol scans proceed from oldest to newest.
  const protocolIds = new Set(LEGACY_JAVA_VERSIONS.map(version => version.protocolId))
  const versions = data
    .filter(version => version.type === 'release' && version.stable && Number.isInteger(version.protocol_version) && version.protocol_version > 0)
    .filter(version => {
      if (protocolIds.has(version.protocol_version)) {
        return false
      }
      protocolIds.add(version.protocol_version)
      return true
    })
    .reverse()
    .map(version => ({
      name: version.name,
      protocolId: version.protocol_version
    }))

  if (versions.length === 0) {
    throw new Error('Misode version data contains no stable Java protocol versions')
  }

  return { PC: [...LEGACY_JAVA_VERSIONS, ...versions] }
}

module.exports = { loadMinecraftVersions }
