Set-Location $PSScriptRoot
$env:PORT = "8765"
Start-Process "http://127.0.0.1:8765"
python .\server.py
