#!/usr/bin/env bash
# =============================================================================
# hosting/staging/gen-cert.sh — self-signed localhost cert (ADR-0009)
#
# mkcert is absent on the PC host, and it would need a local root CA anyway.
# Plain openssl suffices for the plumbing proof: one throwaway RSA-2048 leaf
# with the SANs browsers/Node require for https://localhost (SAN is mandatory
# since 2019 — CN-only certs are rejected).
#
# Output: hosting/staging/certs/{key.pem,cert.pem}  (gitignored — never commit
# key material, even throwaway). 30-day lifetime, regenerate freely.
# TRUST CAVEAT: self-signed => every client must opt in explicitly
# (curl -k / browser "Advanced -> Continue" / NODE_EXTRA_CA_CERTS). World App
# webview will NOT accept it; tunnels provide CA-issued certs instead.
# =============================================================================
set -euo pipefail

CERT_DIR="$(cd "$(dirname "$0")" && pwd)/certs"
mkdir -p "$CERT_DIR"

openssl req -x509 -newkey rsa:2048 -sha256 -days 30 -nodes \
  -keyout "$CERT_DIR/key.pem" \
  -out "$CERT_DIR/cert.pem" \
  -subj "/CN=localhost/O=Tanda Local HTTPS Staging" \
  -addext "subjectAltName=DNS:localhost,DNS:test.localhost,IP:127.0.0.1,IP:::1"

chmod 600 "$CERT_DIR/key.pem" 2>/dev/null || true

echo "--- generated in $CERT_DIR ---"
openssl x509 -in "$CERT_DIR/cert.pem" -noout -subject -dates \
  -ext subjectAltName -fingerprint -sha256
