<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Laxmi Finance</title>
    <meta name="description" content="Laxmi Finance loan management portal." />
    <meta name="csrf-token" content="{{ csrf_token() }}" />
    <style>html, body { height: 100%; margin: 0; } #root { height: 100%; }</style>
    @vite('src/main.tsx')
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
