# Dockerfile for production deployment with Face Recognition
# Supports: Railway, Render, DigitalOcean App Platform, etc.

FROM node:22-bookworm

# Install system dependencies
RUN apt-get update && apt-get install -y \
    # Python for PySceneDetect
    python3 \
    python3-pip \
    python3-venv \
    # FFmpeg for video processing
    ffmpeg \
    # Canvas dependencies
    build-essential \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    libpixman-1-dev \
    pkg-config \
    # Cleanup
    && rm -rf /var/lib/apt/lists/*

# Install PySceneDetect
RUN pip3 install --break-system-packages scenedetect[opencv] \
    && scenedetect --help | head -5

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install Node dependencies
RUN npm ci

# Copy source code
COPY . .

# Build-time arguments (Railway will pass these automatically)
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY

# Set as environment variables for build
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY

# Build Next.js (now has access to env vars)
RUN npm run build

# Expose port
EXPOSE 3000

# Start the application
CMD ["npm", "start"]
