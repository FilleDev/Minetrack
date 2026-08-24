const Database = require('./database')
const ColorAssigner = require('./colors')
const PingController = require('./ping')
const Server = require('./server')
const { TimeTracker } = require('./time')
const MessageOf = require('./message')
const { loadMinecraftVersions } = require('./minecraft-versions')
const logger = require('./logger')

const config = require('../config')
const VERSION_REFRESH_INTERVAL = 12 * 60 * 60 * 1000

function getMinecraftVersionNames (minecraftVersions) {
  const minecraftVersionNames = {}
  Object.keys(minecraftVersions).forEach((key) => {
    minecraftVersionNames[key] = minecraftVersions[key].map(version => version.name)
  })
  return minecraftVersionNames
}

function versionsAreEqual (first, second) {
  return JSON.stringify(first) === JSON.stringify(second)
}

class App {
  serverRegistrations = []

  constructor (minecraftVersions) {
    this.minecraftVersions = minecraftVersions
    this.colorAssigner = new ColorAssigner()
    this.pingController = new PingController(this)
    this.server = new Server(this)
    this.timeTracker = new TimeTracker(this)
  }

  loadDatabase (callback) {
    this.database = new Database(this)

    // Setup database instance
    this.database.ensureIndexes(() => {
      this.database.loadGraphPoints(config.graphDuration, () => {
        this.database.loadRecords(() => {
          if (config.oldPingsCleanup && config.oldPingsCleanup.enabled) {
            this.database.initOldPingsDelete(callback)
          } else {
            callback()
          }
        })
      })
    })
  }

  handleReady () {
    this.server.listen(config.site.ip, config.site.port)

    // Allow individual modules to manage their own task scheduling
    this.pingController.schedule()
    this.scheduleMinecraftVersionRefresh()
  }

  scheduleMinecraftVersionRefresh () {
    setInterval(() => {
      this.refreshMinecraftVersions().catch(err => {
        logger.log('warn', 'Unable to refresh Minecraft version data: %s', err.message)
      })
    }, VERSION_REFRESH_INTERVAL)
  }

  async refreshMinecraftVersions () {
    const minecraftVersions = await loadMinecraftVersions()

    if (versionsAreEqual(this.minecraftVersions, minecraftVersions)) {
      return false
    }

    // Do not replace the list while a scan is in progress: its protocol indexes
    // refer to the list that was active when the pings began.
    while (this.pingController.isRunning()) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    this.minecraftVersions = minecraftVersions
    const minecraftVersionNames = getMinecraftVersionNames(minecraftVersions)

    this.server.broadcast(MessageOf('minecraftVersions', { minecraftVersions: minecraftVersionNames }))
    logger.log('info', 'Refreshed Minecraft version data')
    return true
  }

  handleClientConnection = (client) => {
    if (config.logToDatabase) {
      client.on('message', (message) => {
        if (message.toString() === 'requestHistoryGraph') {
          // Send historical graphData for all configured servers so unpinged or stale
          // entries still remain visible in the frontend.
          const graphData = this.serverRegistrations.map(serverRegistration => serverRegistration.graphData)

          // Send graphData in object wrapper to avoid needing to explicity filter
          // any header data being appended by #MessageOf since the graph data is fed
          // directly into the graphing system
          client.send(MessageOf('historyGraph', {
            timestamps: this.timeTracker.getGraphPoints(),
            graphData
          }))
        }
      })
    }

    const initMessage = {
      config: (() => {
        // Send configuration data for rendering the page
        return {
          graphDurationLabel: config.graphDurationLabel || (Math.floor(config.graphDuration / (60 * 60 * 1000)) + 'h'),
          graphMaxLength: TimeTracker.getMaxGraphDataLength(),
          serverGraphMaxLength: TimeTracker.getMaxServerGraphDataLength(),
          servers: this.serverRegistrations.map(serverRegistration => serverRegistration.getPublicData()),
          minecraftVersions: getMinecraftVersionNames(this.minecraftVersions),
          isGraphVisible: config.logToDatabase
        }
      })(),
      timestampPoints: this.timeTracker.getServerGraphPoints(),
      servers: this.serverRegistrations.map(serverRegistration => serverRegistration.getPingHistory())
    }

    client.send(MessageOf('init', initMessage))
  }
}

module.exports = App
