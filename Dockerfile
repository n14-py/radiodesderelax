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

# 4. Instalar dependencias de Node.js (para el server.js)
COPY package*.json ./
RUN npm install --omit=dev

# 5. Copiar el resto del código fuente (server.js)
COPY . .

# 6. Crear el archivo playlist.txt vacío inicial
RUN touch playlist.txt && \
    echo "ffconcat version 1.0" > playlist.txt && \
    echo "# Esperando primera publicación desde el panel de admin..." >> playlist.txt

# 7. Exponer el puerto que Render usará para la API
EXPOSE 8080
ENV PORT=8080

# 8. Comando de inicio: ¡SOLO INICIAMOS NODE.JS!
CMD ["node", "server.js"]