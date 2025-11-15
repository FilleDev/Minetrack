# Minetrack API

## GET /api/stats

Returns all current server statistics in JSON format

### Response Format

```json
{
  "timestamp": 1700000000000,
  "totalPlayers": 1234,
  "servers": [
    {
      "name": "Server Name",
      "ip": "server.example.com",
      "type": "PC",
      "color": "#3498db",
      "playerCount": 100,
      "versions": [0, 1, 2],
      "recordData": {
        "playerCount": 150,
        "timestamp": 1699999999
      },
      "graphPeakData": {
        "playerCount": 145,
        "timestamp": 1699999990
      },
      "favicon": "/hashedfavicon_abc123.png"
    }
  ]
}
```

### Fields

- `timestamp`: Current server timestamp in milliseconds
- `totalPlayers`: Sum of all online players across all servers
- `servers`: Array of server objects containing:
  - `name`: Server display name
  - `ip`: Server IP address or hostname
  - `type`: Server type ("PC" for Java Edition, "PE" for Bedrock Edition)
  - `color`: Hex color code for the server
  - `playerCount`: Current number of online players (null if server is offline)
  - `versions`: Array of supported protocol version indices
  - `recordData`: Historical peak player count record (if available)
    - `playerCount`: Peak player count
    - `timestamp`: When the peak occurred (in seconds)
  - `graphPeakData`: Peak player count from the current graph period (if available)
    - `playerCount`: Peak player count in graph
    - `timestamp`: When the peak occurred (in milliseconds)
  - `favicon`: URL to the server's favicon image

### Example Usage

```bash
curl http://localhost:8080/api/stats
```

```javascript
fetch('http://localhost:8080/api/stats')
  .then(response => response.json())
  .then(data => {
    console.log(`Total players online: ${data.totalPlayers}`);
    data.servers.forEach(server => {
      console.log(`${server.name}: ${server.playerCount} players`);
    });
  });
```
