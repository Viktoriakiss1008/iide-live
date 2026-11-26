$ErrorActionPreference = 'Stop'
$root = (Get-Location).Path.TrimEnd('\') + '\'
$dataDir = Join-Path $root '.server-data'
$tripsFile = Join-Path $dataDir 'trips.json'
$hostPort = if ($env:PORT) { $env:PORT } else { '8765' }

New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
if (-not (Test-Path -LiteralPath $tripsFile)) {
  Set-Content -LiteralPath $tripsFile -Value '[]' -Encoding UTF8
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://+:$hostPort/")

function Send-Json {
  param(
    [System.Net.HttpListenerResponse]$Response,
    [int]$StatusCode,
    [object]$Value
  )
  if ($null -eq $Value -or (@($Value).Count -eq 0)) {
    $json = '[]'
  } elseif ($Value -is [System.Collections.IDictionary]) {
    $json = $Value | ConvertTo-Json -Depth 8 -Compress
  } elseif (@($Value).Count -eq 1 -and $Value -isnot [System.Array]) {
    $json = $Value | ConvertTo-Json -Depth 8 -Compress
  } else {
    $json = ConvertTo-Json -InputObject @($Value) -Depth 8 -Compress
  }
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $Response.StatusCode = $StatusCode
  $Response.ContentType = 'application/json; charset=utf-8'
  $Response.ContentLength64 = $bytes.Length
  $Response.Headers['Access-Control-Allow-Origin'] = '*'
  $Response.OutputStream.Write($bytes, 0, $bytes.Length)
}

function Send-Raw-Json {
  param(
    [System.Net.HttpListenerResponse]$Response,
    [int]$StatusCode,
    [string]$Json
  )
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($Json.TrimStart([char]0xFEFF))
  $Response.StatusCode = $StatusCode
  $Response.ContentType = 'application/json; charset=utf-8'
  $Response.ContentLength64 = $bytes.Length
  $Response.Headers['Access-Control-Allow-Origin'] = '*'
  $Response.OutputStream.Write($bytes, 0, $bytes.Length)
}

function Get-Trips {
  try {
    $raw = Get-Content -LiteralPath $tripsFile -Raw -Encoding UTF8
    $trips = $raw | ConvertFrom-Json
    if ($null -eq $trips) { return ,@() }
    if ($trips -isnot [System.Array]) { return ,@($trips) }
    return ,$trips
  } catch {
    return ,@()
  }
}

function Save-Trips {
  param([object[]]$Trips)
  $tempFile = "$tripsFile.tmp"
  $json = if (@($Trips).Count -eq 0) { '[]' } else { ConvertTo-Json -InputObject @($Trips) -Depth 8 -Compress }
  Set-Content -LiteralPath $tempFile -Value $json -Encoding UTF8
  Move-Item -LiteralPath $tempFile -Destination $tripsFile -Force
}

$wifiAddress = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.InterfaceAlias -match 'Wi-Fi|Wireless|WLAN' -and $_.IPAddress -notlike '169.254.*' } |
  Select-Object -First 1 -ExpandProperty IPAddress
$ipv4 = if ($wifiAddress) {
  $wifiAddress
} else {
  Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
    Sort-Object PrefixLength |
    Select-Object -First 1 -ExpandProperty IPAddress
}

try {
  $listener.Start()
  Write-Output "Iide server available at:"
  Write-Output "  http://localhost:$hostPort/"
  if ($ipv4) {
    Write-Output "  http://${ipv4}:$hostPort/  (other devices on this Wi-Fi/LAN)"
  }

  while ($listener.IsListening) {
    $context = $listener.GetContext()
    try {
      $request = $context.Request
      $response = $context.Response
      $path = [Uri]::UnescapeDataString($request.Url.AbsolutePath).TrimEnd('/')
      if ([string]::IsNullOrWhiteSpace($path)) { $path = '/' }
      $response.Headers['Cache-Control'] = 'no-store'

      if ($request.HttpMethod -eq 'OPTIONS') {
        $response.StatusCode = 204
        $response.Headers['Access-Control-Allow-Origin'] = '*'
        $response.Headers['Access-Control-Allow-Methods'] = 'GET, PUT, DELETE, OPTIONS'
        $response.Headers['Access-Control-Allow-Headers'] = 'Content-Type'
      } elseif ($path -eq '/api/trips' -and $request.HttpMethod -eq 'GET') {
        $raw = Get-Content -LiteralPath $tripsFile -Raw -Encoding UTF8
        Send-Raw-Json -Response $response -StatusCode 200 -Json $raw
      } elseif ($path -match '^/api/trips/([^/]+)$') {
        $tripId = [Uri]::UnescapeDataString($Matches[1])
        if ($request.HttpMethod -eq 'DELETE') {
          $trips = @(Get-Trips | Where-Object { $_.id -ne $tripId })
          Save-Trips -Trips $trips
          Send-Json -Response $response -StatusCode 200 -Value @{ ok = $true }
        } elseif ($request.HttpMethod -eq 'PUT') {
          $reader = New-Object System.IO.StreamReader($request.InputStream, [System.Text.Encoding]::UTF8)
          $rawTrip = $reader.ReadToEnd()
          $reader.Close()
          $trip = $rawTrip | ConvertFrom-Json
          if ($trip.id -ne $tripId) {
            Send-Json -Response $response -StatusCode 400 -Value @{ error = 'Trip ID does not match request URL.' }
          } elseif ([string]::IsNullOrWhiteSpace([string]$trip.routeName) -or [string]::IsNullOrWhiteSpace([string]$trip.nextStop)) {
            Send-Json -Response $response -StatusCode 400 -Value @{ error = 'Route and next stop are required.' }
          } else {
            $trips = @(Get-Trips | Where-Object { $_.id -ne $tripId })
            $trips += $trip
            Save-Trips -Trips $trips
            Send-Json -Response $response -StatusCode 200 -Value @{ ok = $true; trip = $trip }
          }
        } else {
          $response.StatusCode = 405
        }
      } else {
        $relativePath = $path.TrimStart('/')
        if ([string]::IsNullOrWhiteSpace($relativePath)) { $relativePath = 'index.html' }
        $filePath = [System.IO.Path]::GetFullPath((Join-Path $root $relativePath))
        if (-not $filePath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) -or
            -not (Test-Path -LiteralPath $filePath -PathType Leaf)) {
          $response.StatusCode = 404
        } else {
          $contentType = switch ([System.IO.Path]::GetExtension($filePath).ToLowerInvariant()) {
            '.html' { 'text/html; charset=utf-8' }
            '.js' { 'text/javascript; charset=utf-8' }
            '.css' { 'text/css; charset=utf-8' }
            '.webmanifest' { 'application/manifest+json' }
            '.svg' { 'image/svg+xml' }
            '.png' { 'image/png' }
            '.json' { 'application/json; charset=utf-8' }
            default { 'application/octet-stream' }
          }
          $content = [System.IO.File]::ReadAllBytes($filePath)
          $response.ContentType = $contentType
          $response.ContentLength64 = $content.Length
          $response.OutputStream.Write($content, 0, $content.Length)
        }
      }
    } catch {
      try {
        Send-Json -Response $context.Response -StatusCode 500 -Value @{ error = 'Internal server error.' }
      } catch {}
    } finally {
      $context.Response.Close()
    }
  }
} finally {
  $listener.Close()
}
