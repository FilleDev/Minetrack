const crypto = require('crypto')

const DNSResolver = require('./dns')
const Server = require('./server')

const { GRAPH_UPDATE_TIME_GAP, TimeTracker } = require('./time')
const { getPlayerCountOrNull } = require('./util')

const config = require('../config')
const minecraftVersions = require('../minecraft_versions')

class ServerRegistration {
  serverId
  lastFavicon
  versions = []
  recordData
  graphData = []

  constructor (app, serverId, data) {
    this._app = app
    this.serverId = serverId
    this.data = data
    this.manualColor = typeof data.color === 'string' ? data.color : undefined
    this._pingHistory = []
    this.dnsResolver = new DNSResolver(this.data.ip, this.data.port)
  }

  handlePing (timestamp, resp, err, version, updateHistoryGraph) {
    // Use null to represent a failed ping
    const unsafePlayerCount = getPlayerCountOrNull(resp)

    // Store into in-memory ping data
    TimeTracker.pushAndShift(this._pingHistory, unsafePlayerCount, TimeTracker.getMaxServerGraphDataLength())

    // Only notify the frontend to append to the historical graph
    // if both the graphing behavior is enabled and the backend agrees
    // that the ping is eligible for addition
    if (updateHistoryGraph) {
      TimeTracker.pushAndShift(this.graphData, unsafePlayerCount, TimeTracker.getMaxGraphDataLength())
    }

    // Delegate out update payload generation
    return this.getUpdate(timestamp, resp, err, version)
  }

  getUpdate (timestamp, resp, err, version) {
    const update = {}

    // Always append a playerCount value
    // When resp is undefined (due to an error), playerCount will be null
    update.playerCount = getPlayerCountOrNull(resp)

    if (resp) {
      if (resp.version && this.updateProtocolVersionCompat(resp.version, version.protocolId, version.protocolIndex)) {
        // Append an updated version listing
        update.versions = this.versions.slice()
      }

      if (config.logToDatabase && (!this.recordData || resp.players.online > this.recordData.playerCount)) {
        this.recordData = {
          playerCount: resp.players.online,
          timestamp: TimeTracker.toSeconds(timestamp)
        }

        // Append an updated recordData
        update.recordData = this.recordData

        // Update record in database
        this._app.database.updatePlayerCountRecord(this.data.ip, resp.players.online, timestamp)
      }

      if (this.updateFavicon(resp.favicon)) {
        update.favicon = this.getFaviconUrl()
      }

      if (config.logToDatabase) {
        // Update calculated graph peak regardless if the graph is being updated
        // This can cause a (harmless) desync between live and stored data, but it allows it to be more accurate for long surviving processes
        if (this.findNewGraphPeak()) {
          update.graphPeakData = this.getGraphPeak()
        }
      }
    } else if (err) {
      // Append a filtered copy of err
      // This ensures any unintended data is not leaked
      update.error = this.filterError(err)
    }

    return update
  }

  getPingHistory () {
    if (this._pingHistory.length > 0) {
      const payload = {
        versions: this.versions.slice(),
        recordData: this.recordData,
        favicon: this.getFaviconUrl()
      }

      // Only append graphPeakData if defined
      // The value is lazy computed and conditional that config->logToDatabase == true
      const graphPeakData = this.getGraphPeak()

      if (graphPeakData) {
        payload.graphPeakData = graphPeakData
      }

      // Assume the ping was a success and define result
      // pingHistory does not keep error references, so its impossible to detect if this is an error
      // It is also pointless to store that data since it will be short lived
      payload.playerCount = this._pingHistory[this._pingHistory.length - 1]

      // Send a copy of pingHistory
      // Include the last value even though it is contained within payload
      // The frontend will only push to its graphData from playerCountHistory
      payload.playerCountHistory = this._pingHistory

      return payload
    }

    return {
      error: {
        message: 'Pinging...'
      },
      recordData: this.recordData,
      graphPeakData: this.getGraphPeak(),
      favicon: this.data.favicon
    }
  }

  loadGraphPoints (startTime, timestamps, points) {
    this.graphData = TimeTracker.everyN(timestamps, startTime, GRAPH_UPDATE_TIME_GAP, (i) => points[i])
  }

