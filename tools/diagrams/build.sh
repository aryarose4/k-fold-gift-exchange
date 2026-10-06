#!/usr/bin/env bash
# Rebuild the gift-exchange tikz-cd SVGs (light + dark per diagram).
# Requires: pdflatex + tikz-cd (texlive-pictures), pdfcrop, pdftocairo (poppler-utils).
# Output: assets/img/gift_exchange/<name>_<theme>.svg
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT="$ROOT/assets/img/gift_exchange"
mkdir -p "$OUT"

# RGB triplets per theme (stroke/label color on transparent background).
declare -A RGB=( [light]="40,44,52" [dark]="224,224,230" )

BUILD="$(mktemp -d)"
trap 'rm -rf "$BUILD"' EXIT

for name in one_component two_components three_fold; do
  for theme in light dark; do
    # substitute the color placeholder -> a compile-temp .tex
    sed "s/^\\\\definecolor{cdcolor}{RGB}{CDCOLOR}$/\\\\definecolor{cdcolor}{RGB}{${RGB[$theme]}}/" \
      "$HERE/$name.tex" > "$BUILD/$name.tex"
    (cd "$BUILD" && pdflatex -interaction=nonstopmode "$name.tex" > /dev/null)
    (cd "$BUILD" && pdfcrop "$name.pdf" "$name-crop.pdf" > /dev/null)
    (cd "$BUILD" && pdftocairo -svg "$name-crop.pdf" "$OUT/${name}_${theme}.svg")
    echo "built $OUT/${name}_${theme}.svg"
  done
done