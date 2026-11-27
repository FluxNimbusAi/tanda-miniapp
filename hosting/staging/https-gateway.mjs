#!/usr/bin/env node
// =============================================================================
// hosting/staging/https-gateway.mjs — local HTTPS staging proof (ADR-0009)
//
// Zero-dependency TLS-terminating reverse proxy in front of the Next
// standalone server. Exists because mkcert is absent on the PC host: we
// terminate TLS with a self-signed cert (see gen-cert.sh) and prove the
// full https path — TLS handshake, secure-context headers, SSR, and API
// routes — without any external service or trust store mutation.
//
// TRUST CAVEAT (by design): a self-signed cert is NOT trusted by browsers
// or by World App's webview. This gateway proves server plumbing only.
// Real-device staging needs a tunnel with a CA-issued cert (hosting/tunnels/)
// or the go-live host. Never point an integration_url at this endpoint.
//
// Usage (after `node .next/standalone/server.js` is up on :3000):
//   node hosting/staging/https-gateway.mjs
// Env knobs:
//   HTTPS_PORT=3443      port this gateway listens on
//   UPSTREAM_PORT=3000   standalone server port
//   TLS_KEY=...          default hosting/staging/certs/key.pem
//   TLS_CERT=...         default hosting/staging/certs/cert.pem
// =============================================================================
import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TLS_KEY = process.env.TLS_KEY ?? path.join(__dirname, 'certs', 'key.pem');
const TLS_CERT = process.env.TLS_CERT ?? path.join(__dirname, 'certs', 'cert.pem');
const UPSTREAM_PORT = Number(process.env.UPSTREAM_PORT ?? 3000);
const LISTEN_PORT = Number(process.env.HTTPS_PORT ?? 3443);

// Hop-by-hop headers must not be forwarded (RFC 9110 §7.6.1).
const HOP_BY_HOP = [
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
];

for (const f of [TLS_KEY, TLS_CERT]) {
  if (!fs.existsSync(f)) {
    console.error(`missing TLS material: ${f}\nrun hosting/staging/gen-cert.sh first`);
    process.exit(1);
  }
}

const options = { key: fs.readFileSync(TLS_KEY), cert: fs.readFileSync(TLS_CERT) };

const server = https.createServer(options, (req, res) => {
  const started = Date.now();
  const upstream = http.request(
    {
      host: '127.0.0.1',
      port: UPSTREAM_PORT,
      method: req.method,
      path: req.url,
      headers: { ...req.headers, host: `127.0.0.1:${UPSTREAM_PORT}` },
    },
    (up) => {
      const headers = { ...up.headers };
      for (const h of HOP_BY_HOP) delete headers[h];
      res.writeHead(up.statusCode ?? 502, headers);
      up.pipe(res);
      console.log(
        `${req.method} ${req.url} -> ${up.statusCode} ` +
        `(${Date.now() - started}ms, TLS ${req.socket.getProtocol()}, ` +
        `cipher ${req.socket.getCipher().name})`,
      );
    },
  );
  upstream.on('error', (e) => {
    res.writeHead(502, { 'content-type': 'text/plain' });
    res.end(`https-gateway: upstream error: ${e.message}\n`);
    console.error(`${req.method} ${req.url} -> 502 upstream error: ${e.message}`);
  });
  req.pipe(upstream);
});

// Print the leaf fingerprint on boot so receipts can pin exactly which cert
// the proof was made against.
const leaf = new crypto.X509Certificate(fs.readFileSync(TLS_CERT));
server.listen(LISTEN_PORT, '127.0.0.1', () => {
  console.log(`https-gateway listening on https://localhost:${LISTEN_PORT}/ -> 127.0.0.1:${UPSTREAM_PORT}`);
  console.log(`leaf cert subject: ${leaf.subject.replace(/\n/g, ', ')}`);
  console.log(`leaf cert SHA-256 fingerprint: ${leaf.fingerprint256}`);
  console.log(`valid: ${leaf.validFrom} .. ${leaf.validTo}  (self-signed — expect TRUST_ERR on first hit)`);
});
