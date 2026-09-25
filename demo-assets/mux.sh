#!/usr/bin/env bash
# VidoraTube demo 60s render — reproducible assembly pipeline.
# 6 stills x 10s (zoompan Ken Burns) + narration (atempo fit + loudnorm -14 LUFS)
# + burned-in SRT captions -> 1920x1080 H.264 / AAC MP4, 60.0s.
set -euo pipefail
D="$(cd "$(dirname "$0")" && pwd)"
cd "$D"
FF=/usr/bin/ffmpeg
SEG=25          # fps
FRAMES=250      # 10s @ 25fps
OUT="$D/vidora-demo-60s.mp4"

echo "==> 1/4 building 10s zoompan segments"
i=0
for n in 1 2 3 4 5 6; do
  i=$((i+1))
  if [ $((n % 2)) -eq 1 ]; then
    Z="z='1.0+0.08*on/249'"
  else
    Z="z='1.08-0.08*on/249'"
  fi
  $FF -hide_banner -loglevel error -y -loop 1 -framerate $SEG -i "stills/scene-$n.webp" \
    -vf "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,zoompan=${Z}:d=${FRAMES}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080:fps=${SEG}" \
    -frames:v $FRAMES -c:v libx264 -preset medium -crf 16 -pix_fmt yuv420p -r $SEG "seg-$n.mp4"
done

echo "==> 2/4 concat to 60s video"
printf "file 'seg-1.mp4'\nfile 'seg-2.mp4'\nfile 'seg-3.mp4'\nfile 'seg-4.mp4'\nfile 'seg-5.mp4'\nfile 'seg-6.mp4'\n" > concat.txt
$FF -hide_banner -loglevel error -y -f concat -safe 0 -i concat.txt -c copy video60.mp4

echo "==> 3/4 narration: atempo fit (61.92s -> 59.83s), dual-pass loudnorm, makeup gain, brickwall limit"
MEAS=$($FF -hide_banner -i narration.mp3 -af "atempo=1.035,loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json" -f null - 2>&1 | sed -n '/{/,/}/p')
M_I=$(echo "$MEAS" | grep '"input_i"' | sed 's/[^0-9.\-]//g')
M_TP=$(echo "$MEAS" | grep '"input_tp"' | sed 's/[^0-9.\-]//g')
M_LRA=$(echo "$MEAS" | grep '"input_lra"' | sed 's/[^0-9.\-]//g')
M_TH=$(echo "$MEAS" | grep '"input_thresh"' | sed 's/[^0-9.\-]//g')
M_OFF=$(echo "$MEAS" | grep '"target_offset"' | sed 's/[^0-9.\-]//g')
echo "$MEAS" > loudnorm-measured.json
# pass 2: dual-pass dynamic loudnorm (lands ~1.4 dB shy of -14 on this content)
$FF -hide_banner -loglevel error -y -i narration.mp3 \
  -af "atempo=1.035,loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=${M_I}:measured_TP=${M_TP}:measured_LRA=${M_LRA}:measured_thresh=${M_TH}:offset=${M_OFF}:linear=true,aformat=sample_rates=48000:channel_layouts=stereo" \
  -c:a pcm_s16le audio_norm.wav
# pass 3: linear makeup gain to exactly -14.0 LUFS, then brickwall limit at -1.5 dB sample peak
M2=$($FF -hide_banner -i audio_norm.wav -af "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json" -f null - 2>&1 | sed -n '/{/,/}/p')
M2_I=$(echo "$M2" | grep '"input_i"' | sed 's/[^0-9.\-]//g')
GAIN=$(python3 -c "print(round(-14.0 - (${M2_I}), 3))")
echo "makeup gain: ${GAIN} dB (measured integrated ${M2_I} LUFS)"
$FF -hide_banner -loglevel error -y -i audio_norm.wav \
  -af "volume=${GAIN}dB,alimiter=limit=0.8414:attack=5:release=50:level_in=1:level_out=1,apad=whole_dur=60,aformat=sample_rates=48000:channel_layouts=stereo" \
  -c:a aac -b:a 128k audio_final.m4a
rm -f audio_norm.wav

echo "==> 4/4 final mux: subtitles burned in, H.264/AAC, faststart"
$FF -hide_banner -loglevel error -y -i video60.mp4 -i audio_final.m4a \
  -vf "subtitles=captions.srt:force_style='FontSize=26,PrimaryColour=&H00FFFFFF,OutlineColour=&H90000000,BorderStyle=1,Outline=2,Shadow=0,Alignment=2,MarginV=44'" \
  -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p -r 25 \
  -c:a aac -b:a 128k -ar 48000 -ac 2 -t 60 -movflags +faststart "$OUT"

rm -f seg-*.mp4 concat.txt
echo "DONE: $OUT"
