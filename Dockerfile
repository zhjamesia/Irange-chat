FROM python:3.7.9-alpine

# Set working directory
WORKDIR /app

# Install system dependencies if needed
RUN apk add --no-cache \
    gcc \
    musl-dev \
    && rm -rf /var/cache/apk/*

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY central_host.py .
COPY templates/ ./templates/
COPY static/ ./static/

# Expose the port
EXPOSE 7890

# Run the application
CMD ["python", "central_host.py"]

