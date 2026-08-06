[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$f = 'C:\Users\ztocc\CodeBuddy\20260704155001\public\sample-template.xlsx'
$bytes = [System.IO.File]::ReadAllBytes($f)
$boundary = [System.Guid]::NewGuid().ToString()
$lf = "`r`n"

$header = "--$boundary$lf" +
         "Content-Disposition: form-data; name=`"file`"; filename=`"sample-template.xlsx`"$lf" +
         "Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet$lf$lf"

$footer = "$lf--$boundary--$lf"

$hb = [System.Text.Encoding]::ASCII.GetBytes($header)
$fb = [System.Text.Encoding]::ASCII.GetBytes($footer)
$ms = New-Object System.IO.MemoryStream
$ms.Write($hb, 0, $hb.Length)
$ms.Write($bytes, 0, $bytes.Length)
$ms.Write($fb, 0, $fb.Length)

try {
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $r = Invoke-WebRequest -Uri 'https://20260704155001.vercel.app/api/import-tasks' `
    -Method POST `
    -ContentType "multipart/form-data; boundary=$boundary" `
    -Body $ms.ToArray() `
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