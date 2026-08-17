#!/bin/bash
# ============================================================
# Generates the bundled voice clips (audio/voice/*.m4a) with the
# Mac's Yuna voice. Run once, commit the audio/voice folder, and
# every device plays the same natural Korean voice — no more
# depending on each phone's speech engine.
#
# Usage:  bash tools/generate-voice.sh
#
# Picks the best installed Yuna (Premium > Enhanced > standard).
# For the nicest result, first download the enhanced voice:
# System Settings → Accessibility → Spoken Content → System Voice
# → Manage Voices → Korean → Yuna (Premium/Enhanced).
# ============================================================
set -e
cd "$(dirname "$0")/.."
mkdir -p audio/voice

# Best available Yuna variant.
pick() { say -v '?' | grep -i "$1" | sed -E 's/[[:space:]]+ko[-_]KR.*//' | head -1; }
YUNA="$(pick 'yuna.*premium' || true)"
[ -z "$YUNA" ] && YUNA="$(pick 'yuna.*enhanced' || true)"
[ -z "$YUNA" ] && YUNA="$(pick 'yuna' || true)"
if [ -z "$YUNA" ]; then
  echo "No Yuna voice installed. Add it in System Settings → Accessibility → Spoken Content → System Voice → Manage Voices → Korean."
  exit 1
fi
# Best available English voice for the completion line.
EN="$(say -v '?' | grep -iE '^samantha' | sed -E 's/[[:space:]]+en[-_]US.*//' | head -1)"
[ -z "$EN" ] && EN="Samantha"

echo "Korean voice:  $YUNA"
echo "English voice: $EN"

gen() { # gen <file-key> <voice> <text>
  local key="$1" voice="$2" text="$3" tmp
  tmp="$(mktemp -t mtv).aiff"
  say -v "$voice" -o "$tmp" "$text"
  afconvert -f m4af -d aac -q 127 "$tmp" "audio/voice/$key.m4a"
  rm -f "$tmp"
  echo "  audio/voice/$key.m4a  ($text)"
}

# Numbers 1–10 (hana … yeol)
gen n1  "$YUNA" "하나"
gen n2  "$YUNA" "둘"
gen n3  "$YUNA" "셋"
gen n4  "$YUNA" "넷"
gen n5  "$YUNA" "다섯"
gen n6  "$YUNA" "여섯"
gen n7  "$YUNA" "일곱"
gen n8  "$YUNA" "여덟"
gen n9  "$YUNA" "아홉"
gen n10 "$YUNA" "열"

# Commands
gen joonbi "$YUNA" "준비"
gen sijak  "$YUNA" "시작"
gen baro   "$YUNA" "바로"
gen suh    "$YUNA" "서"

# Poomsae names
gen p1  "$YUNA" "태극 일장"
gen p2  "$YUNA" "태극 이장"
gen p3  "$YUNA" "태극 삼장"
gen p4  "$YUNA" "태극 사장"
gen p5  "$YUNA" "태극 오장"
gen p6  "$YUNA" "태극 육장"
gen p7  "$YUNA" "태극 칠장"
gen p8  "$YUNA" "태극 팔장"
gen p9  "$YUNA" "고려"
gen p10 "$YUNA" "금강"
gen p11 "$YUNA" "태백"
gen p12 "$YUNA" "평원"
gen p13 "$YUNA" "십진"
gen p14 "$YUNA" "지태"
gen p15 "$YUNA" "천권"

# English completion line (ground/custom drills)
gen complete "$EN" "The drill has completed"

echo ""
echo "Done — $(ls audio/voice | wc -l | tr -d ' ') clips in audio/voice/. Commit the folder and push."
