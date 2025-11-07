# Usamos una imagen base ligera de Linux con Node.js 20
FROM node:20-slim

# 1. Instalar dependencias del sistema (FFmpeg, NGINX RTMP, Supervisord)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    nginx \
    libnginx-mod-rtmp \
    supervisor \
    && rm -rf /var/lib/apt/lists/*

# 2. Crear directorio de trabajo
WORKDIR /usr/src/app

# 3. Copiar archivos de configuración de servicios
COPY nginx.conf /etc/nginx/nginx.conf
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# 4. Crear un playlist.txt vacío inicial para que FFmpeg no falle fatalmente al inicio
RUN touch playlist.txt && echo "ffconcat version 1.0" > playlist.txt

# 5. Instalar dependencias de Node.js
COPY package*.json ./
RUN npm install

# 6. Copiar el resto del código fuente de la API
COPY . .

# 7. Exponer puertos (8080 para Web/API, 1935 para RTMP interno)
EXPOSE 8080 1935

# 8. Comando de inicio: Ejecutar Supervisord (que iniciará todo lo demás)
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]