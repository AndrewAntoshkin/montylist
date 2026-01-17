# Dockerfile for production deployment with Face Recognition
# Supports: Railway, Render, DigitalOcean App Platform, etc.

FROM node:22-bookworm

# Build-time arguments - MUST be declared before use
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY

# Set as environment variables for the entire build process
ENV NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY}

# Debug: Print to verify variables are passed (will show in build logs)
RUN echo "=== Build Environment Check ===" && \
    echo "SUPABASE_URL length: $(echo -n "$NEXT_PUBLIC_SUPABASE_URL" | wc -c)" && \
    echo "SUPABASE_KEY length: $(echo -n "$NEXT_PUBLIC_SUPABASE_ANON_KEY" | wc -c)" && \
    echo "==============================="

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

# Build Next.js (now has access to env vars via ENV set earlier)
RUN npm run build

# Expose port
EXPOSE 3000

# Start the application
CMD ["npm", "start"]
