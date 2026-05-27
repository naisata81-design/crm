# Usar imagen base de Node que incluye Debian con apt-get disponible
FROM node:22-slim

# Instalar las dependencias de sistema que necesita Chrome/Puppeteer
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    libglib2.0-0 \
    libnss3 \
    libnspr4 \
    libdbus-1-3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libxshmfence1 \
    libx11-xcb1 \
    libpangocairo-1.0-0 \
    libgtk-3-0 \
    fonts-liberation \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Crear directorio de trabajo
WORKDIR /app

# Copiar archivos de dependencias primero (para cachear mejor)
COPY package*.json ./

# Instalar dependencias de Node (incluyendo puppeteer que descarga Chrome)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false
RUN npm install --omit=dev

# Copiar el resto de los archivos del proyecto
COPY . .

# Exponer el puerto
EXPOSE 3001

# Comando para iniciar el servidor
CMD ["node", "server_2.js"]
