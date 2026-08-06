$f = 'C:\Users\ztocc\CodeBuddy\20260704155001\public\sample-template.xlsx'
$bytes = [System.IO.File]::ReadAllBytes($f)
$enc = [System.Text.Encoding]::GetEncoding('UTF-8').GetString($bytes)
$boundary = '----testboundary' + (Get-Random)
$lf = "`r`n"
$body = "--$boundary$lf"
$body += "Content-Disposition: form-data; name=`"file`"; filename=`"sample.xlsx`"$lf"
$body += "Content-Type: application/octet-stream$lf$lf"
$body += $enc + $lf
$body += "--$boundary--$lf"
$bodyBytes = [System.Text.Encoding]::GetEncoding('UTF-8').GetBytes($body)
try {
  $r = Invoke-WebRequest -Uri 'https://20260704155001.vercel.app/api/analyze' -Method POST -ContentType "multipart/form-data; boundary=$boundary" -Body $bodyBytes -UseBasicParsing -TimeoutSec 60
  Write-Output "HTTP: $($r.StatusCode)"
  Write-Output "BODY: $($r.Content)"
} catch {
  Write-Output "EXCEPTION: $($_.Exception.Message)"
  if ($_.Exception.Response) {
    $sr = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    Write-Output "ERROR BODY: $($sr.ReadToEnd())"
  }
}