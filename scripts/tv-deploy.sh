#!/usr/bin/env bash
# Compila la app, la empaqueta como .wgt firmado, la instala en la tele y la abre.
# Uso: scripts/tv-deploy.sh [IP_TELE]   (o TV_IP=… en el entorno)
set -euo pipefail

TV_IP="${1:-${TV_IP:-192.168.1.33}}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TIZEN="$HOME/tizen-studio/tools/ide/bin/tizen"
SDB="$HOME/tizen-studio/tools/sdb"
APP_ID="butacaTV01.Butaca"
OUT="$ROOT/tv/build"

cd "$ROOT/tv"
echo "▸ Compilando"
bunx vite build --logLevel warn
cp tizen/config.xml tizen/icon.png dist/

echo "▸ Empaquetando y firmando"
mkdir -p "$OUT"
rm -f "$OUT"/*.wgt
"$TIZEN" package -t wgt -s butaca -o "$OUT" -- dist >/dev/null
WGT="$(ls "$OUT"/*.wgt)"
echo "  $(basename "$WGT") ($(du -h "$WGT" | cut -f1))"

echo "▸ Conectando con la tele ($TV_IP)"
"$SDB" connect "$TV_IP:26101" | tail -1
SERIAL="$TV_IP:26101"
if ! "$SDB" devices | grep -q "^$SERIAL"; then
  echo "✗ La tele no responde a sdb. ¿Modo desarrollador activo con la IP de este PC?" >&2
  exit 1
fi

echo "▸ Instalando"
"$TIZEN" install -s "$SERIAL" -n "$(basename "$WGT")" -- "$OUT" | grep -E "installed|error|fail" || true

echo "▸ Abriendo Butaca"
"$TIZEN" run -s "$SERIAL" -p "$APP_ID" | tail -1
