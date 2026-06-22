// Minimal server.js - v3 - pure http, no dependencies
const http = require('http');
process.stdout.write('server.js starting\n');

const PORT = process.env.PORT || 3000;
process.stdout.write('PORT=' + PORT + '\n');

const server = http.createServer((req, res) => {
        process.stdout.write('Request: ' + req.method + ' ' + req.url + '\n');
        if (req.url === '/health' || req.url === '/') {
                  res.writeHead(200, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ status: 'ok', version: 3, port: PORT }));
        } else {
                  res.writeHead(404);
                  res.end('Not found');
        }
});

server.listen(PORT, '0.0.0.0', () => {
        process.stdout.write('Server listening on port ' + PORT + '\n');
});

server.on('error', (err) => {
        process.stderr.write('Server error: ' + err.message + '\n');
        process.exit(1);
});

process.on('uncaughtException', (err) => {
        process.stderr.write('Uncaught: ' + err.message + '\n');
        process.exit(1);
});
