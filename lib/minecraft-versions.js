const VERSION_DATA_URL = 'https://raw.githubusercontent.com/misode/mcmeta/summary/versions/data.min.json'

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
  const protocolIds = new Set()
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

  return { PC: versions }
}

module.exports = { loadMinecraftVersions }
