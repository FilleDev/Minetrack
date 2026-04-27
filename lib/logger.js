const winston = require('winston')

const timestamp = winston.format((info) => {
  const date = new Date()
  info.timestamp = `${date.toLocaleTimeString()} ${date.toLocaleDateString()}`
  return info
})

const consoleFormat = winston.format.combine(
  timestamp(),
  winston.format.splat(),
  winston.format.colorize({ all: true }),
  winston.format.printf(({ level, message, timestamp }) => `${timestamp} ${level}: ${message}`)
)

const fileFormat = winston.format.combine(
  timestamp(),
  winston.format.splat(),
  winston.format.printf(({ level, message, timestamp }) => `${timestamp} ${level}: ${message}`)
)

module.exports = winston.createLogger({
  level: 'info',
  transports: [
    new winston.transports.File({
      filename: 'minetrack.log',
      format: fileFormat
    }),
    new winston.transports.Console({
      format: consoleFormat
    })
  ]
})
