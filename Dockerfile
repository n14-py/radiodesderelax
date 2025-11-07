# Usamos una imagen de Node.js 18 que tenga Alpine (base de Linux ligera)
FROM node:18-alpine

# 1. Instalar dependencias del sistema
# - ffmpeg: El transmisor ("Músico")
# - bash: Para ejecutar el script de ffmpeg
# - tzdata: Para la zona horaria
RUN apk add --no-cache ffmpeg bash tzdata

# 2. Configurar zona horaria
ENV TZ=America/Asuncion

# 3. Crear directorio de trabajo
WORKDIR /usr/src/app

# --- ¡NUEVA LÍNEA! ---
# Creamos el directorio donde Render "conectará" nuestro disco persistente
RUN mkdir -p /mnt/disk
# ---------------------

# 4. Instalar dependencias de Node.js (para el "Recepcionista")
COPY package*.json ./
RUN npm install --omit=dev

# 5. Copiar el resto del código fuente (server.js)
COPY . .

# 6. Crear un archivo playlist.txt vacío inicial
# (Sin cambios, FFmpeg leerá este archivo)
RUN touch playlist.txt && \
    echo "ffconcat version 1.0" > playlist.txt && \
    echo "# Esperando primera publicación desde el panel de admin..." >> playlist.txt

# 7. Exponer el puerto que Render usará para la API (el "Recepcionista")
EXPOSE 8080
ENV PORT=8080

# 8. Comando de inicio: Iniciar Node.js (que iniciará FFmpeg)
CMD ["node", "server.js"]