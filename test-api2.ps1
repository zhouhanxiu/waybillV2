try {
  $r = Invoke-WebRequest -Uri 'https://20260704155001.vercel.app/api/import-tasks' -UseBasicParsing
  Write-Output "HTTP: $($r.StatusCode)"
  Write-Output "BODY:"
  Write-Output $r.Content.Substring(0, [Math]::Min($r.Content.Length, 1500))
} catch {
  Write-Output "ERR: $($_.Exception.Message)"
  if ($_.Exception.Response) {
    $stream = $_.Exception.Response.GetResponseStream()
    $reader = New-Object System.IO.StreamReader($stream)
    Write-Output "BODY:"
    Write-Output $reader.ReadToEnd()
  }
}
