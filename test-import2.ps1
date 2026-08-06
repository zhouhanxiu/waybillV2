[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$f = 'C:\Users\ztocc\CodeBuddy\20260704155001\public\sample-template.xlsx'

try {
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $r = Invoke-WebRequest -Uri 'https://20260704155001.vercel.app/api/import-tasks' `
    -Method POST `
    -Form @{file = Get-Item $f} `
    -UseBasicParsing `
    -TimeoutSec 90
  $sw.Stop()
  Write-Output "HTTP: $($r.StatusCode) ($($sw.ElapsedMilliseconds)ms)"
  Write-Output "BODY: $($r.Content)"
} catch {
  Write-Output "EXCEPTION after $($sw.ElapsedMilliseconds)ms: $($_.Exception.Message)"
  if ($_.Exception.Response) {
    try {
      $sr = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
      Write-Output "ERROR BODY: $($sr.ReadToEnd())"
    } catch {}
  }
}