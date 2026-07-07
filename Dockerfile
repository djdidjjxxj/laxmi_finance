FROM php:8.3-cli-alpine

# Install system dependencies
RUN apk add --no-cache \
    git \
    curl \
    libpng-dev \
    libxml2-dev \
    zip \
    unzip \
    postgresql-dev \
    nodejs \
    npm

# Install PHP extensions
RUN docker-php-ext-install pdo_pgsql gd

# Get latest Composer
COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

# Set working directory
WORKDIR /var/www

# Copy existing application directory contents
COPY . .

# Install PHP dependencies
RUN composer install --no-dev --optimize-autoloader

# Install Node dependencies and build assets
RUN npm install
RUN npm run build

# Expose port and start server
EXPOSE 80

CMD (php artisan storage:link || true) && php artisan migrate --force && php artisan serve --host=0.0.0.0 --port=$PORT
