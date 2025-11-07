# Usamos Alpine Linux (muy ligero y rápido)
FROM alpine:latest

# Instalamos FFmpeg, Bash (para el script) y certificados SSL (para leer HTTPS)
RUN apk add --no-cache ffmpeg bash ca-certificates

# Configuramos la zona horaria (opcional, pero útil para logs)
RUN apk add --no-cache tzdata
ENV TZ=America/Asuncion

# Copiamos nuestro script de inicio al contenedor
COPY start.sh /start.sh

# Le damos permisos de ejecución al script
RUN chmod +x /start.sh

# Comando que se ejecuta al iniciar el servidor
CMD ["/start.sh"]