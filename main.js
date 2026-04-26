const App = require('./lib/app')
const ServerRegistration = require('./lib/servers')

const logger = require('./lib/logger')

const config = require('./config')
const servers = require('./servers')

const app = new App()

servers.forEach((server, serverId) => {
  // Init a ServerRegistration instance of each entry in servers.json
  app.serverRegistrations.push(new ServerRegistration(app, serverId, server))
})

app.colorAssigner.assignColors(app.serverRegistrations)

if (!config.serverGraphDuration) {
  logger.log('warn', '"serverGraphDuration" is not defined in config.json - defaulting to 3 minutes!')
  config.serverGraphDuration = 3 * 60 * 10000
}

if (!config.logToDatabase) {
  logger.log('warn', 'Database logging is not enabled. You can enable it by setting "logToDatabase" to true in config.json. This requires sqlite3 to be installed.')

  app.handleReady()
} else {
  app.loadDatabase(() => {
    app.handleReady()
  })
}
