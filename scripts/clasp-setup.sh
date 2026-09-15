#!/bin/sh
# Menyiapkan kredensial clasp dari environment variable CLASPRC_JSON.
# Cara isi-nya lihat README bagian "3b. Alternatif: push backend dengan clasp".
# Script ini tidak pernah menampilkan isi token ke layar.
set -e

CLASPRC="$HOME/.clasprc.json"

# Sudah ada kredensial? tidak perlu apa-apa
if [ -s "$CLASPRC" ]; then
  echo "✅ Kredensial clasp sudah tersedia."
  exit 0
fi

if [ -z "${CLASPRC_JSON:-}" ]; then
  echo "❌ CLASPRC_JSON belum diisi."
  echo "   Isi lewat menu Keys / Environment dengan isi file ~/.clasprc.json"
  echo "   dari komputermu (lihat README bagian clasp)."
  exit 1
fi

printf '%s' "$CLASPRC_JSON" > "$CLASPRC"
echo "✅ Kredensial clasp dipasang dari CLASPRC_JSON (disimpan sementara di sandbox)."
