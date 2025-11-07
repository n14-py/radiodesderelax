#!/bin/bash

# Bucle infinito para mantener el stream vivo
while true; do
    echo "=================================================="
    echo "🚀 INICIANDO TRANSMISIÓN DE RADIO RELAX..."
    echo "📥 Leyendo playlist de: $PLAYLIST_URL"
    echo "📤 Enviando stream a destino RTMP..."
    echo "=================================================="

    # Comando FFmpeg optimizado para lectura remota
    # -re: Lee a velocidad real (crucial para streaming)
    # -f concat -safe 0: Permite leer el archivo de playlist
    # -protocol_whitelist: Permite que la playlist contenga enlaces https (Cloudinary)
    # -c:a aac -b:a 128k: Re-codifica todo a AAC 128kbps para uniformidad
    # -ar 44100 -ac 2: Estándar de audio (44.1kHz Estéreo)
    # -f flv: Formato necesario para RTMP
    
    ffmpeg -re -f concat -safe 0 \
        -protocol_whitelist file,http,https,tcp,tls \
        -i "$PLAYLIST_URL" \
        -c:a aac -b:a 128k -ar 44100 -ac 2 \
        -f flv "$RTMP_URL"

    echo "⚠️ ALERTA: El stream se desconectó o terminó la playlist."
    echo "🔄 Reiniciando en 10 segundos..."
    sleep 10
done