  findNewGraphPeak () {
    let index = -1
    for (let i = 0; i < this.graphData.length; i++) {
      const point = this.graphData[i]
      if (point !== null && (index === -1 || point > this.graphData[index])) {
        index = i
      }
    }
    if (index >= 0) {
      const lastGraphPeakIndex = this._graphPeakIndex
      this._graphPeakIndex = index
      return index !== lastGraphPeakIndex
    } else {
      this._graphPeakIndex = undefined
      return false
    }
  }

  getGraphPeak () {
    if (this._graphPeakIndex === undefined) {
      return
    }
    return {
      playerCount: this.graphData[this._graphPeakIndex],
      timestamp: this._app.timeTracker.getGraphPointAt(this._graphPeakIndex)
    }
  }

  updateFavicon (favicon) {
    // If data.favicon is defined, then a favicon override is present
    // Disregard the incoming favicon, regardless if it is different
    if (this.data.favicon) {
      return false
    }

    if (favicon && favicon !== this.lastFavicon) {
      this.lastFavicon = favicon

      // Generate an updated hash
      // This is used by #getFaviconUrl
      this.faviconHash = crypto.createHash('md5').update(favicon).digest('hex').toString()

      return true
    }

    return false
  }

  getFaviconUrl () {
    if (this.faviconHash) {
      return Server.getHashedFaviconUrl(this.faviconHash)
    } else if (this.data.favicon) {
      return this.data.favicon
    }
  }

  updateProtocolVersionCompat (incomingId, outgoingId, protocolIndex) {
    const protocolVersions = minecraftVersions[this.data.type]

    if (!protocolVersions || protocolVersions.length === 0) {
      return false
    }

    if (!this._versionScanResults || this._versionScanResults.length !== protocolVersions.length) {
      this._versionScanResults = Array(protocolVersions.length).fill(undefined)
      this._versionScanSeen = {}
    }

    // If the result version matches the attempted version, the version is supported
    const isSuccess = incomingId === outgoingId
    this._versionScanResults[protocolIndex] = isSuccess
    this._versionScanSeen[protocolIndex] = true

    if (Object.keys(this._versionScanSeen).length === protocolVersions.length) {
      const versions = []

      for (let i = 0; i < this._versionScanResults.length; i++) {
        if (this._versionScanResults[i]) {
          versions.push(i)
        }
      }

      this._versionScanResults = Array(protocolVersions.length).fill(undefined)
      this._versionScanSeen = {}

      if (!areArraysEqual(this.versions, versions)) {
        this.versions = versions
        return true
      }
    }

    return false
  }

  getNextProtocolVersion () {
    // Minecraft Bedrock Edition does not have protocol versions
    if (this.data.type === 'PE') {
      return {
        protocolId: 0,
        protocolIndex: 0
      }
    }
    const protocolVersions = minecraftVersions[this.data.type]
    if (typeof this._nextProtocolIndex === 'undefined' || this._nextProtocolIndex + 1 >= protocolVersions.length) {
      this._nextProtocolIndex = 0
    } else {
      this._nextProtocolIndex++
    }
    return {
      protocolId: protocolVersions[this._nextProtocolIndex].protocolId,
      protocolIndex: this._nextProtocolIndex
    }
  }

  filterError (err) {
    let message = 'Unknown error'

    // Attempt to match to the first possible value
    for (const key of ['message', 'description', 'errno']) {
      if (err[key]) {
        message = err[key]
        break
      }
    }

    // Trim the message if too long
    if (message.length > 28) {
      message = message.substring(0, 28) + '...'
    }

    return {
      message
    }
  }

  hasSuccessfulPing () {
    // Check if there's any non-null value in graphData
    if (this.graphData && this.graphData.length > 0) {
      return this.graphData.some(point => point !== null && typeof point === 'number')
    }
    // If no graphData, check _pingHistory
    if (this._pingHistory && this._pingHistory.length > 0) {
      return this._pingHistory.some(point => point !== null && typeof point === 'number')
    }
    return false
  }

  getPublicData () {
    // Return a custom object instead of data directly to avoid data leakage
    return {
      name: this.data.name,
      ip: this.data.ip,
      type: this.data.type,
      color: this.data.color
    }
  }
}

module.exports = ServerRegistration

function areArraysEqual (a, b) {
  if (a.length !== b.length) {
    return false
  }

  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false
    }
  }

  return true
}
