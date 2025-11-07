FROM continuumio/miniconda3:25.3.1-1

# Set working directory
WORKDIR /app

# Copy requirements first for better caching
COPY requirements.txt .
# Install Python dependencies
RUN pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY central_host.py .
COPY templates/ ./templates/
COPY static/ ./static/

# Expose the port
EXPOSE 17890

# Run the application
CMD ["python", "central_host.py"]