#!/usr/bin/env bash
# Stretch the seamless loop into a long video with music, without re-encoding the picture.
#   tools/make-long.sh <loop.mp4 | loop-part1-of-N.mp4> <music-file> [minutes=3] [out.mp4]
#   tools/make-long.sh <loop.mp4 | loop-part1-of-N.mp4> --edition ID [minutes=3] [out.mp4]
# With --edition, the music is that entry's own soundtrack: tools/soundtrack.mjs
# renders its whole 240 s loop seamlessly (--loop), so picture and sound loop
# together (the loop video must start at t=0, as render-video.mjs does by
# default). If the soundtrack is missing or fails, the video gets a silent
# track and a warning.
# If you pass part 1 of a split loop (…-part1-of-6.mp4), the other parts in the
# same folder are joined first, losslessly.
# The music file is looped too; for a playlist, first concatenate your tracks into one file:
#   ffmpeg -f concat -safe 0 -i tracks.txt -c:a aac -b:a 192k playlist.m4a
set -euo pipefail
usage() {
  echo "usage: $0 <loop.mp4 | loop-part1-of-N.mp4> <music-file | --edition ID> [minutes=3] [out.mp4]" >&2
  exit 1
}
[ $# -ge 2 ] || usage
HERE=$(cd "$(dirname "$0")" && pwd)
LOOP_VIDEO=$1
shift
EDITION=""
AUDIO=""
if [ "$1" = "--edition" ]; then
  [ $# -ge 2 ] || usage
  EDITION=$2
  shift 2
else
  AUDIO=$1
  shift
fi
MINUTES=${1:-3}
OUT=${2:-purrfect-year-${EDITION:-long}-${MINUTES}min.mp4}
SECS=$(awk "BEGIN { print $MINUTES * 60 }")
TMPDIR_LONG=$(mktemp -d)
trap 'rm -rf "$TMPDIR_LONG"' EXIT

if [[ "$LOOP_VIDEO" == *-part1-of-*.mp4 ]]; then
  N=${LOOP_VIDEO##*-part1-of-}
  N=${N%.mp4}
  PREFIX=${LOOP_VIDEO%-part1-of-*.mp4}
  LIST="$TMPDIR_LONG/parts.txt"
  for i in $(seq 1 "$N"); do
    PART="$PREFIX-part$i-of-$N.mp4"
    [ -f "$PART" ] || { echo "missing $PART" >&2; exit 1; }
    echo "file '$(cd "$(dirname "$PART")" && pwd)/$(basename "$PART")'" >> "$LIST"
  done
  JOINED="$PREFIX.mp4"
  echo "joining $N parts into $JOINED"
  ffmpeg -hide_banner -loglevel error -y -f concat -safe 0 -i "$LIST" -c copy "$JOINED"
  LOOP_VIDEO=$JOINED
fi

AUDIO_IN=(-stream_loop -1 -i "$AUDIO")
if [ -n "$EDITION" ]; then
  WAV="$TMPDIR_LONG/$EDITION-loop.wav"
  if [ -f "$HERE/soundtrack.mjs" ] && node "$HERE/soundtrack.mjs" --edition "$EDITION" --loop --out "$WAV" --rate 48000 && [ -s "$WAV" ]; then
    AUDIO_IN=(-stream_loop -1 -i "$WAV")
  else
    echo "WARN the soundtrack for $EDITION is missing or failed: the video gets a silent track" >&2
    AUDIO_IN=(-f lavfi -i "anullsrc=r=48000:cl=stereo")
  fi
fi

ffmpeg -hide_banner -y \
  -stream_loop -1 -i "$LOOP_VIDEO" \
  "${AUDIO_IN[@]}" \
  -map 0:v:0 -map 1:a:0 \
  -c:v copy -c:a aac -b:a 192k -ar 48000 \
  -t "$SECS" -movflags +faststart "$OUT"
echo "wrote $OUT"
